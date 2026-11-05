// whale-mind 面板 · 独立预览服务（DSH 插件的同款路由，脱离 DSH 也能跑）
//   node panel/server.mjs   →  http://127.0.0.1:4180/
// 路由与 src/plugin.mjs 里注册的 /whale-mind/panel/* 完全一致：
//   /whale-mind/panel            → 三板切换壳
//   /whale-mind/panel/brain      → 记忆星脑（+ /brain/api/* 数据接口）
//   /whale-mind/panel/ring       → 神经星环（原版 agent-display）
//   /whale-mind/panel/galaxy     → 记忆银河（小克模板 + whale-mind memory.json）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildGraph, searchMemories, statsFor, eventsFor, busFor } from './brain-data.mjs';
import { Store } from '../src/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4180);

// ---- 真实 diary 优先 ----
// 数据目录优先级：WHALE_MIND_DATA_DIR > ~/.dsh/whale-mind（与 DSH 插件同一份数据）
const dataDir = process.env.WHALE_MIND_DATA_DIR || path.join(os.homedir(), '.dsh', 'whale-mind');
let store = null;
let realCount = 0;
try {
  store = new Store(dataDir);
  realCount = store.active().length;
} catch (err) {
  console.warn('[whale-mind panel] 读取真实 diary 失败：', err?.message ?? err);
}
const usingReal = realCount > 0;

// 兜底演示条目（只有真实 diary 为空时才用，避免"打开是空白"）
const demoEntries = [
  { id: 'wm-1', text: '主人叫老王。第一次见面他就把名字告诉我了。', kind: 'disclosure', salience: 0.92, entities: ['老王'], created_at: Date.now() - 22 * 86400000 },
  { id: 'wm-2', text: '主人养了只橘猫叫包子，上周刚做了绝育。', kind: 'disclosure', salience: 0.88, entities: ['包子'], created_at: Date.now() - 22 * 86400000 },
  { id: 'wm-3', text: '主人最讨厌香菜，闻到就走开。', kind: 'chat', salience: 0.62, entities: ['香菜'], created_at: Date.now() - 20 * 86400000 },
  { id: 'wm-4', text: '包子的疫苗本放在抽屉第二层，每月 15 号打针。', kind: 'chat', salience: 0.66, entities: ['包子'], created_at: Date.now() - 12 * 86400000 },
  { id: 'wm-5', text: '主人面试通过了，公司叫辰光科技。他说请我吃白饭。', kind: 'win', salience: 0.81, entities: ['面试'], created_at: Date.now() - 7 * 86400000 },
  { id: 'wm-6', text: '主人答应请我吃白饭，还说周末补上。', kind: 'plan', salience: 0.6, entities: ['白饭'], created_at: Date.now() - 5 * 86400000 },
  { id: 'wm-7', text: '主人加班到很晚才理我，我有点委屈，但他道了歉。', kind: 'grievance', salience: 0.71, entities: [], created_at: Date.now() - 2 * 86400000 },
  { id: 'wm-8', text: '主人说我是他聊过最记得住事的 AI。', kind: 'win', salience: 0.77, entities: [], created_at: Date.now() - 1 * 86400000 },
  { id: 'wm-9', text: '手记：深夜写代码的人不需要道理，需要一盏不用他关的灯。', kind: 'note', salience: 0.66, entities: [], created_at: Date.now() - 10 * 86400000 },
  { id: 'wm-10', text: '手记：紧张说明在乎。把在乎写在纸上，它就不会变成害怕。', kind: 'note', salience: 0.6, entities: [], created_at: Date.now() - 12 * 86400000 },
];
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => b += c);
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

// 当前条目源：真实 diary 优先，空则演示；写操作后调 reload() 重建图
let entries = usingReal ? store.active() : demoEntries.slice();
let graph = buildGraph(entries);
function reload() {
  if (usingReal) {
    try { entries = store.active(); } catch (err) { console.warn('[whale-mind panel] reload 失败：', err?.message ?? err); }
  }
  graph = buildGraph(entries);
  return graph;
}
console.log(`[whale-mind panel] diary = ${dataDir}`);
console.log(`[whale-mind panel] 真实记忆 ${realCount} 条${usingReal ? '（已启用真实数据）' : '（为空 → 暂用演示数据）'}`);

