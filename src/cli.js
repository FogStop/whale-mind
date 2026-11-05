// whale-mind · cli.js (v2)
// 交互演示：node src/cli.js            → REPL
//           node src/cli.js --demo     → 剧本式演示（离线，0 次 API 调用）
//           node src/cli.js --selftest → 自检
import readline from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { gate, localJudge } from './gate.js';
import { consolidate } from './consolidate.js';
import { buildIndex, search, extractEntities } from './index.js';
import { decayedSalience, isCold, ageDays, daysKnown } from './decay.js';
import { buildInjection, estimateTokens } from './inject.js';
import { sanitizeForStorage, burn } from './privacy.mjs';
import { ensureHandnote, readHandNotes, handnotePath } from './handnote.mjs';
import { tidy } from './tidy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'whale-mind.config.json'), 'utf8'));
const store = new Store(path.resolve(ROOT, CONFIG.dataDir));
ensureHandnote(store.dataDir); // 手记.md：人手写的地方，插件只读

const fmtDate = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }; // 自然日，本地时区（feiyu §17.8：全项目一把尺子）
const recentPenaltyMap = new Map(); // 本会话内"刚提过"的惩罚（M2 接真实轮次）
let turnNo = 0;

/** 拆分活跃记忆：note（我自己想的）与其他（最近的事候选） */
function splitEntries(entries) {
  const notes = entries.filter(e => e.kind === 'note').sort((a, b) => b.updated_at - a.updated_at);
  const others = entries.filter(e => e.kind !== 'note').sort((a, b) => b.updated_at - a.updated_at);
  return { notes, others };
}

/** 组装当前完整注入（预览用） */
function currentInjection(now = new Date()) {
  const entries = store.active();
  const { notes, others } = splitEntries(entries);
  const idx = buildIndex(others);
  const recalled = search(others, idx, '', { ...CONFIG, wander: false }, now, { recentPenaltyMap });
  return buildInjection(
    { recent: others, notes, recalled, relationship: store.relationship(), daysKnown: daysKnown(entries, now), handNotes: readHandNotes(store.dataDir) },
    CONFIG, now
  );
}

/** 对一句话走完整管线：门控 → 固化 → 应用（日记/关系/forget）→ 召回 */
async function handleChat(text, now = new Date(), cfg = CONFIG) {
  turnNo++;
  const justWritten = new Set(); // 当轮刚写入的属于「最近的事」，不进"突然想起来"
  const g = await gate(text, cfg, readHandNotes(store.dataDir));
  if (!g.keep) { console.log(`  ⏭ 不记：${g.reason}${g.suppressed ? '（用户控制）' : ''}`); }
  else {
    const c = await consolidate(text, cfg, now);
    if (c.skip) { console.log(`  ⏭ 固化器跳过：${c.reason}`); }
    else {
      const e = store.add({
        id: store.newId(now), date: undefined, text: sanitizeForStorage(c.diary.text), tags: c.diary.tags,
        kind: c.diary.kind, salience: c.diary.salience, resolved: c.diary.resolved,
        session: 'cli', created_at: now.getTime(), updated_at: now.getTime(),
        entities: extractEntities(text), source: g.via === 'llm' ? 'chat-llm' : 'chat-local'
      });
      justWritten.add(e.id);
      recentPenaltyMap.set(e.id, turnNo);
      const rel = store.relationship();
      if (c.relationship?.nickname) { rel.nickname = c.relationship.nickname; }
      rel.familiarity = Math.min(1, (rel.familiarity ?? 0) + (c.relationship?.familiarityDelta ?? 0));
      rel.last_reinforced = now.toISOString();
      store.saveRelationship(rel);
      for (const id of c.forget) store.del(id);
      console.log(`  ✍ 记忆已写入 #${e.id}  kind=${e.kind}  salience=${e.salience}  依据：${g.reason}`);
    }
  }
  const entries = store.active();
  const idx = buildIndex(entries);
  const recalled = search(entries, idx, text, cfg, now, { recentPenaltyMap }).filter(r => !justWritten.has(r.entry.id));
  console.log('鲸鱼娘（演示回复）：' + (recalled.length ? '嗯嗯，我记得呢～' : '好哒～我在听。'));
  for (const r of recalled) {
    recentPenaltyMap.set(r.entry.id, turnNo);
    console.log(`  🔎 突然想起来 [${fmtDate(r.entry.created_at)}] ${r.entry.summary ?? r.entry.text.slice(0, 18)}…  score ${r.score}（sim ${r.sim}）`);
  }
  if (!recalled.length) {
    const recentCount = entries.filter(e => e.kind !== 'note').length;
    if (recentCount) console.log(`  📖 「最近的事」在场（${recentCount} 条每轮必注入），无需召回即可使用`);
    else console.log('  🔎 本次召回：无（绝不猜）');
  }
}

