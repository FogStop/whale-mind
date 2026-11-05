// whale-mind · decay.js (v2, 按 feiyu SPEC §1.1 校准)
// 遗忘 = 降级，不是删除：每日 salience *= decayRate(0.9)，但有 salienceFloor(0.16) 托底。
// 低于冷存储阈值 → 移出默认注入，但 recall 仍可命中（"平时想不起来，提一句又想起来了"）。

export function ageDays(entry, now = new Date()) {
  const t = entry.updated_at ?? entry.created_at ?? now.getTime();
  return Math.max(0, (now.getTime() - t) / 86400000);
}

export function decayedSalience(entry, cfg = {}, now = new Date()) {
  const rate = cfg.decayRate ?? 0.9;
  const floor = cfg.salienceFloor ?? 0.16;
  return Math.max(floor, (entry.salience ?? 0.5) * Math.pow(rate, ageDays(entry, now)));
}

/** 冷存储：不在"突然想起来"候选池里出现（仍可被 feiyu_recall 类兜底命中） */
export function isCold(entry, cfg = {}, now = new Date()) {
  return decayedSalience(entry, cfg, now) < (cfg.coldThreshold ?? 0.45);
}

/** 认识天数：按自然日算，全项目只此一把尺子（feiyu §17.8 的教训：三把尺子会打架） */
export function daysKnown(entries, now = new Date()) {
  if (!entries.length) return 0;
  const first = entries.reduce((a, b) => (a.created_at < b.created_at ? a : b));
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(first.created_at); b.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((a - b) / 86400000));
}
