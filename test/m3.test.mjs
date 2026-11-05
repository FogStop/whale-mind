// whale-mind · M2.5/M3 测试（node --test test/m3.test.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHandNotes, HANDNOTE_TEMPLATE } from '../src/handnote.mjs';
import { tidy } from '../src/tidy.mjs';

test('handnote: 围栏里的说明不会被当成手记（feiyu 踩过的坑）', () => {
  const md = HANDNOTE_TEMPLATE + '\n- 我不喜欢在饭点被打扰\n- 提到"包子"指的是我的猫\n';
  const notes = parseHandNotes(md);
  assert.deepEqual(notes, ['我不喜欢在饭点被打扰', '提到"包子"指的是我的猫']);
});

test('handnote: * 和 + 开头不收，只认 "- "', () => {
  const notes = parseHandNotes('* 星号不收\n+ 加号不收\n- 减号收');
  assert.deepEqual(notes, ['减号收']);
});

test('tidy: 相似条目合并，salience 取 max，被合并者进墓碑', () => {
  const now = Date.now();
  const entries = [
    { id: 'a', created_at: now - 3000, updated_at: now - 3000, kind: 'chat', salience: 0.5, summary: '我叫老王，养了橘猫包子', text: '', tags: ['琐事'] },
    { id: 'b', created_at: now - 2000, updated_at: now - 2000, kind: 'chat', salience: 0.8, summary: '我叫老王，家里养了橘猫叫包子', text: '', tags: ['宠物'] },
    { id: 'c', created_at: now - 1000, updated_at: now - 1000, kind: 'chat', salience: 0.6, summary: '明天要去面试', text: '', tags: ['琐事'] }
  ];
  const r = tidy(entries, { highSim: 0.5 });
  assert.deepEqual(r.tombstoneIds, ['b']);
  const a = r.kept.find(e => e.id === 'a');
  assert.equal(a.salience, 0.8); // 取 max
  assert.ok(a.tags.includes('琐事') && a.tags.includes('宠物')); // tags 并集
  assert.ok(r.kept.some(e => e.id === 'c')); // 无关条目保留
});
