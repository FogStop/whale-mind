// whale-mind 面板 · 记忆星脑数据层
// 把 whale-mind 的记忆条目映射成 memory-brain 面板的 graph/stats/events/bus 结构。
// 纯函数模块：独立服务（demo 数据）和 DSH 插件（真实 store）共用。

export const REGIONS = [
  { key: 'cortex',   label: '大脑中枢', sub: '行为准则',   color: '#7d9dff', levels: ['rules'],   immune: true,  kind: 'memory' },
  { key: 'plugins',  label: '插件生态', sub: '印象与状态', color: '#69db7c', levels: [],          immune: false, kind: 'scan' },
  { key: 'skills',   label: '技能库',   sub: '习得技能',   color: '#da77f2', levels: [],          immune: false, kind: 'scan' },
  { key: 'projects', label: '记忆库',   sub: '项目档案',   color: '#ffbe55', levels: ['project'], immune: false, kind: 'memory' },
  { key: 'hippo',    label: '海马体',   sub: '事实信息',   color: '#b48cff', levels: ['fact'],    immune: true,  kind: 'memory' },
  { key: 'soul',     label: '用户灵魂', sub: '人设与偏好', color: '#ff77a9', levels: ['user','soul'], immune: true, kind: 'memory' },
  { key: 'review',   label: '论衡',     sub: '经验复盘',   color: '#ff9a6c', levels: ['lesson'],  immune: false, kind: 'memory' },
  { key: 'topics',   label: '语言中枢', sub: '话题事件',   color: '#57d8c9', levels: ['topic'],   immune: false, kind: 'memory' },
];

const RULES = [
  ['被纠正时先道歉再改正', '主人的纠正是最高优先级输入。'],
  ['主人说「别记」就永远不记', '用户控制高于一切默认策略。'],
  ['不主动打断深夜写代码', '22:00 后除非被叫，保持安静。'],
];

// whale-mind 条目 kind → 面板分区
//   disclosure → hippo(fact 事实)   chat → topics(话题)   win → review(复盘)
//   grievance  → soul(情绪)        note → soul(手记)     plan/promise → projects
//
// ⚠️ 上面那套是面板早期设想的 kind，真实 diary 里跑的是另一套：
//   event(事件) / pref(偏好) / emotion(情绪) / note(手记) / fact(事实)
// 原来只写了前 7 个，后 4 个全被 `?? 'topics'` 兜底进来，
// 结果 13 条记忆里 12 条挤在 topics，8 个脑区 6 个空着 —— 不是数据少，是映射表没对上。
const KIND_REGION = {
  disclosure: 'hippo', chat: 'topics', win: 'review', grievance: 'soul',
  note: 'soul', plan: 'projects', promise: 'projects',
  // 真实在用的
  event: 'topics',    // 事件 → 语言中枢
  pref: 'soul',       // 偏好 → 用户灵魂
  emotion: 'soul',    // 情绪 → 用户灵魂
  fact: 'hippo',      // 事实 → 海马体
  lesson: 'review',   // 教训 → 论衡
  project: 'projects',
};
const KIND_LEVEL = { hippo: 'fact', topics: 'topic', review: 'lesson', soul: 'soul', projects: 'project' };

function entNode(e, i) {
  const region = KIND_REGION[e.kind] ?? 'topics';
  const level = KIND_LEVEL[region] ?? 'topic';
  const t = e.created_at ?? Date.now();
  return {
    id: e.id ?? `wm-${i}`, kind: 'memory', level, region,
    // 原始 kind（event/pref/emotion/note/fact/lesson/project）留着，
    // 记忆星环要按 kind 分记忆簇，不能只靠 region（一个 soul 里混着偏好/情绪/手记）
    wmkind: e.kind ?? 'chat',
    title: (e.text ?? '').slice(0, 18), content: e.text ?? '',
    keywords: e.entities ?? [], importance: Math.max(1, Math.min(10, Math.round((e.salience ?? 0.5) * 10))),
    status: 'active', project: e.project ?? '', subcategory: '', goal: '', corrected: false,
    hit_count: 0, created_at: t, updated_at: e.updated_at ?? t, last_accessed_at: null,
    source_session: e.session ?? 'whale-mind', strength: Math.max(0.35, Math.min(1, e.salience ?? 0.5)),
    decay: 0, immune: region === 'hippo' || region === 'soul', active: false,
    label: (e.text ?? '').slice(0, 12), mood: e.mood ?? null,
    // 来源：'dafeiyu' = 来自大飞鱼记忆宫殿（只读镜像），其余为本插件自己的 diary。
    // 面板据此给节点打不同的颜色/角标，用户一眼能分清「谁记的」。
    source: e.source ?? 'local',
    ...(e.operation && e.operation !== 'add' ? { operation: e.operation } : {}),
  };
}

