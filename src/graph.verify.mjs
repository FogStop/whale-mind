// 验证：大飞鱼条目合并后，星脑 graph 的分区/节点正确
import { buildGraph, statsFor } from '../panel/brain-data.mjs';

const dyeEntries = [
  { id: 'dy_1', text: '用户 · 阿岚 · 称呼：阿岚', summary: '称呼：阿岚', tags: ['人物'], kind: 'note',
    salience: 0.72, entities: [], source: 'dafeiyu', created_at: Date.now() - 86400000, updated_at: Date.now() },
  { id: 'dy_2', text: '共同经历 · 辰光科技 · 面试：周三下午两点', summary: '面试：周三下午两点', tags: ['事件'], kind: 'win',
    salience: 0.58, entities: ['辰光科技'], source: 'dafeiyu', created_at: Date.now() - 172800000, updated_at: Date.now() - 3600000 },
];
const localEntries = [
  { id: 'wm_1', text: '主人喜欢深夜写代码', summary: '喜欢深夜写代码', tags: ['偏好'], kind: 'disclosure',
    salience: 0.7, entities: [], source: 'local', created_at: Date.now(), updated_at: Date.now() },
];

const graph = buildGraph(localEntries.concat(dyeEntries));
const mem = graph.nodes.filter((n) => n.kind === 'memory');

console.log('=== 节点 ===');
for (const n of mem) {
  console.log(`  ${n.id}  region=${n.region}  level=${n.level}  source=${n.source}  immune=${n.immune}`);
}

const st = statsFor(graph);
console.log('\n=== 分区统计 ===');
console.log(JSON.stringify(st.by_region, null, 2));

const checks = [
  ['大飞鱼 owner 条目落在 soul 区', mem.find((n) => n.id === 'dy_1')?.region === 'soul'],
  ['大飞鱼 self 条目落在 review 区', mem.find((n) => n.id === 'dy_2')?.region === 'review'],
  ['本插件条目 source=local', mem.find((n) => n.id === 'wm_1')?.source === 'local'],
  ['大飞鱼条目 source=dafeiyu', mem.filter((n) => n.source === 'dafeiyu').length === 2],
  // buildGraph 自带 3 条 RULES 规则节点（也是 kind:memory / level:rules），
  // 所以这里只数「非规则」的记忆节点，才是真正的三条用户记忆。
  ['三条记忆节点全在', mem.filter((n) => n.level !== 'rules').length === 3],
  // 核心节点不能被镜像抢走：soul 只有一个节点且来自 dafeiyu 时，应回落而不是让它当核心
  ['核心节点不被大飞鱼抢走', !(graph.links.some((l) => l.type === 'proj' && l.a === 'dy_1'))],
];
let bad = 0;
for (const [label, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) bad++; }
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