const read = (p) => fs.readFileSync(path.join(here, p));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const json = (body) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const file = (rel, type) => {
    try {
      res.writeHead(200, { 'content-type': type });
      res.end(read(rel));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  };

  if (p === '/whale-mind/panel' || p === '/whale-mind/panel/') return file('shell.html', MIME['.html']);
  if (p === '/whale-mind/panel/brain' || p === '/whale-mind/panel/brain/') return file('brain.html', MIME['.html']);
  // 记忆星环：build-ring-memory.mjs 从 ring.html 生成，只改了 NEURAL 主题。
  // /ring 直接出改造版（这样已在跑的 DSH 不重启也能立刻看到），原版留在 /ring-original 随时对比。
  if (p === '/whale-mind/panel/ring' || p === '/whale-mind/panel/ring-memory') return file('ring-memory.html', MIME['.html']);
  if (p === '/whale-mind/panel/ring-original') return file('ring.html', MIME['.html']);
  if (p === '/whale-mind/panel/galaxy') return file('galaxy.html', MIME['.html']);
  if (p === '/whale-mind/panel/memory.json') return json(JSON.parse(read('memory.json')));
  // ---- 管理 API（独立模式：可变内存 store；DSH 模式：plugin.mjs 走真实 store） ----
  if (p === '/whale-mind/state') {
    reload();
    const recent = entries.slice(-40).reverse();
    return json({ ok: true, usingReal, count: entries.length, recent,
      notes: entries.filter((e) => e.kind === 'note'),
      injection: { tokens: entries.slice(-12).reduce((n, e) => n + Math.ceil(String(e.text || '').length * 0.75), 60) },
      queue: { pending: 0 },
      dataDir: usingReal ? dataDir : 'demo（真实 diary 为空，暂用演示数据）' });
  }
  if (p === '/whale-mind/panel/manager') return file('manager.html', MIME['.html']);
  if (p === '/whale-mind/note' && req.method === 'POST') {
    let body = {}; try { body = JSON.parse(await readBody(req)); } catch {}
    const text = String(body.text ?? '').slice(0, 500);
    if (!text) return json({ ok: false, error: 'text required' });
    if (usingReal) {
      const now = new Date();
      const e = store.add({ id: store.newId(now), text, kind: 'note', salience: 0.9,
        tags: ['手记'], entities: [], session: 'panel', source: 'panel', created_at: now.getTime() });
      reload();
      return json({ ok: true, id: e.id, persisted: true, count: entries.length });
    }
    entries.unshift({ id: `wm-note-${Date.now()}`, text, kind: 'note', salience: 0.9,
      entities: [], created_at: Date.now(), session: 'panel' });
    reload();
    return json({ ok: true, id: entries[0].id, persisted: false });
  }
  if (p === '/whale-mind/forget' && req.method === 'POST') {
    let body = {}; try { body = JSON.parse(await readBody(req)); } catch {}
    const id = String(body.id ?? '');
    if (usingReal) {
      store.del(id);
      reload();
      return json({ ok: true, deleted: id, persisted: true, count: entries.length });
    }
    const i = entries.findIndex((e) => e.id === id);
    if (i >= 0) entries.splice(i, 1);
    reload();
    return json({ ok: i >= 0, deleted: id });
  }
  if (p === '/whale-mind/export') { reload(); return json({ ok: true, usingReal, dataDir: usingReal ? dataDir : 'demo', entries }); }
  if (p === '/whale-mind/burn' && req.method === 'POST') {
    let body = {}; try { body = JSON.parse(await readBody(req)); } catch {}
    if (body.confirm !== true) return json({ ok: false, error: '需要 confirm:true' });
    if (usingReal) {
      return json({ ok: false, error: `真实记忆模式下拒绝一键焚毁（${entries.length} 条）。要删某条用 forget，要清空请直接处理 ${dataDir}\\diary 目录并备份。` });
    }
    const n = entries.length; entries.length = 0; reload();
    return json({ ok: true, removed: [`demo:${n} 条`] });
  }
  if (p === '/whale-mind/flush' && req.method === 'POST') return json({ ok: true });
  if (p.startsWith('/whale-mind/panel/vendor/')) {
    const rel = p.replace('/whale-mind/panel/vendor/', '');
    const file = path.resolve(here, 'vendor', rel);
    if (!file.startsWith(path.resolve(here, 'vendor') + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  if (p === '/whale-mind/panel/brain/api/graph') { reload(); return json(graph); }
  // 独立预览模式下没有 QQ 桥接，但 brain.html 是 Promise.all([graph, bridge, events]) 一起拉的，
  // 少这一条会让整批失败、记忆事件列表永远是空的。给个真实来源标记的空壳。
  if (p === '/whale-mind/panel/brain/api/bridge') return json({ ok: true, demo: !usingReal, usingReal, mirrored: 0, state: {}, dataDir: usingReal ? dataDir : null });
  if (p === '/whale-mind/panel/brain/api/health') return json({ ok: true, usingReal, empty: entries.length === 0, nodes: graph.nodes.length, entries: entries.length });
  if (p === '/whale-mind/panel/brain/api/stats') { reload(); return json(statsFor(graph)); }
  if (p === '/whale-mind/panel/brain/api/events') { reload(); return json(eventsFor(entries)); }
  if (p === '/whale-mind/panel/brain/api/bus') { reload(); return json(busFor(graph)); }
  if (p === '/whale-mind/panel/brain/api/nebula') return json({ theme: {}, follows: {} });
  if (p.startsWith('/whale-mind/panel/brain/api/memories')) {
    reload();
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const region = url.searchParams.get('region') || '';
    const status = url.searchParams.get('status') || '';
    return json(searchMemories(graph, { q, region, status }));
  }
  if (req.method === 'POST' && p.startsWith('/whale-mind/panel/brain/api/')) return json({ ok: true });
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[whale-mind panel] http://127.0.0.1:${port}/whale-mind/panel  [${usingReal ? '真实 diary' : '演示数据'}]`);
});