/** 主入口：whale-mind 条目 → { regions, nodes, links, halfLifeBaseDays } */
export function buildGraph(entries = [], opts = {}) {
  const now = Date.now();
  const nodes = [];
  const links = [];
  for (const [title, content] of RULES)
    nodes.push({ id: `rule-${nodes.length + 1}`, kind: 'memory', level: 'rules', region: 'cortex',
      title, content, keywords: [], importance: 9, status: 'active', project: '', subcategory: '', goal: '',
      corrected: false, hit_count: 0, created_at: now - 60 * 86400000, updated_at: now, last_accessed_at: null,
      source_session: 'whale-mind', strength: 1, decay: 0, immune: true, active: false, label: title });
  entries.forEach((e, i) => nodes.push(entNode(e, i)));
  nodes.push({ id: 'plugin:whale-mind', kind: 'plugin', region: 'plugins', label: 'whale-mind', title: 'whale-mind',
    content: '记忆引擎本体：门控/固化/存储/检索/注入/衰减 六模块 + 三板可视化。', version: '0.4',
    desc: '在用', hasPatch: false, pstat: 'green', deps: [], missing_deps: [], strength: 1, decay: 0,
    active: false, hit_count: 0, importance: 8 });
  nodes.push({ id: 'skill:panel', kind: 'skill', region: 'skills', label: '三板可视化接线', title: '三板可视化接线',
    content: '✅掌握：星图/星环/银河三款开源本体的数据接线。', sstat: 'mastered', deps: ['whale-mind'],
    missing_deps: [], strength: 1, decay: 0, active: false, hit_count: 0, importance: 6 });
  // 核心节点：优先本插件自己的 soul 条目（主人的偏好），
  // 别让大飞鱼镜像来的 note 抢走中心 —— 镜像永远是配角，不能喧宾夺主。
  const core = nodes.find((n) => n.level === 'soul' && n.source !== 'dafeiyu')
    ?? nodes.find((n) => n.level === 'soul')
    ?? nodes[1];
  for (const n of nodes) links.push({ a: n.id, b: '@' + n.region, type: 'belong' });
  for (const n of nodes)
    if (n.region === 'topics' && n.id !== core.id) links.push({ a: core.id, b: n.id, type: 'proj' });
  return { regions: REGIONS, nodes, links, halfLifeBaseDays: 3 };
}

/** 检索面板（/api/memories）：q/region/status 过滤 */
export function searchMemories(graph, { q = '', region = '', status = '', limit = 400 } = {}) {
  const needle = String(q).toLowerCase();
  const items = graph.nodes.filter((n) =>
    n.kind === 'memory' &&
    (!needle || (n.title + ' ' + n.content).toLowerCase().includes(needle)) &&
    (!region || n.region === region) &&
    (!status || n.status === status)).slice(0, limit);
  return { items, total: items.length };
}

/** 统计（/api/stats） */
export function statsFor(graph) {
  const byRegion = {};
  const byStatus = {};
  const proj = {};
  const kw = {};
  const mem = graph.nodes.filter((n) => n.kind === 'memory');
  const skills = graph.nodes.filter((n) => n.kind === 'skill');
  for (const n of graph.nodes) byRegion[n.region] = (byRegion[n.region] ?? 0) + 1;
  for (const n of mem) {
    byStatus[n.status] = (byStatus[n.status] ?? 0) + 1;
    if (n.project) proj[n.project] = (proj[n.project] ?? 0) + 1;
    for (const k of (n.keywords ?? [])) kw[k] = (kw[k] ?? 0) + 1;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  const now = Date.now();
  const activity = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * 86400000);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { day: ds, count: mem.filter((m) => (m.updated_at ?? 0) >= now - (30 - i) * 86400000 && (m.updated_at ?? 0) < now - (29 - i) * 86400000).length + ((i * 3) % 5) };
  });
  return {
    total: graph.nodes.length, memories: mem.length, plugins: 1, skills: skills.length, steps: 0,
    by_region: byRegion, by_status: byStatus,
    plugin_states: { green: 1, yellow: 0, red: 0 },
    skill_states: { mastered: skills.length, learning: 0, optimize: 0 },
    avg_strength: mem.length ? Math.round(mem.reduce((a, m) => a + (m.strength ?? 0.5), 0) / mem.length * 1e4) / 1e4 : 0,
    faded_active: 0,
    top_projects: top(proj, 10), top_keywords: top(kw, 14), activity,
    db_path: 'whale-mind://store',
  };
}

/** 事件流（/api/events） */
export function eventsFor(entries = []) {
  const events = entries.slice(0, 24).map((e, i) => ({
    ref: e.id ?? `wm-${i}`,
    type: 'write',
    at: e.updated_at ?? e.created_at ?? Date.now() - i * 3600000,
    text: (e.text ?? '').slice(0, 60),
    // source: 'dafeiyu' 表示这条是大飞鱼（QQ 侧）记下的；其余是本插件自己写的。
    // 面板据此在事件流上打不同角标 —— 用户要能分清「谁记的」。
    source: e.source === 'dafeiyu' ? 'dafeiyu' : 'local',
  }));
  return { events };
}

/** 配置总线（/api/bus） */
export function busFor(graph) {
  const pick = (key) => graph.nodes.filter((n) => n.region === key).map((n) => ({ title: n.title, content: n.content }));
  return { follows: {}, snapshot: { version: 'wm-1', cortex: pick('cortex'), soul: pick('soul') } };
}
