// whale-mind · plugin.mjs (M2)
// DSH 宿主插件：把 whale-mind 引擎接进 DeepSeek Harness。
//
// 实现依据（feiyu SPEC §15/§17.7/§17.10 侦察结论）：
// - 事件：session/event(采集) · agent/turn-stopping(同步守卫+排队，绝不 await 模型调用) ·
//         agent/created(按会话注册 scoped section) · agent/disposed(释放)
// - 注入：systemPrompt.section({name:'whale-mind', order:100, interpolate:false})，
//         text 是每次 assemble 重新求值的函数，按轮缓存（一个回合几十个 model step）
// - 面板数据走 HTTP 路由（webServer），不走 host RPC；故意不设 CORS 头
// - 工具：whale_mind_note 手写 JSON schema（零依赖铁律，不 import dsh-tools）
// - 降级优先：任何服务缺失就静默停用对应能力，绝不挡聊天
//
// ⚠️ 状态：代码按上述契约编写并通过假 ctx 冒烟测试；**尚未在真实 DSH 端到端验证**，
//    字段形状以 feiyu 侦察为准，真机首验前不改动能跑的部分、出问题按 §10 降级。
import { Store } from './store.js';
import { gate, SUPPRESS_RE } from './gate.js';
import { consolidate } from './consolidate.js';
import { buildIndex, search } from './index.js';
import { buildInjection, estimateTokens } from './inject.js';
import { sanitizeForStorage, burn } from './privacy.mjs';
import { OutOfBandQueue } from './queue.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildGraph as panelGraph, searchMemories as panelSearch, statsFor as panelStats, eventsFor as panelEvents, busFor as panelBus } from '../panel/brain-data.mjs';
import { bridgeStatus, readDafeiyuEntries, readDafeiyuJobs } from './bridge.mjs';

export const name = 'whale-mind';

