/**
 * whale-mind —— 浏览器半侧（手写 __ModuleLoader__ bundle，无需构建工具）。
 *
 * 挂载形式（照抄本机已验证可用的大肥鱼 dsh-dafeiyu-dot）：
 *   1. sidebar.panellist  → 侧栏出现「记忆海」图标（list slot，渲染的是 glyph）
 *   2. main (key=PANEL_ID) → 点图标后中栏整页渲染（keyed slot，props 带 placement:'panel'）
 *   3. plugins.bundle.config (key='whale-mind') → 插件详情页里的配置区，可直接跳转管理
 *   4. plugins.detail.section → 插件详情页附一条记忆状态摘要
 *
 * 与宿主端只走同源 HTTP（/whale-mind/*，由 src/plugin.mjs 的 webServer 路由提供），
 * 不碰 RPC。修改后 `node --check panel/client.js` 验证语法。
 *
 * 关键约束（踩过的坑）：
 *   - settings.section 在这个 DSH 版本里不是有效 slot，注册了也不显示 —— 别再用。
 *   - sidebar.panellist 渲染的是「图标」不是标题，标题必须放在 options.label 上。
 *   - main 是 keyed slot，只有 key 与 layout.panelInfo.activePanelId 相等时才渲染。
 */

window.__ModuleLoader__.load({
  id: 'whale-mind',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement
    var useEffect = React.useEffect
    var useState = React.useState

    var NS = 'whale-mind'
    var PANEL_ID = 'whale-mind'
    var BASE = '/whale-mind'
    var PANEL = BASE + '/panel'
    var mainLayout = null

    var CSS = [
      // ---- 侧栏 / 面板宿主 ----
      '.wm-panel-host{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:auto;box-sizing:border-box;',
      'padding:16px 20px;padding-top:calc(16px + var(--dsh-frame-top-clearance,0px));background:var(--dsh-bg,#0b0f18)}',
      '.wm-glyph{display:inline-flex;align-items:center;justify-content:center;color:var(--wm-accent,#4ecbff)}',
      '.wm-glyph svg{display:block}',
      // ---- 通用 ----
      // ⚠️ 这里原来是 max-width:940px + margin:0 auto。在 1400px 宽的插件详情页里
      //    就变成「中间一条窄柱、左右各留一大片黑」，长记忆文本还会被挤成三四行。
      //    现在占满可用宽度，并用 1100px 断点切两栏：宽屏左状态右清单，窄屏自动落回单栏。
      '.wm-root{display:flex;flex-direction:column;gap:12px;width:100%;max-width:none;margin:0}',
      '.wm-grid{display:grid;grid-template-columns:1fr;gap:12px;width:100%}',
      '@media (min-width:1100px){.wm-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);align-items:start}',
      '.wm-grid .wm-span{grid-column:1/-1}}',
      '.wm-card{background:var(--wm-card,rgba(255,255,255,.04));border:1px solid var(--wm-line,rgba(140,170,230,.18));border-radius:12px;padding:13px 16px}',
      '.wm-h{display:flex;align-items:center;gap:10px;margin:0 0 4px;flex-wrap:wrap}',
      '.wm-h b{font-size:14.5px;color:var(--wm-fg,#eef2fa)}',
      '.wm-sub{font-size:12px;color:var(--wm-muted,#8b95a6);line-height:1.6}',
      '.wm-stats{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--wm-muted,#8b95a6);margin-top:8px}',
      '.wm-stats b{color:var(--wm-fg,#eef2fa);font-variant-numeric:tabular-nums}',
      '.wm-btns{display:flex;gap:9px;flex-wrap:wrap;margin-top:10px}',
      '.wm-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(78,203,255,.12);color:#4ecbff;',
      'border:1px solid rgba(78,203,255,.35);border-radius:9px;padding:7px 14px;font-size:12.5px;cursor:pointer;',
      'text-decoration:none;font-family:inherit;line-height:1.4}',
      '.wm-btn:hover{background:rgba(78,203,255,.22)}',
      '.wm-btn.ghost{color:var(--wm-muted,#8b95a6);border-color:rgba(140,170,230,.25)}',
      '.wm-btn.ghost:hover{color:var(--wm-fg,#eef2fa);background:rgba(140,170,230,.12)}',
      '.wm-btn.danger{color:#ff9a9a;border-color:rgba(255,120,120,.35);background:rgba(160,50,50,.10)}',
      '.wm-frame{width:100%;height:min(78vh,900px);min-height:520px;border:1px solid var(--wm-line,rgba(140,170,230,.18));border-radius:12px;',
      'background:#05070f;display:block}',
      '.wm-note{background:rgba(78,203,255,.06);border-left:3px solid #4ecbff;border-radius:6px;padding:8px 12px;',
      'font-size:12px;color:var(--wm-muted,#8b95a6);line-height:1.7}',
      '.wm-note b{color:var(--wm-fg,#eef2fa)}',
      '.wm-err{color:#ff9a9a;background:rgba(160,50,50,.12);border:1px solid rgba(255,120,120,.3);',
      'border-radius:10px;padding:10px 13px;font-size:12.5px}',
      '.wm-input{background:var(--wm-field,rgba(255,255,255,.05));color:var(--wm-fg,#eef2fa);',
      'border:1px solid var(--wm-line,rgba(140,170,230,.25));border-radius:8px;padding:7px 10px;font:inherit;flex:1;min-width:200px}',
      // 记忆清单：原来 max-height 340 + item 内部挤成一团。改成占满剩余高度、行距放开，
      // 宽屏时两栏排（column-width 在 flex 里不生效，用 grid 两列按 460px 自适应）。
      '.wm-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:8px;margin-top:8px;',
      'max-height:min(52vh,560px);overflow:auto}',
      '@media (max-width:1000px){.wm-list{grid-template-columns:1fr}}',
      '.wm-item{display:flex;gap:10px;align-items:flex-start;background:rgba(255,255,255,.03);border-radius:8px;padding:9px 12px;min-width:0}',
      '.wm-item .t{flex:1;min-width:0;font-size:13px;color:var(--wm-fg,#eef2fa);line-height:1.68;word-break:break-word}',
      '.wm-item .m{font-size:11px;color:var(--wm-muted,#8b95a6);white-space:nowrap;padding-top:2px}',
      '.wm-del{background:none;border:0;color:#ff9a9a;cursor:pointer;font-size:12px;padding:0 2px;opacity:.6}',
      '.wm-del:hover{opacity:1}',
      '.wm-tip{font-size:11.5px;color:var(--wm-muted,#8b95a6);margin-top:8px}',
    ].join('')

    // ---- 同源 API ----
    function getJson(url) {
      return fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
    }
    function postJson(url, body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(function (r) { return r.json() })
    }
    function apiState() { return getJson(BASE + '/state') }
    function apiNote(text) { return postJson(BASE + '/note', { text: text }) }
    function apiForget(id) { return postJson(BASE + '/forget', { id: id }) }

    function useStats(tick) {
      var s = useState(null)
      var stats = s[0], setStats = s[1]
      useEffect(function () {
        var alive = true
        setStats(function (prev) { return prev === false ? null : prev })
        apiState()
          .then(function (v) { if (alive) setStats(v) })
          .catch(function () { if (alive) setStats(false) })
        return function () { alive = false }
      }, [tick])
      return [stats, setStats]
    }

    // ---- 大飞鱼联动状态（只读镜像） ----
    function apiBridge() { return getJson(PANEL + '/brain/api/bridge') }
    function useBridge(tick) {
      var s = useState(null)
      var st = s[0], setSt = s[1]
      useEffect(function () {
        var alive = true
        apiBridge()
          .then(function (v) { if (alive) setSt(v) })
          .catch(function () { if (alive) setSt(false) })
        return function () { alive = false }
      }, [tick])
      return st
    }

    // ---- 大飞鱼联动卡：只读镜像记忆宫殿 ----
    // 空宫殿时不能只显示一个 "0 条"，得把「为什么是空的」直接写出来，
    // 否则用户以为坏了。hints 由宿主端 /brain/api/bridge 生成。
    //
    // 2026-11-04 补：光显示数字确实是「一个样子」——原来说明写「只读镜像」，
    // 但实际上只在星脑图谱里 concat 了一下，记忆清单里没有、检索不到、注入也不带。
    // 现在「同步宫殿到星脑」是**真写入**（走 /brain/api/sync-palace 落 store），
    // 点完清单里就会出现，下一轮对话也真的会带上。
    function DafeiyuCard(props) {
      var st = useBridge(props.tick)
      var s = useState({ busy: false, msg: '' })
      var job = s[0], setJob = s[1]

      function syncPalace() {
        setJob({ busy: true, msg: '' })
        postJson(PANEL + '/brain/api/sync-palace', {})
          .then(function (r) {
            if (!r || !r.ok) { setJob({ busy: false, msg: '同步失败：' + ((r && r.error) || '?') }); return }
            var text = r.imported > 0
              ? '已导入 ' + r.imported + ' 条（跳过 ' + r.skipped + ' 条重复）'
              : '没有新条目可导入（宫殿为空，或已全部同步过）'
            setJob({ busy: false, msg: text })
            if (props.onChanged) props.onChanged()
          })
          .catch(function (e) { setJob({ busy: false, msg: '同步失败：' + String((e && e.message) || e) }) })
      }

      if (st === false) return null // 宿主端没有这个路由（旧版本），干脆不显示
      if (!st) return null

      var badge = st.available
        ? (st.mirrored > 0 ? '已联动 · ' + st.mirrored + ' 条可同步' : '已连接 · 宫殿还是空的')
        : '未检测到大飞鱼'

      var rows = [
        ['宫殿记忆', String(st.total || 0) + ' 条'],
        ['可同步', String(st.mirrored || 0) + ' 条'],
        ['记忆开关', st.memoryEnabled ? '开' : '关'],
        ['QQ 网关', st.qqEnabled ? '已启用' : '未启用'],
        ['绑定会话', st.sessionBound ? '已绑定' : '未绑定'],
      ]

      return h('div', { className: 'wm-card' },
        h('div', { className: 'wm-h' },
          h('b', null, '🐟 大飞鱼记忆宫殿'),
          h('span', { className: 'wm-sub' }, badge)),
        h('div', { className: 'wm-sub' },
          '单向镜像：同步过来之后，宫殿里的事实会真的进记忆清单、进检索、进下一轮的注入。',
          '反向不写——它的可信度模型要求逐字原文证据，二次概括会把可信度搞坏。'),
        h('div', { className: 'wm-stats' },
          rows.map(function (r, i) {
            return h('span', { key: 'dy' + i }, r[0] + ' ', h('b', null, r[1]))
          })),
        (st.hints && st.hints.length)
          ? h('div', { className: 'wm-sub', style: { marginTop: '8px', color: '#ffbe55' } },
            st.hints.map(function (t, i) { return h('div', { key: 'h' + i }, '· ' + t) }))
          : null,
        (st.jobs && st.jobs.length)
          ? h('div', { className: 'wm-sub', style: { marginTop: '8px' } },
            '最近整理任务：' + st.jobs.slice(0, 3).map(function (j) { return j.status }).join(' / '))
          : null,
        h('div', { className: 'wm-btns' },
          h('button', {
            className: 'wm-btn',
            disabled: job.busy || !(st.mirrored > 0),
            style: (job.busy || !(st.mirrored > 0)) ? { opacity: 0.45, cursor: 'not-allowed' } : null,
            onClick: syncPalace,
          }, job.busy ? '同步中…' : '⇩ 同步宫殿到星脑'),
          h('a', { className: 'wm-btn ghost', href: PANEL + '/brain', target: '_blank', rel: 'noreferrer' }, '🧠 看星脑')),
        job.msg ? h('div', { className: 'wm-sub', style: { marginTop: '6px' } }, job.msg) : null,
        h('div', { className: 'wm-sub', style: { marginTop: '8px', opacity: 0.75 } },
          '「未绑定 / 0 条」不是坏了：大飞鱼（dsh-dafeiyu-dot）从没在鲸鱼娘模式下聊过。',
          '它绑定会话要自己在插件里用 sessionController 建一个专属会话，外部改 config 它不认，所以我没替你硬改。',
          '要绑就去「插件」列表 → dsh-dafeiyu-dot 打开设置。'))
    }

    // ---- 侧栏图标 ----
    function WhaleGlyph(props) {
      var size = props && typeof props.size === 'number' ? props.size : 18
      return h('span', { className: 'wm-glyph' },
        h('svg', {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true',
        },
          // 鲸身
          h('path', {
            d: 'M3.2 14.6c0-3.4 2.9-6 6.6-6 2.9 0 5.3 1.5 6.3 3.8l2.5-1.7c.4-.3.9.2.6.6l-1.2 2.3 1.2 2.3c.3.4-.2.9-.6.6l-2.5-1.7c-1 2.3-3.4 3.8-6.3 3.8-3.7 0-6.6-2.6-6.6-6Z',
            fill: 'currentColor', opacity: '0.9',
          }),
          // 眼睛
          h('circle', { cx: '7.6', cy: '13.3', r: '0.95', fill: '#0b0f18' }),
          // 三颗记忆星
          h('circle', { cx: '16.6', cy: '5.4', r: '1.05', fill: 'currentColor', opacity: '0.85' }),
          h('circle', { cx: '20', cy: '8.2', r: '0.75', fill: 'currentColor', opacity: '0.55' }),
          h('circle', { cx: '13.4', cy: '3.1', r: '0.6', fill: 'currentColor', opacity: '0.45' }),
          // 喷气
          h('path', {
            d: 'M9.4 7.2c.5-2 2-3.2 3.9-3.6',
            stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round', opacity: '0.5',
          })
        ))
    }

    // ---- 记忆列表 ----
    function MemoryList(props) {
      var items = props.items || []
      var onForget = props.onForget
      if (items.length === 0) return h('div', { className: 'wm-tip' }, '还没有记忆。聊几轮，或者在上面写一条手记。')
      return h('div', { className: 'wm-list' },
        items.map(function (it) {
          return h('div', { className: 'wm-item', key: String(it.id) },
            h('span', { className: 't' }, String(it.text || '')),
            h('span', { className: 'm' }, String(it.kind || '')),
            h('button', {
              className: 'wm-del', title: '忘掉这一条',
              onClick: function () { if (onForget) onForget(it.id) },
            }, '×'))
        }))
    }

    // ---- 主面板（中栏整页） ----
    function WhalePanel() {
      var t0 = useState(0)
      var tick = t0[0], bump = t0[1]
      var r = useStats(tick)
      var stats = r[0], setStats = r[1]
      var n0 = useState('')
      var note = n0[0], setNote = n0[1]
      var m0 = useState('')
      var msg = m0[0], setMsg = m0[1]

      function addNote() {
        var text = String(note || '').trim()
        if (!text) return
        apiNote(text).then(function (res) {
          setMsg(res && res.ok ? '已记下 #' + res.id : '失败：' + ((res && res.error) || '?'))
          setNote('')
          bump(function (x) { return x + 1 })
        }).catch(function (e) { setMsg('失败：' + String(e && e.message || e)) })
      }

      function forget(id) {
        apiForget(id).then(function () { bump(function (x) { return x + 1 }) }).catch(function () {})
      }

      if (stats === null) return h('div', { className: 'wm-panel-host' }, h('div', { className: 'wm-root wm-card wm-sub' }, '正在读取鲸鱼娘的记忆…'))
      if (stats === false) {
        return h('div', { className: 'wm-panel-host' },
          h('div', { className: 'wm-root wm-err' },
            '读不到 /whale-mind/state。确认 whale-mind 已启用（profiles/desktop/package.json 的 dsh.profile.bundles 里有 whale-mind），',
            '改完必须重启 DSH；若刚点过「禁用所有插件」，套餐会被重置，需要重新启用。'))
      }

      var inj = stats.injection ? stats.injection.tokens : 0
      var queue = stats.queue ? stats.queue.pending : 0
      var recent = (stats.recent || []).concat(stats.notes || [])

      return h('div', { className: 'wm-panel-host' },
        h('div', { className: 'wm-root' },
          h('div', { className: 'wm-grid' },

            // ---- 左栏：状态 / 大飞鱼 / 手记 ----
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 } },

              // 状态卡
              h('div', { className: 'wm-card' },
                h('div', { className: 'wm-h' },
                  h('b', null, '🐋 鲸鱼娘的记忆'),
                  h('span', { className: 'wm-sub', style: { wordBreak: 'break-all' } }, stats.dataDir || '')),
                h('div', { className: 'wm-sub' }, '同一份记忆，三种形态：星脑（神经元图谱）· 星环（作战大屏）· 银河（可漫游星海）'),
                h('div', { className: 'wm-stats' },
                  h('span', null, '记忆 ', h('b', null, String(stats.count || 0)), ' 条'),
                  h('span', null, '下轮注入 ', h('b', null, String(inj)), ' token'),
                  h('span', null, '待固化 ', h('b', null, String(queue)))),
                h('div', { className: 'wm-btns' },
                  h('a', { className: 'wm-btn', href: PANEL, target: '_blank', rel: 'noreferrer' }, '🚀 三板大面板'),
                  h('a', { className: 'wm-btn ghost', href: PANEL + '/manager', target: '_blank', rel: 'noreferrer' }, '🛠 完整管理页'),
                  h('button', { className: 'wm-btn ghost', onClick: function () { bump(function (x) { return x + 1 }) } }, '↻ 刷新'))),

              // 大飞鱼联动（只读镜像）
              // ⚠️ 必须用 h() 渲染成子组件，不能当普通函数调用 DafeiyuCard({tick})。
              //    当函数调用 = 它的 useState/useEffect 记在 WhalePanel 头上，
              //    而上面 stats===null 时会提前 return，两次渲染的 hook 数不一致 → React error #310。
              h(DafeiyuCard, { tick: tick, onChanged: function () { bump(function (x) { return x + 1 }) } }),

              // 手记
              h('div', { className: 'wm-card' },
                h('div', { className: 'wm-h' }, h('b', null, '✍ 快捷手记')),
                h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                  h('input', {
                    className: 'wm-input', value: note,
                    placeholder: '第一人称一句话，比如：主人这周要值夜班，别安排早晨的提醒。',
                    onChange: function (e) { setNote(e.target.value) },
                    onKeyDown: function (e) { if (e.key === 'Enter') addNote() },
                  }),
                  h('button', { className: 'wm-btn', onClick: addNote }, '记进海里')),
                msg ? h('div', { className: 'wm-sub', style: { marginTop: '6px' } }, msg) : null)),

            // ---- 右栏：记忆清单 ----
            h('div', { className: 'wm-card', style: { minWidth: 0 } },
              h('div', { className: 'wm-h' },
                h('b', null, '📜 记忆清单'),
                h('span', { className: 'wm-sub' }, '最近 ' + recent.length + ' 条，点 × 忘掉')),
              h(MemoryList, { items: recent, onForget: forget }))),

          // ---- 通栏：内嵌三板 ----
          h('div', { className: 'wm-card wm-span', style: { padding: '0', overflow: 'hidden' } },
            h('iframe', {
              src: PANEL, title: '三板面板',
              className: 'wm-frame', style: { border: '0' },
            })),

          h('div', { className: 'wm-note' },
            '星脑图谱来自真实记忆（每聊一轮自动长）。手记写下的内容下一轮对话就会被想起。',
            h('br', null),
            '删除 / 导出 / 焚毁在 ', h('b', null, '完整管理页'), ' 里。'))
      )
    }

    // ---- 插件详情页里的配置卡 ----
    function PluginConfigCard() {
      var t0 = useState(0)
      var tick = t0[0], bump = t0[1]
      var r = useStats(tick)
      var stats = r[0]

      var body
      if (stats === null) body = h('div', { className: 'wm-sub' }, '正在读取…')
      else if (stats === false) body = h('div', { className: 'wm-sub' }, '未启用或宿主端没起来（找不到 /whale-mind/state）。')
      else {
        body = h('div', null,
          h('div', { className: 'wm-stats' },
            h('span', null, '记忆 ', h('b', null, String(stats.count || 0)), ' 条'),
            h('span', null, '下轮注入 ', h('b', null, String(stats.injection ? stats.injection.tokens : 0)), ' token')),
          h('div', { className: 'wm-sub', style: { marginTop: '6px' } }, stats.dataDir || ''))
      }

      return h('div', { className: 'wm-root' },
        h('div', { className: 'wm-card' },
          h('div', { className: 'wm-h' }, h('b', null, '🐋 记忆海设置')),
          body,
          h('div', { className: 'wm-btns' },
            h('button', {
              className: 'wm-btn',
              onClick: function () {
                try { if (mainLayout && mainLayout.selectPanel) mainLayout.selectPanel(PANEL_ID) } catch (e) { /* 布局服务缺失不挡 */ }
              },
            }, '打开记忆海面板'),
            h('a', { className: 'wm-btn ghost', href: PANEL + '/manager', target: '_blank', rel: 'noreferrer' }, '完整管理页'),
            h('button', { className: 'wm-btn ghost', onClick: function () { bump(function (x) { return x + 1 }) } }, '↻ 刷新'))))
    }

    // ---- 插件详情页附注 ----
    // ⚠️ hooks 不能在提前 return 之后调用：这个 slot 会被所有插件详情页渲染，
    //    第一次 subject 不匹配就 return（0 个 hook），匹配那次却调到 2 个 → React error #310。
    //    所以拆成「无 hooks 的守卫壳」+「只管取数的内层组件」。
    function PluginDetailNote(props) {
      var subject = props && props.subject
      if (!subject || subject.kind !== 'bundle' || !subject.pkg || subject.pkg.name !== 'whale-mind') return null
      return h(PluginDetailNoteInner, null)
    }

    function PluginDetailNoteInner() {
      var t0 = useState(0)
      var tick = t0[0]
      var r = useStats(tick)
      var stats = r[0]
      if (stats === null || stats === false) return null
      return h('p', { className: 'wm-sub', style: { marginTop: '8px' } },
        '记忆库里现有 ', h('b', null, String(stats.count || 0)), ' 条；下轮对话会注入约 ',
        h('b', null, String(stats.injection ? stats.injection.tokens : 0)), ' token。')
    }

    // 错误边界：面板崩了也要看得见原因（class 组件，React 19 仍支持 getDerivedStateFromError）
    class WhaleErrorBoundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null } }
      static getDerivedStateFromError(err) { return { err: err } }
      render() {
        if (this.state.err) {
          return h('div', { className: 'wm-panel-host' },
            h('div', { className: 'wm-root wm-err' },
              '记忆海面板出错：' + String((this.state.err && this.state.err.message) || this.state.err)))
        }
        return this.props.children
      }
    }

    function apply(ctx) {
      mainLayout = ctx.layout || null

      // 1) 样式只插一次，卸载时按引用移除（不能按 id 全局删——可能被别的实例占用）
      ctx.effect(function () {
        var style = document.createElement('style')
        style.setAttribute('data-whale-mind', 'styles')
        style.textContent = CSS
        document.head.appendChild(style)
        return function () { if (style.parentNode) style.parentNode.removeChild(style) }
      }, 'whale-mind: styles')

      // 2) 侧栏图标 + 中栏面板（keyed，key 必须等于 layout 的 activePanelId）
      ctx.slots.inject('main', function () {
        return ctx.slots.inject('sidebar.panellist', function () {
          var stopMain = ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            inject: function () { return { placement: 'panel' } },
          }, function (props) {
            var p = props !== null && props !== undefined ? props : {}
            return h(WhaleErrorBoundary, p, h(WhalePanel, p))
          })

          var stopEntry = ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 3,
            label: function () { return '记忆海' },
          }, WhaleGlyph)

          return function () {
            try {
              if (mainLayout && mainLayout.panelInfo &&
                  mainLayout.panelInfo.getSnapshot().activePanelId === PANEL_ID) {
                mainLayout.selectPanel(null)
              }
            } catch (e) { /* 布局服务缺失不挡卸载 */ }
            stopEntry()
            stopMain()
          }
        })
      })

      // 3) 插件详情页配置区（entryKey 就是包名）+ 一条摘要
      ctx.slots.inject('plugins.bundle.config', function () {
        return ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'whale-mind',
          order: 10,
        }, PluginConfigCard)
      })
      ctx.slots.inject('plugins.detail.section', function () {
        return ctx.slots.register({
          name: 'plugins.detail.section',
          id: 'whale-mind-status',
          order: 20,
        }, PluginDetailNote)
      })
    }

    module.exports = {
      name: 'whale-mind',
      inject: ['slots', 'layout'],
      apply: apply,
    }
    return module.exports
  },
})
