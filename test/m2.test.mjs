// M2 冒烟测试（node --test test/m2.test.mjs）
// 按 feiyu §18 的方法论：用假 ctx 把"插件 × 生命周期"的交界先在本地压一遍，
// 真实 DSH 端到端验证在 M2 收尾时做（feiyu：纯逻辑单测保证算得对，端到端保证活得下去）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apply } from '../src/plugin.mjs';
import { hardBlock, burn } from '../src/privacy.mjs';
import { OutOfBandQueue } from '../src/queue.mjs';
import { buildInjection, estimateTokens } from '../src/inject.js';

test('privacy: 密钥/手机号/身份证 硬拦，正常文本不误伤', () => {
  const t1 = hardBlock('我的 key 是 sk-abcdef1234567890abcdef 帮我保存');
  assert.ok(!t1.text.includes('sk-abcdef'));
  assert.ok(t1.hits >= 1);
  const t2 = hardBlock('他手机号 13812345678');
  assert.ok(!t2.text.includes('13812345678'));
  assert.ok(t2.text.includes('一个联系方式'));
  const t3 = hardBlock('身份证 110101199003077758');
  assert.ok(!t3.text.includes('19900307'));
  const clean = hardBlock('今天和老王聊了包子的绝育');
  assert.equal(clean.hits, 0);
});

test('privacy: 一键焚毁清空目录', () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'wm-burn-'));
  fs.writeFileSync(path.join(dir, 'entries.jsonl'), '{"op":"add"}\n');
  fs.mkdirSync(path.join(dir, 'diary'));
  fs.writeFileSync(path.join(dir, 'diary', '2026-11.jsonl'), '{}\n');
  const removed = burn(dir).sort();
  assert.deepEqual(removed, ['diary', 'entries.jsonl']);
  assert.equal(fs.readdirSync(dir).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('queue: flush 超时必须大于 job 超时（feiyu §17.6 问题2）', () => {
  assert.throws(() => new OutOfBandQueue({ jobTimeoutMs: 60000, flushTimeoutMs: 20000 }));
});

test('queue: 任务带外执行（push 不同步跑，feiyu §18 问题2）', async () => {
  const q = new OutOfBandQueue();
  let ran = false;
  q.push(async () => { ran = true; });
  assert.equal(ran, false); // setImmediate 脱栈：push 返回时还没执行
  await q.flush();
  assert.equal(ran, true);
  assert.equal(q.pending, 0);
});

test('inject: 身份声明帧永不裁剪（feiyu §17.9 有专测，从 200 逐档验）', () => {
  for (const budget of [200, 500, 2000]) {
    const fat = Array.from({ length: 6 }, (_, i) => ({ id: 'n' + i, updated_at: Date.now() - i * 60000, created_at: Date.now(), kind: 'note', text: '判断'.repeat(60) }));
    const inj = buildInjection({ recent: [], notes: fat, recalled: [], relationship: null, daysKnown: 3 }, { budgetTokens: budget }, new Date());
    assert.ok(inj.usedTokens <= budget, `预算 ${budget}：实际 ${inj.usedTokens}`);
    assert.ok(inj.text.includes('这是你的记忆'), `预算 ${budget}：身份帧保留`);
  }
});

test('plugin smoke: 假 ctx 走通 事件→队列→存储→section→路由', async () => {
  const tmp = fs.mkdtempSync(path.join(process.cwd(), 'wm-smoke-'));
  const handlers = {}; const sections = []; const routes = []; const tools = [];
  const ctx = {
    handlers, sections, routes, tools,
    on(ev, fn) { (handlers[ev] ??= []).push(fn); },
    inject(targets, fn) {
      if (targets.includes('webServer')) fn({ webServer: { register: r => routes.push(r) } });
      if (targets.includes('systemPrompt')) fn({ systemPrompt: { section: s => sections.push(s) } });
    },
    tools: { register: t => tools.push(t) }
  };
  apply(ctx, { dataDir: tmp, llm: { enabled: false } });

  assert.ok(handlers['session/event'] && handlers['agent/turn-stopping'] && handlers['agent/created']);
  assert.equal(routes.filter(r => r.path.startsWith('/whale-mind/')).length, 3);
  assert.ok(tools.some(t => t.name === 'whale_mind_note'));

  // 走一轮真实生命周期
  handlers['session/event'][0]({ sessionId: 's1', role: 'user', text: '我叫老王，我养了只橘猫叫包子' });
  const fakeAgent = {
    id: 's1',
    ctx: {
      inject: (t, fn) => { if (t.includes('systemPrompt')) fn({ systemPrompt: { section: s => sections.push(s) } }); },
      on: (ev, fn) => { (handlers[ev] ??= []).push(fn); }
    }
  };
  handlers['agent/created'][0](fakeAgent);
  const section = sections.at(-1);
  assert.equal(section.name, 'whale-mind');
  assert.equal(section.order, 100);
  assert.equal(section.interpolate, false);

  handlers['agent/turn-stopping'][0](fakeAgent);
  await new Promise(r => setTimeout(r, 30)); // 带外队列消化

  const stateRoute = routes.find(r => r.path === '/whale-mind/state');
  const state = JSON.parse((await stateRoute.handler()).body);
  assert.equal(state.ok, true);
  assert.equal(state.count, 1);

  const text = section.text();
  assert.ok(text.includes('这是你的记忆'), 'section 文本含身份声明帧');
  assert.ok(text.includes('最近的事'), 'section 文本含「最近的事」段');

  // section 的 text() 每次求值（feiyu：text 可以是每次 assemble 重新求值的函数）
  const again = section.text();
  assert.equal(typeof again, 'string');

  // forget 路由真删
  const forgetRoute = routes.find(r => r.path === '/whale-mind/forget');
  const del = JSON.parse((await forgetRoute.handler({ body: JSON.stringify({ id: state.recent[0].id }) })).body);
  assert.equal(del.ok, true);
  const state2 = JSON.parse((await stateRoute.handler()).body);
  assert.equal(state2.count, 0);

  fs.rmSync(tmp, { recursive: true, force: true });
});