function printStats(now = new Date()) {
  const all = store.load();
  const act = all.filter(e => !e.deleted);
  const cold = act.filter(e => isCold(e, CONFIG, now));
  const ents = {};
  for (const e of act) for (const x of (e.entities || [])) ents[x] = (ents[x] || 0) + 1;
  const topEnts = Object.entries(ents).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  记忆总量 ${all.length} 条（活跃 ${act.length} / 冷存储 ${cold.length}）· 认识 ${daysKnown(act, now)} 天`);
  if (act.length) {
    const oldest = act.reduce((a, b) => ageDays(a, now) > ageDays(b, now) ? a : b);
    console.log(`  最老记忆：${fmtDate(oldest.created_at)} "${oldest.summary.slice(0, 18)}"（${ageDays(oldest, now).toFixed(1)} 天，衰减后 ${decayedSalience(oldest, CONFIG, now).toFixed(2)}）`);
  }
  if (topEnts.length) console.log('  高频实体（图谱数据桥）：' + topEnts.map(([k, v]) => `${k}×${v}`).join('、'));
}

function previewInjection(now = new Date()) {
  const inj = currentInjection(now);
  console.log(`  新会话注入预览：${inj.usedTokens} / ${CONFIG.budgetTokens} token${inj.dropped.length ? '（裁掉：' + inj.dropped.join('、') + '）' : ''}`);
  for (const l of inj.text.split('\n')) console.log('  | ' + l);
}

async function demo() {
  const now = new Date();
  const demoCfg = { ...CONFIG, wander: false }; // 演示走确定性路径（拟人随机关掉）
  console.log('══ whale-mind M1 演示（离线：本地门控+本地固化，0 次 API 调用）══\n');
  console.log('▶ 场景1：主人说了三句话');
  for (const t of [
    '我叫老王，我养了只橘猫叫包子，它上周做了绝育',
    '我最讨厌香菜',
    '今天天气真不错啊'
  ]) { console.log('\n你：' + t); await handleChat(t, now, demoCfg); }

  console.log('\n▶ 场景2：新开会话（注入预览）');
  previewInjection(now);

  console.log('\n▶ 场景3：新会话里被问到旧事（跨会话召回）');
  await handleChat('你还记得我吗？我的猫叫什么来着？', now, demoCfg);

  console.log('\n▶ 场景4：遗忘（/忘 香菜）');
  doForget('香菜');
  console.log('  删除后列表：');
  for (const e of store.active()) console.log(`  #${e.id} [${e.kind}] ${e.summary ?? e.text.slice(0, 16)}`);

  console.log('\n▶ 场景5：记忆库体检（/脑）');
  printStats(now);
  console.log('\n══ 演示结束。数据目录：' + store.dataDir + ' ══');
}

function doSearch(q) {
  const entries = store.active();
  const idx = buildIndex(entries);
  const r = search(entries, idx, q, { ...CONFIG, wander: false });
  if (!r.length) { console.log('  无相关记忆（绝不猜）'); return; }
  for (const x of r) console.log(`  [${fmtDate(x.entry.created_at)}] ${x.entry.text.slice(0, 24)}…  score ${x.score}（sim ${x.sim}）`);
}

function doForget(q) {
  const act = store.active();
  const targets = act.filter(e => e.id === q || (e.text || '').includes(q) || (e.tags || []).includes(q));
  if (!targets.length) { console.log('  没找到匹配的记忆'); return; }
  for (const e of targets) { store.del(e.id); console.log(`  🗑 已删除 #${e.id}（墓碑落 manifest，真删）`); }
}

async function selftest() {
  const tmp = path.join(ROOT, 'data', 'selftest-' + Date.now());
  const s = new Store(tmp);
  const now = new Date();
  const mk = (id, daysAgo, salience, summary, kind = 'chat') => s.add({
    id, date: undefined, text: 't:' + summary, tags: ['琐事'], kind, salience,
    resolved: null, session: 't', created_at: now.getTime() - daysAgo * 86400000,
    updated_at: now.getTime() - daysAgo * 86400000, entities: /猫|包子/.test(summary) ? ['老王', '包子'] : [], source: 't'
  });
  mk('t1', 0, 0.9, '我叫老王，养了橘猫包子');
  mk('t2', 0, 0.6, '讨厌香菜');
  s.del('t2');
  ok(s.active().length === 1 && s.active()[0].id === 't1', '墓碑删除生效');

  const entries = s.active();
  const idx = buildIndex(entries);
  const r = search(entries, idx, '橘猫包子还好吗', { ...CONFIG, wander: false }, now, {});
  ok(r.length && r[0].entry.id === 't1', 'bigram+实体 召回命中 t1');

  mk('t3', 100, 0.55, '记录了别的项目进度');
  const none = search(s.active(), buildIndex(s.active()), '股票行情', { ...CONFIG, wander: false }, now, {});
  ok(!none.some(x => x.entry.id === 't3'), '冷存储+无相似 → 不可见（低显著不硬凑）');

  const floorCase = { id: 'd', created_at: now.getTime() - 60 * 86400000, updated_at: now.getTime() - 60 * 86400000, salience: 0.9 };
  ok(decayedSalience(floorCase, CONFIG, now) === (CONFIG.salienceFloor ?? 0.16), '60 天衰减被 0.16 下限托住（遗忘=降级）');

  ok(!localJudge('你好').keep, '寒暄跳过');
  ok(!localJudge('你还记得我吗？我的猫叫什么来着？').keep, '提问跳过');
  ok(localJudge('我叫老王').keep, '自我介绍默认记（不对称代价）');

  const fat = Array.from({ length: 5 }, (_, i) => ({ id: 'n' + i, updated_at: now.getTime() - i * 60000, created_at: now.getTime(), kind: 'note', text: '判断'.repeat(40), summary: '', tags: [], entities: [] }));
  const inj = buildInjection({ recent: [], notes: fat, recalled: [], relationship: null, daysKnown: 1 }, { ...CONFIG, budgetTokens: 120 }, now);
  ok(inj.usedTokens <= 120, `预算裁剪生效（${inj.usedTokens} ≤ 120，裁掉：${inj.dropped.join('、') || '无'}）`);
  ok(inj.text.includes('这是你的记忆'), '身份声明帧永不裁剪');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(process.exitCode ? 'SELFTEST FAILED' : 'SELFTEST PASS');
}
function ok(cond, msg) { if (!cond) { console.error('  FAIL: ' + msg); process.exitCode = 1; } else console.log('  ok - ' + msg); }

