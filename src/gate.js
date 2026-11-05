// whale-mind · gate.js (v2, 按 feiyu judge.mjs 设计校准)
//
// feiyu 把"关键词闸门"拆掉了，理由是三个结构性洞：
//   1) 看不到没命中的话（不是判错，是没判）
//   2) 假阳性（"我其实不太饿"命中 /我其实/）
//   3) 判据写死在写表人的先验里，永远补不全
// 错误代价不对称：漏记一条永久没了且你不知道少了什么；多记一条能删能降级。
// → 门控用一次极短模型调用（judge，~24 输出 token），认不出格式就【默认记】。
//
// whale-mind 差异：本地规则判断仅作为【离线兜底】保留（M1 demo 无 API Key 时用），
// 开启 llm.enabled 后即切到模型判断——这一点与 feiyu"彻底拆掉正则"不同，见学习笔记。

/** 用户控制，不是启发式：同步跳过，不问模型 */
export const SUPPRESS_RE = /别记|不要记|别存|不用记|忘掉这个|删除记忆/;

/** 判断提示词：三条听法是通用判据（措辞受 feiyu 启发，已改写；见 NOTICE） */
export const JUDGE_SYSTEM = `你是这只鲸鱼娘的记性。

我会给你一句用户刚说的话。你判断：这句话值不值得留给下一个你？

看这三条，别按"有没有情绪""重不重要"来判——那两把尺子太窄：

1. 任务会催你，日子不会催你。没有催你的那一句，反而更值得停一下。
2. 他讲得越随便，越可能压了很久。笑着说出来的，常常比哭着重。
3. 判据是「他说完这句，你对他的了解有没有变一点」。变了一点，就记。

反过来，这些不用记：
- 寒暄、确认、指令（"帮我打开一下"）
- 一句套话、一句吐槽天气
- 只是把已经知道的事又说了一遍

只回答一行，格式：
  yes <不超过15字的理由>
  或
  no <不超过15字的理由>

不要解释，不要 markdown。`;

export const JUDGE_MAX_TOKENS = 24;

/** 宽容优先：认不出格式 → 默认记（漏的代价比多的大） */
export function parseVerdict(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { keep: true, why: '模型没答，按默认记', parsed: false };
  const line = text.split('\n')[0].trim();
  const m = /^(yes|no|不要|别记|要|记|是|不)[\s，,、:：-]*(.*)$/i.exec(line);
  if (m) {
    const keep = ['yes', '是', '记', '要'].includes(m[1].toLowerCase());
    return { keep, why: (m[2] ?? '').trim().slice(0, 40), parsed: true };
  }
  if (/^no\b|^不需要|^不值得/i.test(line)) return { keep: false, why: line.slice(0, 40), parsed: false };
  return { keep: true, why: `认不出格式，按默认记：${line.slice(0, 30)}`, parsed: false };
}

export function buildJudgeInput(input = {}) {
  const said = String(input.lastUserText ?? '').trim();
  const notes = (Array.isArray(input.handNotes) ? input.handNotes : [])
    .filter(n => typeof n === 'string' && n.trim() !== '')
    .map(n => `- ${n.trim()}`);
  const system = notes.length ? `${JUDGE_SYSTEM}\n\n── 补充：这个用户自己说过的话（也算判据）──\n${notes.join('\n')}` : JUDGE_SYSTEM;
  return { system, user: said };
}

export async function judge(text, cfg = {}, handNotes = []) {
  const key = process.env[cfg.llm?.apiKeyEnv || 'DEEPSEEK_API_KEY'];
  if (!key) return null;
  const base = cfg.llm?.baseUrl || 'https://api.deepseek.com';
  const { system, user } = buildJudgeInput({ lastUserText: text, handNotes });
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: cfg.llm?.model || 'deepseek-chat', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: JUDGE_MAX_TOKENS, temperature: 0.1 })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return parseVerdict(data.choices?.[0]?.message?.content);
}

/**
 * 离线兜底（仅 M1 demo 用）：feiyu 明确拆掉了正则闸门；
 * 我们保留它但只做两件事——拦明显寒暄/吐槽天气，其余一律默认记（不对称代价）。
 */
export function localJudge(text) {
  const t = String(text || '').trim();
  if (t.length < 2) return { keep: false, why: '太短' };
  if (/^(你好|您好|hi|hello|嗨|在吗|哈+|嘿+|嗯+|哦+|噢+|早安|晚安|谢谢|辛苦了)[!！。.~～\s]*$/i.test(t)) return { keep: false, why: '寒暄' };
  if (/(今天|昨天)?(天气|温度)(真|好|不错|可以)/.test(t)) return { keep: false, why: '吐槽天气' };
  const isQuestion = /[?？]\s*$/.test(t) || /(吗|呢|么)\s*[?？!！。]?\s*$/.test(t);
  const wantsMemory = /(?:帮我记|记住|别忘了)/.test(t);
  if (isQuestion && !wantsMemory) return { keep: false, why: '提问，不记录' };
  return { keep: true, why: '默认记（离线兜底）' };
}

export async function gate(text, cfg = {}, handNotes = []) {
  if (SUPPRESS_RE.test(text)) return { keep: false, reason: '用户要求别记', suppressed: true };
  if (cfg.llm?.enabled) {
    try {
      const j = await judge(text, cfg, handNotes);
      if (j) return { keep: j.keep, reason: j.why, via: 'llm' };
    } catch { /* 降级优先：判断失败默认记（走本地兜底） */ }
  }
  const lf = localJudge(text);
  return { keep: lf.keep, reason: lf.why, via: 'local' };
}
