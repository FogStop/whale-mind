// whale-mind · privacy.mjs (M2, 按 feiyu SPEC §6 隐私三默认)
// 1. 本地-only：架构承诺（本项目数据只落 dataDir，无云同步、无遥测）
// 2. 密钥硬拦：正则硬阻断，绝不入档、不进日志，命中替换 [已拦截]
// 3. 第三方泛化：LLM 固化提示词承担（见 consolidate CONSOLIDATE_SYSTEM 规则11）；
//    本层兜底拦手机号/身份证等强特征（吸取 feiyu 评测"手机号未打码"教训）
//
// 一键焚毁：burn() 清空记忆目录，不可恢复（删除而非墓碑）。
import fs from 'node:fs';
import path from 'node:path';

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/g,                                   // DeepSeek/OpenAI 风格 key
  /gh[pousr]_[A-Za-z0-9]{30,}/g,                            // GitHub token
  /Bearer\s+[A-Za-z0-9._\-]{16,}/gi,                        // Bearer token
  /eyJ[A-Za-z0-9._\-]{20,}/g,                               // JWT
  /(?:api[_-]?key|secret|token|passwd|password|pwd)\s*[=:：]\s*\S{8,}/gi
];

const PHONE_RE = /1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g;
const IDCARD_RE = /\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g;
const BANKCARD_RE = /\d{16,19}/g; // 仅在命中 PHONE/IDC 之外的长数字串

/** 密钥/证件硬拦：命中替换为 [已拦截]，绝不入档不进日志 */
export function hardBlock(text) {
  let t = String(text ?? '');
  let hits = 0;
  for (const re of SECRET_PATTERNS) {
    t = t.replace(re, () => { hits++; return '[已拦截]'; });
  }
  t = t.replace(IDCARD_RE, () => { hits++; return '[已拦截]'; });
  t = t.replace(PHONE_RE, () => { hits++; return '一个联系方式'; });
  // 16 位以上纯数字（卡号类）兜底；避免把日期时间戳误伤——要求前后都不是数字
  t = t.replace(/(?<!\d)\d{16,19}(?!\d)/g, () => { hits++; return '[已拦截]'; });
  return { text: t, hits };
}

/** 落盘前清洗管线：所有记忆写入前必须过这道 */
export function sanitizeForStorage(text) {
  return hardBlock(text).text;
}

/** 一键焚毁：删除记忆目录全部内容（不可恢复，feiyu §6.2："不用确认三次"由调用方 UI 负责） */
export function burn(dataDir, fsImpl = fs) {
  const removed = [];
  if (fsImpl.existsSync(dataDir)) {
    for (const f of fsImpl.readdirSync(dataDir)) {
      const p = path.join(dataDir, f);
      if (fsImpl.statSync(p).isDirectory()) { fsImpl.rmSync(p, { recursive: true, force: true }); }
      else fsImpl.rmSync(p, { force: true });
      removed.push(f);
    }
  }
  return removed;
}