const PLUGIN_DEFAULTS = {
  dataDir: undefined, // 缺省 ~/.dsh/whale-mind（由 DSH 家目录推导；真机验证时确认取法）
  budgetTokens: 3000,
  maxNotes: 3,
  maxRecent: 3,
  decayRate: 0.9,
  salienceFloor: 0.16,
  coldThreshold: 0.45,
  minSalience: 0.15,
  recallSalience: 0.5,
  llm: { enabled: true, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', maxTokens: 900 },
  debugLog: false
};

export function apply(ctx, userConfig = {}) {
  const cfg = { ...PLUGIN_DEFAULTS, ...userConfig };
  if (!cfg.dataDir) {
    // feiyu 教训：目录在 apply() 时一次算定，之后全程用捕获值
    cfg.dataDir = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '~', '.dsh'), 'whale-mind');
  }
  const store = new Store(cfg.dataDir);
  const queue = new OutOfBandQueue({ jobTimeoutMs: 60000, flushTimeoutMs: 180000, onError: e => log('queue error: ' + e.message) });
  const lastUserBySession = new Map();
  const injectionCache = new Map(); // sessionId -> { key, text }
  const recentPenalty = new Map();
  let turnSeq = 0;

  function log(msg) {
    const line = `[whale-mind] ${msg}`;
    try { process.stderr.write(line + '\n'); } catch { /* stderr 无人接就算了 */ }
    if (cfg.debugLog) {
      try { fs.appendFileSync(path.join(cfg.dataDir, 'whale-mind.debug.log'), new Date().toISOString() + ' ' + msg + '\n', 'utf8'); } catch { /* 磁盘满不打扰 */ }
    }
  }

  function splitEntries(entries) {
    const notes = entries.filter(e => e.kind === 'note').sort((a, b) => b.updated_at - a.updated_at);
    const others = entries.filter(e => e.kind !== 'note').sort((a, b) => b.updated_at - a.updated_at);
    return { notes, others };
  }

  function injectionFor(sessionId) {
    const entries = store.active();
    const key = entries.length + ':' + (entries[0]?.updated_at ?? 0) + ':' + (lastUserBySession.get(sessionId) ?? '');
    const cached = injectionCache.get(sessionId);
    if (cached && cached.key === key) return cached.text; // 按轮缓存：一个回合几十个 model step
    const { notes, others } = splitEntries(entries);
    const idx = buildIndex(others);
    const query = lastUserBySession.get(sessionId) ?? '';
    const recalled = search(others, idx, query, cfg, new Date(), { recentPenaltyMap: recentPenalty, wander: true });
    const inj = buildInjection(
      { recent: others, notes, recalled, relationship: store.relationship(), daysKnown: __daysKnown(entries) },
      cfg, new Date()
    );
    injectionCache.set(sessionId, { key, text: inj.text });
    for (const r of recalled) recentPenalty.set(r.entry.id, turnSeq);
    return inj.text;
  }

  function __daysKnown(entries) {
    if (!entries.length) return 0;
    const first = entries.reduce((a, b) => (a.created_at < b.created_at ? a : b));
    const a = new Date(); a.setHours(0, 0, 0, 0);
    const b = new Date(first.created_at); b.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((a - b) / 86400000));
  }

  async function pipeline(sessionId, text) {
    const handNotes = []; // 手记.md（M2 稍后接）
    const g = await gate(text, cfg, handNotes);
    if (!g.keep) return { skipped: true, reason: g.reason };
    const c = await consolidate(sanitizeForStorage(text), cfg);
    if (c.skip) return { skipped: true, reason: c.reason };
    const now = new Date();
    const e = store.add({
      id: store.newId(now), date: undefined, text: sanitizeForStorage(c.diary.text), tags: c.diary.tags,
      kind: c.diary.kind, salience: c.diary.salience, resolved: c.diary.resolved, session: sessionId,
      created_at: now.getTime(), updated_at: now.getTime(),
      entities: [], source: g.via === 'llm' ? 'chat-llm' : 'chat'
    });
    const rel = store.relationship();
    if (c.relationship?.nickname) rel.nickname = c.relationship.nickname;
    rel.familiarity = Math.min(1, (rel.familiarity ?? 0) + (c.relationship?.familiarityDelta ?? 0));
    rel.last_reinforced = now.toISOString();
    store.saveRelationship(rel);
    for (const id of c.forget) store.del(id);
    injectionCache.delete(sessionId);
    log(`记下一条 ${e.id}（${e.kind}，salience ${e.salience}）`);
    return { skipped: false, entry: e };
  }

  // ---- 事件接线（全部防御式：服务缺失就降级） ----
  //
  // ⚠️ 真机形状（2026-11-04 从 app.asar 核到，之前全部是猜的）：
  //   · dsh-session 的 commit() 用 `callbackArgs = [this, event]` 派发 session/event，
  //     所以监听签名是 (session, event)，event.type ∈ 'user/message' | 'step/end' | …
  //     老代码按 (event) 读 event.sessionId / role / text —— 拿到的其实是 session 对象，
  //     三个字段全 undefined → **实时采集一条都没写进去过**（库里 13 条全是 source:'import'）。
  //   · agent/created 的 payload 是 { agent, source }，不是 agent 本身 →
  //     老代码 agent.ctx 直接 undefined，注入从装好那天起就永久停用了。
  //   · agent/turn-stopping 的 payload 只有 { turn, signal }，没有 agent id，
  //     靠它反查会话不可行 → 改成「空闲 8 秒 + 去重」兜底触发。
  const lastProcessed = new Map(); // sessionId -> 上一次已入库的文本，避免重复记
  const captureTimers = new Map();

  /** 从消息对象里取纯文本（content 是 [{type:'text', text}] 块数组） */
  function extractText(msg) {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    const blocks = Array.isArray(msg.content) ? msg.content : null;
    if (!blocks) return typeof msg.text === 'string' ? msg.text : '';
    return blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }

  // ---- 脏数据过滤 ----
  // 引擎会把运行时上下文混进 user/message：`Time sampled while preparing turn ...` 的尾巴、
  // goal 轮次的提示词、技能清单、system reminder。这些不是他说的话，一条都不该进日记。
  const NOISE_PREFIX_RE = /^\s*<(goal_round|goal_complete|goal_blocked|available_skills)\b/i;
  const NOISE_ANY_RE = /(Time sampled while preparing turn|Browser time zone for this request|Current runtime context|Elapsed since the|<goal_round>|<goal_complete>|<goal_blocked>|<available_skills>)/i;
  function stripRuntimeNoise(text) {
    let t = String(text ?? '');
    t = t.replace(/<\s*(system[-_]reminder|available_skills)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
    t = t.replace(/Time sampled while preparing turn[^\n]*/gi, ' ');
    t = t.replace(/Browser time zone for this request[^\n]*/gi, ' ');
    t = t.replace(/Elapsed since the preceding[^\n]*/gi, ' ');
    // 「Current runtime context.」后面整段是引擎塞的状态说明，收在第一个空行/下一段提示词之前
    t = t.replace(/Current runtime context\.[\s\S]*?(?=\n\s*\n|\n(?:这是你的记忆|$))/gi, ' ');
    return t.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  }

  function scheduleCapture(sessionId, text) {
    const prev = captureTimers.get(sessionId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      captureTimers.delete(sessionId);
      const key = text;
      if (lastProcessed.get(sessionId) === key) return; // 同一句不记两遍
      lastProcessed.set(sessionId, key);
      if (SUPPRESS_RE.test(text)) { log('用户要求别记，本轮跳过'); return; }
      queue.push(() => pipeline(sessionId, text));
    }, 8000);
    try { timer.unref?.(); } catch { /* 没有 unref 就随它 */ }
    captureTimers.set(sessionId, timer);
  }

  ctx.on?.('session/event', (session, event) => {
    if (!event || event.type !== 'user/message') return;
    const sessionId = session?.id ?? session?.header?.id;
    if (!sessionId) return;
    const data = event.data ?? event.message;
    // 引擎自己插的运行时上下文（source.kind === 'runtime-context'）不是用户说的话
    if (data && data.source && data.source.kind === 'runtime-context') return;
    const raw = extractText(data);
    if (!raw) return;
    // 整条都是系统提示（goal 轮次等）→ 直接丢；夹了时间戳尾巴 → 剥掉只剩他说的话
    if (NOISE_PREFIX_RE.test(raw)) return;
    const text = stripRuntimeNoise(raw);
    if (!text) return;
    if (NOISE_ANY_RE.test(text) && text.length < 40) return;
    lastUserBySession.set(sessionId, text);
    scheduleCapture(sessionId, text);
  });

  // ---- 注入 ----
  // assembleContextFor(agent) 返回 { agent, scope: agent }，且 dsh-system-prompt 调
  // `section.text(context)` —— 所以**全局注册一段**就够：text 里按 c.agent.id 分会话取文本，
  // 不依赖 agent.ctx（原来就是它 undefined 导致注入永久停用）。
  try {
    ctx.inject(['systemPrompt'], (scope) => {
      try {
        scope.systemPrompt.section({
          name: 'whale-mind',
          order: 100,
          interpolate: false, // 用户可控文本绝不走模板插值（feiyu SPEC §7）
          text: (c) => {
            try { return injectionFor(c?.agent?.id ?? c?.scope?.id ?? 'default') }
            catch (err) { log('注入求值失败（本轮不加记忆）：' + err.message); return '' }
          },
        });
        log('记忆注入已注册（全局段，按 agent.id 分会话求值）');
      } catch (err) {
        // 重复加载同名段会抛 already registered —— 记一笔但不许把 apply 弄挂
        log('注册记忆段失败（多半是重复加载）：' + err.message);
      }
    });
  } catch (err) { log('systemPrompt 服务缺失，记忆注入停用：' + err.message); }

  // 会话销毁：清掉该会话的注入缓存与采集状态，避免长跑后 Map 越长越大
  ctx.on?.('agent/disposed', (payload) => {
    const agent = payload?.agent ?? payload;
    const id = agent?.id;
    if (!id) return;
    injectionCache.delete(id);
    lastUserBySession.delete(id);
    lastProcessed.delete(id);
    const t = captureTimers.get(id);
    if (t) { clearTimeout(t); captureTimers.delete(id); }
  });

  // 面板数字要跟得上：手记/遗忘后通知前端重读（服务缺失就静默）
  function notifyChanged() {
    try { ctx.emit?.('plugin-manager/changed', { reason: 'whale-mind' }) } catch { /* 没有也无所谓 */ }
  }
  void notifyChanged;

  // ---- HTTP 路由（web 组合才有；headless 没有——inject 语义正好） ----
  //
  // ⚠️ 真机教训（2026-11-03 实测）：dsh 的 webServer **不是**「返回 res 对象」的模型，
  //    而是 Node 原生 `(req, res) => void`，处理函数自己 res.writeHead/res.end。
  //    之前按「返回 {status,headers,body}」写，请求会**永久挂起**（面板永远停在「正在读取…」，
  //    外部 curl 直接 timeout，且宿主无任何报错）——这是最难查的一类假死。
  //    现在统一走 send() 适配：既能兼容返回对象的写法，也能兼容原生写 res。
  const SENT = Symbol('whale-mind:sent');
  function send(req, res, status, type, body) {
    // 兼容三种签名：send(res,...) / send(req,res,...) / res 缺失时返回普通对象
    if (status !== undefined && type === undefined && body === undefined) {
      // 只传了一个参数：当作旧的「返回对象」风格兜底，不处理
      return undefined;
    }
    const noRes = !res || typeof res.writeHead !== 'function';
    if (noRes) return { status, headers: { 'Content-Type': type }, body };
    if (res[SENT] || res.writableEnded) return undefined;
    res[SENT] = true;
    try {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
      res.writeHead(status, {
        'Content-Type': type,
        'Content-Length': String(buf.byteLength),
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    } catch (err) { log('写响应失败：' + err.message); }
    return undefined;
  }

  // 读取请求体（Node stream 形态）——注意必须容错：body 可能已被上游读过
  function readBody(req, limit = 1024 * 1024) {
    return new Promise((resolve) => {
      try {
        if (req?.body !== undefined) { // 已有解析好的 body（某些适配层会预读）
          resolve(typeof req.body === 'string' ? safeJson(req.body) : req.body);
          return;
        }
        let size = 0;
        const chunks = [];
        const done = () => { try { resolve(safeJson(Buffer.concat(chunks).toString('utf8'))) } catch { resolve({}) } };
        req.on('data', (c) => { size += c.length; if (size <= limit) chunks.push(c) });
        req.on('end', done);
        req.on('error', () => resolve({}));
        // 兜底：GET 或没有 body 的请求不会触发 end 之外的等待
        if (req.readableEnded) done();
      } catch { resolve({}); }
    });
  }
  function safeJson(text) {
    try { const v = JSON.parse(text || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
  }

  try {
    ctx.inject(['webServer'], (scope) => {
      const json = (res, data) => send(null, res, 200, 'application/json; charset=utf-8', JSON.stringify(data));
      const route = (meta, fn) => scope.webServer.register({
        ...meta,
        handler: (req, res) => {
          // Handler 里的异常绝不能吞成「挂起」——回 500，面板才能看见原因
          Promise.resolve()
            .then(() => fn(req, res))
            .catch((err) => { try { json(res, { ok: false, error: String(err && err.message || err) }) } catch { /* 已发送 */ } });
        },
      });

      route({ kind: 'exact', path: '/whale-mind/state' }, async (req, res) => {
        const entries = store.active();
        const { notes, others } = splitEntries(entries);
        const inj = injectionFor('panel');
        json(res, {
          ok: true, schema_version: 1, count: entries.length,
          recent: others.slice(0, 12), notes: notes.slice(0, 6),
          relationship: store.relationship(),
          injection: { text: inj, tokens: estimateTokens(inj) },
          queue: { pending: queue.pending },
          dataDir: cfg.dataDir,
        });
      });
      route({ kind: 'exact', path: '/whale-mind/export' }, async (req, res) => {
        json(res, { ok: true, entries: store.active() });
      });

      // ---- 大飞鱼记忆宫殿（dafeiyu-dot）：只读视图 + 一键把 diary 同步进去 ----
      const PALACE_ROOT = path.join(os.homedir(), '.dsh', 'dsh-dafeiyu-dot');
      const PALACE_JSON = path.join(PALACE_ROOT, 'memories.json');
      route({ kind: 'exact', path: '/whale-mind/palace' }, async (req, res) => {
        let data = { memories: [] };
        try { data = JSON.parse(fs.readFileSync(PALACE_JSON, 'utf8')); } catch { /* 还没有就当空 */ }
        const all = Array.isArray(data.memories) ? data.memories : [];
        const active = all.filter((m) => m.status !== 'superseded');
        const bySpace = {};
        for (const m of active) bySpace[m.spaceId] = (bySpace[m.spaceId] ?? 0) + 1;
        json(res, {
          ok: true, count: active.length, bySpace,
          recent: active.slice(-8).reverse().map((m) => ({
            id: m.id, spaceId: m.spaceId, content: String(m.content ?? '').slice(0, 120),
            predicate: m.predicate ?? '', updatedAt: m.updatedAt ?? '',
          })),
          path: PALACE_JSON,
        });
      });
      route({ kind: 'exact', path: '/whale-mind/palace/sync' }, async (req, res) => {
        const { execFile } = await import('node:child_process');
        const script = path.join(cfg.dataDir, '..', '..', 'dsh-power', '_palace_import.mjs');
        const candidates = [
          'D:/catalogue/dsh-power/_palace_import.mjs',
          script,
        ].filter((p) => { try { return fs.existsSync(p) } catch { return false } });
        if (!candidates.length) return json(res, { ok: false, error: '找不到 _palace_import.mjs' });
        execFile('node', [candidates[0], '--apply'], { timeout: 120000 }, (err, stdout, stderr) => {
          json(res, {
            ok: !err,
            output: String(stdout || '').trim().split('\n').slice(-4).join('\n'),
            error: err ? String(stderr || err.message).slice(0, 400) : null,
          });
        });
      });

      // ---- 三板面板（/whale-mind/panel/*）：记忆星脑/神经星环/记忆银河，按钮切换 ----
      const panelDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'panel');
      const panelFile = (res, rel, type) => {
        try { send(null, res, 200, type, fs.readFileSync(path.join(panelDir, rel))) }
        catch { send(null, res, 404, 'text/plain; charset=utf-8', 'Not found') }
      };
      const panelJson = (res, body) => send(null, res, 200, 'application/json; charset=utf-8', JSON.stringify(body));
      // vendor（three.js / OrbitControls）：importmap 解析出的绝对路径就是 /whale-mind/panel/vendor/*。
      // 早先这里没有注册任何 vendor 路由 → three.module.min.js 404 → 模块整体不执行 → 画布全黑。
      // 用 prefix 兜住整个 /whale-mind/panel/vendor/ 前缀，并按扩展名给 MIME。
      const PANEL_MIME = {
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.woff2': 'font/woff2',
        '.wasm': 'application/wasm',
      };
      route({ kind: 'prefix', path: '/whale-mind/panel/vendor' }, async (req, res) => {
        const url = new URL(req?.url ?? '/', 'http://dsh.invalid');
        const rel = decodeURIComponent(url.pathname.slice('/whale-mind/panel/vendor'.length)).replace(/^\/+/, '');
        if (!rel) { send(null, res, 404, 'text/plain; charset=utf-8', 'Not found'); return; }
        const root = path.join(panelDir, 'vendor');
        const target = path.resolve(root, rel);
        // 目录穿越防护
        if (!target.startsWith(root + path.sep)) { send(null, res, 403, 'text/plain; charset=utf-8', 'Forbidden'); return; }
        const ext = path.extname(target).toLowerCase();
        try {
          const buf = fs.readFileSync(target);
          send(null, res, 200, PANEL_MIME[ext] ?? 'application/octet-stream', buf);
        } catch {
          send(null, res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
      });

      route({ kind: 'exact', path: '/whale-mind/panel' }, async (req, res) => panelFile(res, 'shell.html', 'text/html; charset=utf-8'));
      route({ kind: 'exact', path: '/whale-mind/panel/brain' }, async (req, res) => panelFile(res, 'brain.html', 'text/html; charset=utf-8'));
      // /ring 出「记忆星环」改造版（build-ring-memory.mjs 生成），原版留在 /ring-original。
      // 这样已经在跑的 DSH 不用重启也能看到改造版 —— 路由表没变，只是换了读哪个文件。
      route({ kind: 'exact', path: '/whale-mind/panel/ring' }, async (req, res) => panelFile(res, 'ring-memory.html', 'text/html; charset=utf-8'));
      route({ kind: 'exact', path: '/whale-mind/panel/ring-memory' }, async (req, res) => panelFile(res, 'ring-memory.html', 'text/html; charset=utf-8'));
      route({ kind: 'exact', path: '/whale-mind/panel/ring-original' }, async (req, res) => panelFile(res, 'ring.html', 'text/html; charset=utf-8'));
      route({ kind: 'exact', path: '/whale-mind/panel/galaxy' }, async (req, res) => panelFile(res, 'galaxy.html', 'text/html; charset=utf-8'));
      route({ kind: 'exact', path: '/whale-mind/panel/memory.json' }, async (req, res) => panelFile(res, 'memory.json', 'application/json; charset=utf-8'));
      // 记忆星脑 API：真实 store 数据 → 8 大分区神经元图谱
      // 大飞鱼（dsh-dafeiyu-dot）记忆宫殿以**只读**方式并入：合并进同一个 graph，
      // 节点带 source:'dafeiyu' 供面板区分。绝不反写宫殿——它的可信度模型要求逐字原文证据。
      const mergedEntries = () => {
        const own = store.active();
        const { entries: dye } = readDafeiyuEntries();
        return own.concat(dye);
      };
      const brainGraph = () => panelGraph(mergedEntries());
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/graph' }, async (req, res) => panelJson(res, brainGraph()));
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/health' }, async (req, res) => panelJson(res, { ok: true, empty: false, nodes: brainGraph().nodes.length }));
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/stats' }, async (req, res) => panelJson(res, panelStats(brainGraph())));
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/events' }, async (req, res) => panelJson(res, panelEvents(mergedEntries().slice().sort((a, b) => (b.updated_at ?? b.created_at ?? 0) - (a.updated_at ?? a.created_at ?? 0)))));
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/bus' }, async (req, res) => panelJson(res, panelBus(brainGraph())));
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/nebula' }, async (req, res) => panelJson(res, { theme: {}, follows: {} }));

      // 大飞鱼联动状态：面板用来决定「要不要显示这个来源」以及「为什么是空的」
      // diagnostics 直接把「配置缺失 / 未切鲸鱼娘模式」这类原因说清楚，
      // 不然用户只会看到一个空的 0 条。
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/bridge' }, async (req, res) => {
        const status = bridgeStatus();
        const { entries, error } = readDafeiyuEntries();
        const hints = [];
        if (!status.available) hints.push('没找到大飞鱼的数据目录，插件可能没装或从没启动过。');
        else if (!status.hasConfig) hints.push('大飞鱼从未保存过设置：在 DSH 里打开插件设置，选一个会话切到「鲸鱼娘模式」并保存。');
        else if (!status.sessionBound) hints.push('大飞鱼还没绑定 QQ 会话：设置里选一个会话，QQ 才会启用。');
        else if (status.total === 0) hints.push('宫殿是空的：切到鲸鱼娘模式后和它聊几句，它才会用 dafeiyu_memory_save 落事实。');
        json(res, {
          ok: true,
          ...status,
          mirrored: entries.length,
          error,
          hints,
          jobs: readDafeiyuJobs(),
        });
      });
      // 宫殿 → 星脑：**真写入**（不是只画在图里的只读合并）
      // 之前 bridge 只在 brainGraph() 里 concat，等于「看得见、摸不着」：清单里没有、
      // 检索不到、注入也不带它。这里做成一次可点、可复算的导入：
      //   按 id 去重（宫殿条目 id 是 dy_<原 id>），只导入 active 且未墓碑的，
      //   写入时保留 source:'dafeiyu'，方便日后区分来源、也能单独清掉。
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/sync-palace' }, async (req, res) => {
        const { entries, error } = readDafeiyuEntries();
        if (error) { json(res, { ok: false, error }); return; }
        const existing = new Set(store.active().map((e) => e.id));
        let imported = 0;
        const skipped = [];
        for (const e of entries) {
          if (existing.has(e.id)) { skipped.push(e.id); continue; }
          try { store.add(e); imported++; } catch (err) { skipped.push(e.id + '(' + err.message + ')'); }
        }
        if (imported) { injectionCache.clear(); }
        json(res, { ok: true, imported, skipped: skipped.length, total: entries.length });
      });

      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/memories' }, async (req, res) => {
        const url = new URL(req?.url ?? '/', 'http://dsh.invalid');
        const body = await readBody(req);
        const q = url.searchParams.get('q') ?? body.q ?? '';
        const region = url.searchParams.get('region') ?? body.region ?? '';
        const status = url.searchParams.get('status') ?? body.status ?? '';
        panelJson(res, panelSearch(brainGraph(), { q, region, status }));
      });
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/memory/touch', method: 'POST' }, async (req, res) => panelJson(res, { ok: true }));
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/memory', method: 'POST' }, async (req, res) => panelJson(res, { ok: true }));
      route({ kind: 'exact', path: '/whale-mind/panel/brain/api/plugin/action', method: 'POST' }, async (req, res) => panelJson(res, { ok: true }));

      // ---- 管理 API（面板可增删导出焚毁，全部落真实 store） ----
      route({ kind: 'exact', path: '/whale-mind/panel/manager' }, async (req, res) => panelFile(res, 'manager.html', 'text/html; charset=utf-8'));
      route({ kind: 'exact', path: '/whale-mind/note', method: 'POST' }, async (req, res) => {
        const body = await readBody(req);
        const text = sanitizeForStorage(String(body.text ?? '').slice(0, 500));
        if (!text) { json(res, { ok: false, error: 'text required' }); return; }
        const now = new Date();
        const e = store.add({ id: store.newId(now), date: undefined, text, tags: ['note'], kind: 'note',
          salience: 0.9, resolved: null, session: 'panel', created_at: now.getTime(), updated_at: now.getTime(),
          entities: [], source: 'panel' });
        injectionCache.clear();
        json(res, { ok: true, id: e.id });
      });
      route({ kind: 'exact', path: '/whale-mind/forget', method: 'POST' }, async (req, res) => {
        const body = await readBody(req);
        const id = String(body.id ?? '');
        if (!id) { json(res, { ok: false, error: 'id required' }); return; }
        store.del(id);
        injectionCache.clear();
        json(res, { ok: true, deleted: id });
      });
      route({ kind: 'exact', path: '/whale-mind/burn', method: 'POST' }, async (req, res) => {
        const body = await readBody(req);
        if (body.confirm !== true) { json(res, { ok: false, error: '需要 confirm:true' }); return; }
        const removed = burn(cfg.dataDir);
        injectionCache.clear();
        json(res, { ok: true, removed });
      });
      route({ kind: 'exact', path: '/whale-mind/flush', method: 'POST' }, async (req, res) => { queue.flush(); json(res, { ok: true }); });
      log('面板路由已注册（/whale-mind/*，星脑 API 走真实 store）');
    });
  } catch (err) { log('webServer 服务缺失，面板路由停用（headless 正常）：' + err.message); }

  // ---- 工具：AI 自己主动记一条（当场落盘，不进带外队列——feiyu §17.10） ----
  // ⚠️ 必须用 ctx.inject(['tools'], ...)：cordis 里未 inject 的服务**取属性就会 throw**，
  //    写成 `ctx.tools?.register?.(...)` 连 `?.` 都挡不住（真机日志已复现）。
  try {
    ctx.inject(['tools'], (scope) => {
      scope.tools.register({
        name: 'whale_mind_note',
        description: '把你的判断或想对后面的自己说的话写进鲸鱼娘的长期记忆（当场生效，无需格式）',
        parameterSchemaSpecToJsonSchema_output: {
          type: 'object',
          properties: { text: { type: 'string', description: '要记住的内容（第一人称，一句话即可）' } },
          required: ['text']
        },
        handler: async ({ text }) => {
          const masked = sanitizeForStorage(String(text || '').slice(0, 500));
          const now = new Date();
          const e = store.add({
            id: store.newId(now), date: undefined, text: masked, tags: ['note'], kind: 'note',
            salience: 0.9, resolved: null, session: 'tool', created_at: now.getTime(), updated_at: now.getTime(),
            entities: [], source: 'tool'
          });
          injectionCache.clear();
          return '已记下 #' + e.id;
        }
      });
      log('工具 whale_mind_note 已注册');
    });
  } catch (err) { log('tools 服务缺失，note 工具停用：' + err.message); }

  // ---- 对外能力（供 CLI/路由调用） ----
  return {
    store,
    queue,
    burn() { const removed = burn(cfg.dataDir); injectionCache.clear(); log('🔥 已焚毁：' + removed.join('、')); return removed; },
    flush: () => queue.flush(),
    config: cfg
  };
}
