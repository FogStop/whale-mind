// whale-mind · index.js (v2, 按 feiyu recall.mjs 校准)
// 检索打分：score = a·sim + b·salience + c·fresh − d·最近刚提过的惩罚
// sim = 1 − exp(−Σgain / saturation)   ← 饱和函数，与查询长度解耦（feiyu §17 对 §3 的修改）
// 中相似 + 高 salience → softmax 按温度随机抽（刻意保留的拟人感）；低 → 不触发
// 无命中就返回空，绝不猜（feiyu："认不出就返回空"）

import { decayedSalience } from './decay.js';

const WORD = /[\u4e00-\u9fa5A-Za-z0-9]/;

export function bigrams(text) {
  const t = String(text || '').toLowerCase();
  const out = [];
  for (let i = 0; i < t.length - 1; i++) {
    if (WORD.test(t[i]) && WORD.test(t[i + 1])) out.push(t[i] + t[i + 1]);
  }
  return out;
}

export function extractEntities(text) {
  const t = String(text || '');
  const out = new Set();
  for (const m of t.matchAll(/(?:我叫|我是|名字[是叫]|取名叫|叫)\s*([\u4e00-\u9fa5A-Za-z0-9]{1,10})/g)) out.add(m[1]);
  for (const m of t.matchAll(/[“"『「]([^”"』」]{1,12})[”"』」]/g)) out.add(m[1]);
  return [...out].slice(0, 6);
}

export function buildIndex(entries) {
  const idx = new Map();
  for (const e of entries) {
    const hay = (e.summary || '') + ' ' + (e.text || '').slice(0, 120) + ' ' + (e.entities || []).join(' ');
    for (const g of new Set(bigrams(hay))) {
      if (!idx.has(g)) idx.set(g, new Set());
      idx.get(g).add(e.id);
    }
  }
  return idx;
}

const DEFAULTS = {
  a: 0.40,      // 相似度权重
  b: 0.45,      // salience 权重（feiyu recall.mjs:240 默认 0.45）
  c: 0.15,      // 新鲜度权重
  d: 0.15,      // 最近刚提过的惩罚
  saturation: 3, // 饱和函数 τ
  highSim: 0.8,  // 必触发
  midSim: 0.25,  // 中相似下限
  recallSalience: 0.5, // 随机池的最低 salience（feiyu recall.mjs:237；注意≠固化质量门 minSalience）
  topK: 3,
  wanderChance: 0.08
};

export function search(entries, idx, query, cfg = {}, now = new Date(), opts = {}) {
  const o = { ...DEFAULTS, ...cfg, ...opts };
  const qg = bigrams(query);
  const hayBigrams = new Map();
  for (const e of entries) hayBigrams.set(e.id, new Set(bigrams((e.summary || '') + ' ' + (e.entities || []).join(' '))));

  const scored = [];
  for (const e of entries) {
    const ds = decayedSalience(e, cfg, now);
    const matched = qg.length ? [...new Set(qg)].filter(g => hayBigrams.get(e.id)?.has(g)).length : 0;
    const sim = qg.length ? 1 - Math.exp(-matched / o.saturation) : 0;
    const entityBonus = (e.entities || []).some(x => query.includes(x)) ? 0.25 : 0;
    const simEff = Math.min(1, sim + entityBonus); // 实体命中计入有效相似度（门控/必触发/打分统一用它）
    if (qg.length && sim < o.midSim && ds < o.recallSalience) continue; // 双低不触发
    const fresh = Math.max(0, 1 - (now.getTime() - e.updated_at) / (30 * 86400000));
    const penalty = opts.recentPenaltyMap?.has(e.id) ? o.d : 0;
    const score = o.a * simEff + o.b * ds + o.c * fresh - penalty;
    scored.push({ entry: e, sim: +simEff.toFixed(3), score: +score.toFixed(3), decayed: +ds.toFixed(3), must: simEff >= o.highSim });
  }
  scored.sort((x, y) => y.score - x.score);

  // 分流：高相似必触发；中相似取最优（wander 骰子命中时按 softmax 温度随机抽，拟人感可关）
  const out = scored.filter(s => s.must).slice(0, o.topK);
  const mid = scored.filter(s => !s.must && (s.sim >= o.midSim || (!qg.length && !out.some(x => x.entry.id === s.entry.id))));
  if (out.length < o.topK && mid.length) {
    let pick = mid[0];
    if (o.wander !== false && Math.random() < (o.wanderChance ?? 0.08)) {
      const t = 0.35;
      const exps = mid.map(it => Math.exp((it.score - mid[0].score) / t));
      pick = weightedPick(mid, exps);
    }
    if (pick && !out.some(x => x.entry.id === pick.entry.id)) out.push(pick);
  }
  return out.slice(0, o.topK);
}

function weightedPick(items, exps) {
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) { r -= exps[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