async function repl() {
  console.log('whale-mind M1 交互模式（数据目录：' + store.dataDir + '）');
  console.log('命令：/记 <文字>  /找 <关键词>  /列表  /忘 <id|关键词>  /整理  /焚毁  /手记  /脑  /导出  /新会话  /帮助  /退出');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    const line = (await rl.question('你> ')).trim();
    if (!line) continue;
    if (line === '/退出' || line === '/exit' || line === '/q') { console.log('鲸鱼娘：再见～（记忆已保存）'); rl.close(); return; }
    if (line === '/帮助' || line === '/help') { console.log('直接打字=聊天；/记 强制记录；/找 检索；/列表；/忘 删除；/脑 体检；/导出；/新会话 注入预览'); continue; }
    if (line.startsWith('/记 ')) {
      const t = line.slice(3).trim();
      const e = store.add({
        id: store.newId(), date: undefined, text: '主人让我记住：「' + t.slice(0, 120) + '」。', tags: ['琐事'],
        kind: 'chat', salience: 0.85, resolved: null, session: 'cli', created_at: Date.now(), updated_at: Date.now(),
        entities: extractEntities(t), source: 'manual'
      });
      console.log(`  ✍ 强制记录 #${e.id}：${e.text.slice(0, 30)}…`);
      continue;
    }
    if (line.startsWith('/找 ')) { doSearch(line.slice(3).trim()); continue; }
    if (line === '/列表') {
      const act = store.active().sort((a, b) => b.updated_at - a.updated_at);
      if (!act.length) { console.log('  （空）'); continue; }
      for (const e of act) console.log(`  #${e.id} [${e.kind}] ${e.text.slice(0, 26)}…  salience=${e.salience}`);
      continue;
    }
    if (line.startsWith('/忘 ')) { doForget(line.slice(3).trim()); continue; }
    if (line === '/整理') {
      const r = tidy(store.active(), CONFIG);
      for (const id of r.tombstoneIds) store.del(id);
      console.log(r.report.length ? '  🌙 自整理完成：\n' + r.report.map(x => '   - ' + x).join('\n') : '  🌙 自整理完成：没有需要合并的条目');
      continue;
    }
    if (line === '/焚毁') {
      const removed = burn(store.dataDir);
      injectionCache.clear?.();
      console.log('  🔥 已焚毁全部记忆（不可恢复）：' + (removed.join('、') || '（空）'));
      continue;
    }
    if (line === '/手记') {
      console.log('  手记路径：' + handnotePath(store.dataDir));
      const notes = readHandNotes(store.dataDir);
      console.log(notes.length ? notes.map(x => '  - ' + x).join('\n') : '  （还没有手记，用记事本打开上面路径，追加 "- " 开头的行）');
      continue;
    }
    if (line === '/脑') { printStats(); continue; }
    if (line === '/导出') {
      const outDir = path.join(store.dataDir, 'export');
      fs.mkdirSync(outDir, { recursive: true });
      const md = '# 鲸鱼娘日记导出\n\n' + store.active().sort((a, b) => a.created_at - b.created_at)
        .map(e => `- [${fmtDate(e.created_at)}] (${e.kind}) ${e.text}`).join('\n');
      const f = path.join(outDir, '日记.md');
      fs.writeFileSync(f, md, 'utf8');
      console.log('  已导出：' + f);
      continue;
    }
    if (line === '/新会话') { previewInjection(); continue; }
    await handleChat(line);
  }
}

const arg = process.argv[2];
if (arg === '--demo') await demo();
else if (arg === '--selftest') await selftest();
else await repl();
