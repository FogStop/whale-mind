// 运行时验证：mini-React（带 state + 重渲染），实测多次渲染 hook 数是否一致。
// 旧代码（DafeiyuCard 当函数调用 / PluginDetailNote 提前 return 后调 hook）应报 #310。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
let src = fs.readFileSync(path.join(here, 'client.js'), 'utf8')
src = src.replace('module.exports = {',
  'module.exports = { __t:{WhalePanel:WhalePanel,DafeiyuCard:DafeiyuCard,PluginDetailNote:PluginDetailNote,PluginConfigCard:PluginConfigCard},')

// ---------- mini React（每次渲染都重跑 effect，模拟 deps 变化后的重取）----------
const HOOKS = new Map()
let cur = null

const React = {
  createElement(type, props, ...kids) { return { __el: true, type, props: props || {}, kids } },
  useState(init) {
    const st = cur, i = st.idx++
    if (st.list.length === i) st.list.push('useState')
    if (!(i in st.states)) st.states[i] = typeof init === 'function' ? init() : init
    return [st.states[i], (v) => { st.states[i] = typeof v === 'function' ? v(st.states[i]) : v }]
  },
  useEffect(fn) {
    const st = cur, i = st.idx++
    if (st.list.length === i) st.list.push('useEffect')
    st.pending.push(fn)
  },
  Component: class { constructor(p) { this.props = p || {}; this.state = {} } },
}

function renderVNode(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) return node.forEach(renderVNode)
  if (typeof node !== 'object' || !node.__el) return
  const { type, props, kids } = node
  if (typeof type === 'function') {
    if (type.prototype && type.prototype.render) { const i = new type(props); return renderVNode(i.render()) }
    const key = type.name
    let st = HOOKS.get(key)
    if (!st) st = HOOKS.set(key, { list: [], idx: 0, states: {}, pending: [], seen: [] }).get(key)
    st.idx = 0; st.pending = []
    const prev = cur; cur = st
    let out
    try { out = type({ ...props, children: kids.length <= 1 ? kids[0] : kids }) } finally { cur = prev }
    st.seen.push(st.list.length)
    const n = st.seen.length
    if (n > 1 && st.seen[n - 1] !== st.seen[0]) {
      throw new Error(`React error #310: ${key} 第 ${n} 次渲染 hook 数 ${st.seen[n - 1]} ≠ 首次 ${st.seen[0]}（序列 [${st.seen}]）`)
    }
    st.pending.forEach((fn) => fn())
    return renderVNode(out)
  }
  kids.forEach(renderVNode)
}

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }

// ---------- 环境 ----------
const state = { mode: 'loading' }
let captured = null
globalThis.window = { __ModuleLoader__: { load(d) { captured = d.factory((id) => (id === 'react' ? React : {})) } } }
globalThis.fetch = async (url) => {
  const u = String(url)
  if (state.mode === 'loading' && (u.includes('/whale-mind/state') || u.includes('/bridge'))) {
    return new Promise(() => {})
  }
  if (u.includes('/whale-mind/state')) return { ok: true, json: async () => ({ count: 42, dataDir: 'D:/mem', injection: { tokens: 900 }, queue: { pending: 1 }, recent: [], notes: [] }) }
  if (u.includes('/bridge')) return { ok: true, json: async () => ({ available: true, mirrored: 3, total: 3, hints: [] }) }
  return { ok: true, json: async () => ({}) }
}

async function loadModule(code) {
  const p = path.join(os.tmpdir(), 'wm_u' + Math.random().toString(36).slice(2) + '.mjs')
  fs.writeFileSync(p, code, 'utf8')
  captured = null
  await import('file:///' + p.replaceAll('\\', '/'))
  fs.rmSync(p, { force: true })
  return captured
}

async function scenario(label, comp, props, opts = {}) {
  HOOKS.clear()
  // propsSeq：模拟「同一个组件位置先后渲染不同插件详情页」
  const seq = opts.propsSeq || [props, props, props]
  try {
    state.mode = opts.startMode || 'ready'
    for (const p of seq) {
      renderVNode(React.createElement(comp, p)); await flush()
      state.mode = 'ready'
    }
    const st = HOOKS.get(comp.name)
    console.log(`  ✅ ${label}: hook 数逐次 = [${st.seen.join(', ')}]`)
    return true
  } catch (e) {
    console.log(`  ✗ ${label}: ${e.message}`)
    return false
  }
}

// ============ 1. 改后的代码 ============
console.log('=== 改后（当前 client.js）===')
let mod = await loadModule(src)
const T = mod.__t
let ok = true
ok = (await scenario('WhalePanel（loading→ready）', T.WhalePanel, {}, { startMode: 'loading' })) && ok
ok = (await scenario('WhalePanel（直接 ready）', T.WhalePanel, {})) && ok
ok = (await scenario('PluginConfigCard', T.PluginConfigCard, {})) && ok
ok = (await scenario('PluginDetailNote（切换到本插件详情页）', T.PluginDetailNote, null, {
  propsSeq: [
    { subject: { kind: 'bundle', pkg: { name: 'other' } } },
    { subject: { kind: 'bundle', pkg: { name: 'whale-mind' } } },
    { subject: { kind: 'bundle', pkg: { name: 'other2' } } },
  ],
})) && ok

// ============ 2. 对照：还原旧写法 ============
console.log('\n=== 对照：还原旧写法 ===')
let old = src
  .replace(/h\(DafeiyuCard, \{ tick: tick \}\),/, 'DafeiyuCard({ tick: tick }),')
  .replace(/(if \(!subject \|\| subject\.kind[^\n]*return null\n)(\s*)(return h\(PluginDetailNoteInner)/,
    '$1$2var _unused = useState(0)\n$2$3')
if (!old.includes('DafeiyuCard({ tick: tick })')) console.log('  ⚠ 旧写法替换失败（DafeiyuCard）')
if (!old.includes('var _unused = useState(0)')) console.log('  ⚠ 旧写法替换失败（PluginDetailNote）')
mod = await loadModule(old)
const O = mod.__t
await scenario('旧 WhalePanel', O.WhalePanel, {}, { startMode: 'loading' })
await scenario('旧 PluginDetailNote（同样是切换场景）', O.PluginDetailNote, null, {
  propsSeq: [
    { subject: { kind: 'bundle', pkg: { name: 'other' } } },
    { subject: { kind: 'bundle', pkg: { name: 'whale-mind' } } },
    { subject: { kind: 'bundle', pkg: { name: 'other2' } } },
  ],
})

process.exit(ok ? 0 : 1)
