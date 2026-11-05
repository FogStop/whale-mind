// whale-mind · tidy.mjs (M2.5, 夜间自整理)
// 借鉴 dsh-living-memory（每晚巡逻自整理）+ feiyu §4 第3级「睡眠」批处理：
// 去重合并（bigram 相似度 > highSim 的同 kind 条目 → 保留最早、salience 取 max、tags 并集）
// 真删被合并者（墓碑），绝不静默。
import { bigrams } from './index.js';

function similarity(a, b) {
  const A = new Set(bigrams(a));
  const B = bigrams(b);
  if (!B.length) return 0;
  const hit = B.filter(x => A.has(x)).length;
  return hit / B.length;
}

/**
 * @returns {{ kept: object[], tombstoneIds: string[], report: string[] }}
 */
export function tidy(entries, cfg = {}) {
  const highSim = cfg.highSim ?? 0.5;
  const sorted = [...entries].sort((a, b) => a.created_at - b.created_at);
  const kept = [];
  const tombstoneIds = [];
  const report = [];
  for (const e of sorted) {
    const twin = kept.find(k =>
      (k.kind === e.kind || k.kind === 'chat' || e.kind === 'chat') &&
      similarity(k.summary || k.text, e.summary || e.text) > highSim
    );
    if (twin) {
      twin.salience = Math.max(twin.salience ?? 0, e.salience ?? 0);
      twin.updated_at = Math.max(twin.updated_at ?? 0, e.updated_at ?? 0);
      twin.tags = [...new Set([...(twin.tags || []), ...(e.tags || [])])];
      tombstoneIds.push(e.id);
      report.push(`合并 ${e.id} → ${twin.id}（salience ↑ ${twin.salience.toFixed(2)}）`);
    } else {
      kept.push(e);
    }
  }
  return { kept, tombstoneIds, report };
}
