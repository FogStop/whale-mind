// 用一条**严格按 MemoryStore._record 字段形状**构造的记录，验证解析链路。
// 不碰真实数据目录：写到临时目录，跑完删。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bridgeStatus, readDafeiyuEntries } from './bridge.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-bridge-'));
fs.mkdirSync(path.join(tmp, 'memory-palace', '.state'), { recursive: true });

const memFile = path.join(tmp, 'memories.json');
const now = new Date().toISOString();

// 字段形状来自 memory.js _record()：id/spaceId/content/subject/entity/scope/predicate/value/
// operation/tags/status/createdAt/updatedAt/confirmed/testOnly/supersedes/supersededBy
fs.writeFileSync(
  memFile,
  JSON.stringify(
    {
      version: 2,
      imports: [],
      jobs: [],
      memories: [
        {
          id: 'real-1', spaceId: 'owner', content: '用户 · 阿岚 · 称呼：阿岚',
          subject: '用户', entity: '', scope: '', predicate: '称呼', value: '阿岚',
          operation: 'add', tags: ['人物'], status: 'active', confirmed: true,
          createdAt: '2026-10-01T10:00:00.000Z', updatedAt: now, testOnly: false,
        },
        {
          id: 'real-2', spaceId: 'self', content: '共同经历 · 辰光科技 · 面试：周三下午两点',
          subject: '共同经历', entity: '辰光科技', scope: '', predicate: '面试', value: '周三下午两点',
          operation: 'add', tags: ['事件'], status: 'active', confirmed: false,
          createdAt: '2026-10-02T08:00:00.000Z', updatedAt: now, testOnly: false,
        },
        // 以下三条**必须被排除**，用来证明过滤逻辑没错
        {
          id: 'old-1', spaceId: 'owner', content: '用户 · 称呼：老王',
          subject: '用户', entity: '', scope: '', predicate: '称呼', value: '老王',
          operation: 'update', tags: [], status: 'superseded', confirmed: true,
          createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
          supersededBy: 'real-1', testOnly: false,
        },
        {
          id: 'test-1', spaceId: 'owner', content: '测试口令：忘掉这个词',
          subject: '用户', entity: '', scope: '', predicate: '口令', value: '忘掉这个词',
          operation: 'add', tags: [], status: 'active', confirmed: true,
          createdAt: now, updatedAt: now, testOnly: true,
        },
        {
          id: 'gone-1', spaceId: 'owner', content: '用户 · 旧密码：123',
          subject: '用户', entity: '', scope: '', predicate: '旧密码', value: '123',
          operation: 'add', tags: [], status: 'active', confirmed: true,
          createdAt: now, updatedAt: now, testOnly: false,
        },
      ],
    },
    null,
    2
  )
);

// gone-1 进墓碑（模拟被「忘记」过）
fs.writeFileSync(
  path.join(tmp, 'memory-palace', '.state', 'state.json'),
  JSON.stringify({ version: 2, imports: [], jobs: [
    { id: 'job-1', status: 'done', kind: '整理', createdAt: now, updatedAt: now },
  ], tombstones: [{ id: 'gone-1', deletedAt: now }], migratedLegacy: true }, null, 2)
);

const st = bridgeStatus(tmp);
console.log('=== status ===');
console.log(JSON.stringify(st, null, 2));

const { entries, error } = readDafeiyuEntries(tmp);
console.log('\n=== entries ===', entries.length, 'error:', error);
for (const e of entries) {
  console.log(`  [${e.source}] ${e.id} kind=${e.kind} region? salience=${e.salience}`);
  console.log(`     summary=${e.summary}`);
  console.log(`     text=${e.text}`);
  console.log(`     entities=${JSON.stringify(e.entities)} tags=${JSON.stringify(e.tags)}`);
}

console.log('\n=== 断言 ===');
const ids = entries.map((e) => e.id);
const checks = [
  ['保留 real-1', ids.includes('dy_real-1')],
  ['保留 real-2', ids.includes('dy_real-2')],
  ['排除 superseded(old-1)', !ids.includes('dy_old-1')],
  ['排除 testOnly(test-1)', !ids.includes('dy_test-1')],
  ['排除墓碑(gone-1)', !ids.includes('dy_gone-1')],
  ['source 标记为大飞鱼', entries.every((e) => e.source === 'dafeiyu')],
  ['owner→note(灵魂区)', entries.find((e) => e.id === 'dy_real-1')?.kind === 'note'],
  ['self→win(论衡区)', entries.find((e) => e.id === 'dy_real-2')?.kind === 'win'],
  ['summary 走属性：值', entries.find((e) => e.id === 'dy_real-1')?.summary === '称呼：阿岚'],
];
let bad = 0;
for (const [label, ok] of checks) {
  console.log((ok ? '  PASS ' : '  FAIL ') + label);
  if (!ok) bad++;
}
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad === 0 ? 0 : 1);
