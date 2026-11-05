// whale-mind · store.js (v2, 按 feiyu-memory 源码校准)
// - 每月一个 JSONL（diary/YYYY-MM.jsonl），行式追加，坏一行只丢一行
// - 删除 = manifest.json 里的墓碑（deleted_ids，只增不减），加载时折叠
// - 条目 schema 对齐 feiyu §2.2：id/date/text/tags/kind/salience/resolved/session/created_at
// - schema_version 写进 manifest；relationship.json 单独存关系状态
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

export function localDateStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 条目规范化：字段缺省兜底，防"漏写 id 变成 undefined 撞车"（feiyu 踩过的坑） */
export function normalizeEntry(raw) {
  const now = Date.now();
  return {
    id: String(raw.id),
    date: raw.date ?? localDateStr(new Date(now)),
    text: String(raw.text ?? ''),
    summary: String(raw.summary ?? String(raw.text ?? '').slice(0, 24)), // 索引只吃 summary（feiyu：summary 从不进上下文）
    tags: Array.isArray(raw.tags) && raw.tags.length ? raw.tags : ['琐事'],
    kind: raw.kind ?? 'chat',
    salience: Number.isFinite(+raw.salience) ? +raw.salience : 0.5,
    resolved: raw.resolved ?? null,
    session: raw.session ?? null,
    created_at: Number.isFinite(+raw.created_at) ? +raw.created_at : now,
    updated_at: Number.isFinite(+raw.updated_at) ? +raw.updated_at : now,
    entities: Array.isArray(raw.entities) ? raw.entities : [],
    source: raw.source ?? 'local',
    deleted: false
  };
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.diaryDir = path.join(dataDir, 'diary');
    this.manifestFile = path.join(dataDir, 'manifest.json');
    this.relationshipFile = path.join(dataDir, 'relationship.json');
    fs.mkdirSync(this.diaryDir, { recursive: true });
    this._deleted = new Set(this.readManifest().deleted_ids ?? []);
    this._seq = new Map();
    for (const e of this.load()) this._bumpSeq(e.id);
  }

  readManifest() {
    try { return JSON.parse(fs.readFileSync(this.manifestFile, 'utf8')); }
    catch { return { schema_version: SCHEMA_VERSION, deleted_ids: [] }; }
  }
  writeManifest() {
    fs.writeFileSync(this.manifestFile, JSON.stringify({ schema_version: SCHEMA_VERSION, deleted_ids: [...this._deleted] }, null, 2), 'utf8');
  }

  newId(now = new Date()) {
    const ds = localDateStr(now).replace(/-/g, '');
    const n = (this._seq.get(ds) ?? 0) + 1;
    this._seq.set(ds, n);
    return `wm_${ds}_${String(n).padStart(2, '0')}`;
  }
  _bumpSeq(id) {
    const m = /^wm_(\d{8})_(\d+)$/.exec(String(id));
    if (m) {
      const n = +m[2];
      if (n > (this._seq.get(m[1]) ?? 0)) this._seq.set(m[1], n);
    }
  }

  /** 当场落盘（对齐 feiyu 17.10：工具/强制通道不进带外队列） */
  add(raw) {
    const e = normalizeEntry(raw);
    this._bumpSeq(e.id);
    fs.appendFileSync(this.monthFile(e.date), JSON.stringify(e) + '\n', 'utf8');
    return e;
  }

  /** 删除 = 墓碑，只增不减；导出/导入不掉墓碑 */
  del(id) { this._deleted.add(String(id)); this.writeManifest(); }

  /** 读取全部月份文件，套墓碑 */
  load() {
    const out = [];
    if (!fs.existsSync(this.diaryDir)) return out;
    for (const f of fs.readdirSync(this.diaryDir).filter(f => f.endsWith('.jsonl')).sort()) {
      for (const line of fs.readFileSync(path.join(this.diaryDir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (!e.id || this._deleted.has(e.id)) continue;
        this._bumpSeq(e.id);
        out.push(normalizeEntry(e));
      }
    }
    return out;
  }
  active() { return this.load(); }
  monthFile(dateStr) { return path.join(this.diaryDir, dateStr.slice(0, 7) + '.jsonl'); }

  relationship() {
    try { return JSON.parse(fs.readFileSync(this.relationshipFile, 'utf8')); }
    catch { return { nickname: null, familiarity: 0, last_reinforced: null }; }
  }
  saveRelationship(r) { fs.writeFileSync(this.relationshipFile, JSON.stringify(r, null, 2), 'utf8'); }
}
