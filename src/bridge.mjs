// whale-mind · bridge.mjs — 大飞鱼（dsh-dafeiyu-dot）记忆宫殿的**只读**镜像
//
// 为什么要只读：
//   大飞鱼的 dafeiyu_memory_save 要求 evidence 是「当前回合用户消息里逐字连续的原文」，
//   写入时还会重新校验消息没变过。它的可信度模型建立在「每条事实都能回溯到原话」上。
//   whale-mind 的条目是二次概括（summary ≤24 字），塞进宫殿会污染这个模型。
//   → 所以这里单向：宫殿 → 星脑。绝不反向写。
//
// 读什么：
//   <DSH_HOME>/dsh-dafeiyu-dot/memories.json          主库（memories 数组）
//   <DSH_HOME>/dsh-dafeiyu-dot/memory-palace/.state/state.json   墓碑 / 任务队列
//
// 映射（宫殿 space → 星脑 region）：
//   owner「我眼里的主人」→ soul（用户灵魂 / 人设与偏好）
//   self「鲸鱼娘自己的」 → review（论衡 / 经验复盘）
//
// 坑：
//   - memories.json 是 JsonStore 原子写（先写 .tmp 再 rename），读到一半不会撕裂，但也**可能读到旧值**
//   - 记录里有 status: 'active' | 'superseded'，superseded 是被更正的旧版本，不进星脑
//   - testOnly 记录是测试数据，不进星脑
//   - tombstone（墓碑）里的 id 必须排除，否则「忘掉的」会复活

import fs from 'node:fs';
import path from 'node:path';

export const DAFEIYU_DIR = () =>
  path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '~', '.dsh'), 'dsh-dafeiyu-dot');

/** 宫殿分区 → 星脑分区。刻意不写死中文，用 id。 */
const SPACE_REGION = { owner: 'soul', self: 'review' };
const SPACE_KIND = { owner: 'note', self: 'win' };

function readJsonSafe(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

/** 大飞鱼是否装了 / 数据目录是否存在。面板据此决定要不要显示这个来源。 */
export function bridgeStatus(root = DAFEIYU_DIR()) {
  const memFile = path.join(root, 'memories.json');
  const palace = path.join(root, 'memory-palace');
  const cfgFile = path.join(root, 'config.json');
  const cfg = readJsonSafe(cfgFile, null);
  const data = readJsonSafe(memFile, null);
  const memories = Array.isArray(data?.memories) ? data.memories : [];
  return {
    available: fs.existsSync(memFile),
    root,
    hasConfig: fs.existsSync(cfgFile),
    memoryEnabled: cfg?.memory?.enabled !== false,
    qqEnabled: cfg?.qq?.enabled === true,
    sessionBound: typeof cfg?.qq?.sessionId === 'string' && cfg.qq.sessionId !== '',
    palaceExists: fs.existsSync(palace),
    total: memories.length,
    active: memories.filter((m) => m.status === 'active' && !m.testOnly).length,
  };
}

/** 墓碑 id 集合（遗忘过的，不能复活） */
function loadTombstones(root) {
  const state = readJsonSafe(path.join(root, 'memory-palace', '.state', 'state.json'), {});
  const out = new Set();
  for (const t of state.tombstones ?? []) {
    if (t && typeof t.id === 'string') out.add(t.id);
  }
  return out;
}

/** 一条宫殿记录 → whale-mind 条目（对齐 store.js 的 normalizeEntry 字段） */
function toEntry(rec, idx) {
  const content = String(rec.content ?? '').trim();
  const pred = String(rec.predicate ?? '').trim();
  const val = String(rec.value ?? '').trim();
  // summary 走「属性：值」，比整句更适合当索引（store.js 注释：summary 从来不进上下文）
  const summary = (pred && val ? `${pred}：${val}` : content).slice(0, 24);
  const at = Date.parse(rec.updatedAt ?? rec.createdAt ?? '');
  return {
    id: `dy_${rec.id ?? idx}`,
    date: Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    text: content,
    summary,
    tags: Array.isArray(rec.tags) && rec.tags.length ? rec.tags.slice(0, 6) : ['大飞鱼'],
    kind: SPACE_KIND[rec.spaceId] ?? 'chat',
    // 重要性：被更正的旧版本降权；刚更新的加权。宫殿没有 salience 概念，用时间+确认度拟合
    salience: rec.confirmed === true ? 0.72 : 0.58,
    resolved: null,
    session: 'dafeiyu',
    created_at: Number.isFinite(Date.parse(rec.createdAt ?? '')) ? Date.parse(rec.createdAt) : Date.now(),
    updated_at: Number.isFinite(at) ? at : Date.now(),
    entities: [rec.entity, rec.scope].filter((x) => typeof x === 'string' && x.trim()),
    source: 'dafeiyu',           // ← 星脑据此画出来源标识
    operation: rec.operation ?? 'add',
    supersededBy: rec.supersededBy ?? null,
    deleted: false,
  };
}

/**
 * 拉取宫殿里全部「当前有效」记录，转成 whale-mind 条目。
 * 不抛异常：大飞鱼没装 / 文件坏 / 无权限，一律返回空数组 + 原因，面板照常显示自己那部分。
 */
export function readDafeiyuEntries(root = DAFEIYU_DIR()) {
  const memFile = path.join(root, 'memories.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(memFile, 'utf8'));
  } catch (err) {
    return { entries: [], error: err.code === 'ENOENT' ? null : String(err.message || err) };
  }
  const all = Array.isArray(data?.memories) ? data.memories : [];
  const tombs = loadTombstones(root);
  const out = [];
  for (const [i, rec] of all.entries()) {
    if (!rec || typeof rec !== 'object') continue;
    if (rec.status !== 'active') continue;       // superseded / 已更正
    if (rec.testOnly === true) continue;         // 测试数据
    if (typeof rec.id === 'string' && tombs.has(rec.id)) continue; // 已遗忘
    if (!String(rec.content ?? '').trim()) continue;
    out.push(toEntry(rec, i));
  }
  // 新的在前，星脑事件流按这个顺序铺
  out.sort((a, b) => b.updated_at - a.updated_at);
  return { entries: out, error: null };
}

/** 宫殿工作日志：从 .state/state.json 的 jobs 里取最近的处理任务 */
export function readDafeiyuJobs(root = DAFEIYU_DIR(), limit = 20) {
  const state = readJsonSafe(path.join(root, 'memory-palace', '.state', 'state.json'), {});
  const jobs = Array.isArray(state.jobs) ? state.jobs : [];
  return jobs
    .map((j) => {
      const at = Date.parse(j.updatedAt ?? j.createdAt ?? '');
      return {
        id: String(j.id ?? ''),
        status: String(j.status ?? ''),
        at: Number.isFinite(at) ? at : 0,
        text: String(j.reason ?? j.summary ?? j.kind ?? '记忆整理').slice(0, 40),
      };
    })
    .filter((j) => j.at > 0)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
