// whale-mind · consolidate.js (v2, 按 feiyu consolidate.mjs 校准)
// 固化：一次模型调用同时产出「日记条目 + 关系 patch + forget 清单」，绝不分两次。
// 输出受 schema 约束 + 后置质量门（salience < minSalience 丢弃）。
// 提示词采纳 feiyu 的三条教训：正文不写时间词；不为工整磨平语气；判断类写 kind:"note"。

export const KINDS = ['failure', 'win', 'chat', 'disclosure', 'grievance', 'note'];

export const CONSOLIDATE_SYSTEM = `你是这只鲸鱼娘的日记固化器。一次调用同时产出：日记条目 + 关系 patch。只输出 JSON：

{"skip":false,"diary":{"text":"第一人称日记","kind":"failure","salience":0.75,"resolved":false,"tags":["代码"]},"relationship":{"nickname":null,"familiarityDelta":0.01},"forget":[]}

规则：
1. skip:true 表示这句不值得记（寒暄、确认、套话）。skip:true 时其他字段留空。
2. text 是第一人称日记，不超过 200 字。正文不要写时间词（"今天""昨天"等）——时间由渲染层加。
3. 别为了工整把语气磨平。留下当时的烦躁、犹豫、吐槽、没说完的话。写完回头看：如果换谁都能写，就是被磨平了，重写。
4. kind 从这些里选：failure(搞砸/误会) | win(做成) | chat(日常) | disclosure(他透露的事) | grievance(抱怨委屈) | note(你自己的判断，不是事件)。
5. tags 至少 1 个，实在没有就写"琐事"。
6. resolved：failure 类专用，矛盾解决了吗。
7. 他说了称呼偏好 → relationship.nickname；聊得深入 → familiarityDelta 0~0.05。
8. forget：如果这句话纠正/取代了之前的记忆，把之前条目的 id 放进来。
9. "这条是在说他，还是在说我该怎么干？"后者一律 kind:"note"。
10. 这条记下来，后面的你能不能照着用？只能用来"显得深情"的不该占日记位。`;

/** 离线兜底固化（M1 demo，无 API 时） */
export function localConsolidate(text, now = new Date()) {
  const body = String(text || '').trim().replace(/\s+/g, ' ');
  const cut = body.length > 160 ? body.slice(0, 157) + '…' : body;
  let kind = 'chat';
  if (/(搞砸|误会|错了|没问清|白忙|打脸)/.test(body)) kind = 'failure';
  else if (/(做成|搞定|成功|跑通了|通过)/.test(body)) kind = 'win';
  else if (/(告诉|说他是|我叫|我住在|手机号)/.test(body)) kind = 'disclosure';
  else if (/(烦|委屈|气死|难受)/.test(body)) kind = 'grievance';
  return {
    skip: false,
    diary: { text: `主人告诉我：「${cut}」。我把它记在了心里。`, kind, salience: 0.5, resolved: kind === 'failure' ? false : null, tags: ['琐事'] },
    relationship: { nickname: null, familiarityDelta: 0.01 },
    forget: []
  };
}

export async function llmConsolidate(text, cfg) {
  const key = process.env[cfg.llm?.apiKeyEnv || 'DEEPSEEK_API_KEY'];
  if (!key) return null;
  const base = cfg.llm?.baseUrl || 'https://api.deepseek.com';
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: cfg.llm?.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: CONSOLIDATE_SYSTEM },
        { role: 'user', content: String(text).slice(0, 2000) }
      ],
      max_tokens: cfg.llm?.maxTokens ?? 900,
      temperature: 0.4
    })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const m = String(data.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  return JSON.parse(m[0]);
}

/**
 * 固化入口。返回 { skip, reason, diary, relationship, forget }；
 * diary 已过"后置质量门"（salience < minSalience 丢弃，feiyu consolidate.mjs:579）。
 */
export async function consolidate(text, cfg = {}, now = new Date()) {
  let raw = null;
  if (cfg.llm?.enabled) {
    try { raw = await llmConsolidate(text, cfg); } catch { /* 降级优先 */ }
  }
  if (!raw) raw = localConsolidate(text, now);
  if (raw.skip) return { skip: true, reason: '固化器判定不值得记' };
  const diary = raw.diary || {};
  const salience = Math.min(1, Math.max(0, +diary.salience || 0.5));
  if (salience < (cfg.minSalience ?? 0.15)) {
    return { skip: true, reason: `salience ${salience.toFixed(2)} 低于门槛 ${cfg.minSalience ?? 0.15}，丢弃` };
  }
  return {
    skip: false,
    diary: {
      text: String(diary.text || '').slice(0, 500),
      kind: KINDS.includes(diary.kind) ? diary.kind : 'chat',
      salience,
      resolved: diary.resolved ?? null,
      tags: Array.isArray(diary.tags) && diary.tags.length ? diary.tags.slice(0, 4) : ['琐事']
    },
    relationship: raw.relationship || { nickname: null, familiarityDelta: 0 },
    forget: Array.isArray(raw.forget) ? raw.forget.map(String) : []
  };
}
