// whale-mind · handnote.mjs (M2.5, 按 feiyu §17.10 手记.md 的两条规矩)
// 手记.md 是"人手写的地方"——插件只读，永不写它（天然没有竞态）。
// 解析两条硬规矩：
//   1. 只认 "- " 开头的行（* 和 + 不收——少一种写法就少一种写错的方式）
//   2. 代码围栏里的行一律跳过（feiyu 踩过：模板说明被当成手记注入了）
import fs from 'node:fs';
import path from 'node:path';

export const HANDNOTE_TEMPLATE = [
  '# 手记（写给你家鲸鱼娘的话，插件只读这个文件）',
  '',
  '在下面追加 `- ` 开头的行即可，每行一句。示例（这段说明在围栏里，不会被当成手记）：',
  '```',
  '- 我不喜欢在饭点被打扰',
  '- 提到"包子"指的是我的猫，不是吃的',
  '```',
  ''
].join('\n');

export function handnotePath(dataDir) { return path.join(dataDir, '手记.md'); }

export function ensureHandnote(dataDir) {
  const f = handnotePath(dataDir);
  if (!fs.existsSync(f)) fs.writeFileSync(f, HANDNOTE_TEMPLATE, 'utf8');
  return f;
}

export function parseHandNotes(md) {
  const out = [];
  let inFence = false;
  for (const line of String(md || '').split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (line.startsWith('- ')) out.push(line.slice(2).trim());
  }
  return out.filter(Boolean);
}

export function readHandNotes(dataDir) {
  const f = handnotePath(dataDir);
  try { return parseHandNotes(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
