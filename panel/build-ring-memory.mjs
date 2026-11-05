// whale-mind · 生成「记忆星环」改造版
//   node panel/build-ring-memory.mjs
//
// 原则：ring.html（原版 agent-display，PolyForm 非商业）一字不动，
//       本脚本读它 → 生成 ring-memory.html。可反复重跑，原文件永远干净。
//
// 本批只改 03 · NEURAL（shell 里默认显示的那一块）：
//   ① 注入真实 diary 数据（同步 XHR，保证 mount 之前就绪）
//   ② AG / WF / CH / CHECKS 换成记忆语义（13 个记忆簇 / 11 条记忆通路 / 6 个来源 / 5 项质检）
//   ③ 任务 → 记忆：id 前缀 T- → M-，动词 派单/接手/交接/交付 换成 召回/激活/传导/注入
//   ④ tpl-neural 里的静态文案跟着换
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'ring.html');
const OUT = path.join(here, 'ring-memory.html');
let html = fs.readFileSync(SRC, 'utf8');

const report = [];
function must(name, cond) { report.push(`${cond ? 'OK  ' : 'FAIL'} ${name}`); if (!cond) throw new Error('改造点没匹配上：' + name); }

/* ---------- ① 头部注入：同步取真实 diary，构造成星环配置 ---------- */
const BOOT = `
<!-- whale-mind · 记忆星环引导层（由 build-ring-memory.mjs 注入，可重跑生成） -->
<script>
(function(){
  'use strict';
  var G = null;
  try {
    // 同步取：必须在 mountNeural 之前就绪，否则第一屏还是演示数据
    var x = new XMLHttpRequest();
    x.open('GET', '/whale-mind/panel/brain/api/graph?boot=' + Date.now(), false);
    x.send();
    if (x.status === 200) G = JSON.parse(x.responseText);
  } catch (e) { console.warn('[whale-mind] 记忆数据没取到，星环退回演示数据：', e && e.message); }
  if (!G || !G.nodes) return;

  var mem = [], rules = [];
  for (var i = 0; i < G.nodes.length; i++) {
    var n = G.nodes[i];
    if (n.kind !== 'memory') continue;
    if (n.source !== 'qq') continue;   // 只认 QQ 里聊出来的记忆，DSH 这边的对话不进星环
    if (n.region === 'cortex') rules.push(n); else mem.push(n);
  }
  var span = function (n) { var s = String(n.content || n.title || '').replace(/\\s+/g, ' ').trim(); return s.length > 16 ? s.slice(0, 16) : s; };

  // 位置必须和原版骨架严格对齐：
  //   AG[0]  = 中枢（原 CHIEF）
  //   AG[7]  = 质检（原 PROOF，代码里 const PROOF = 7 硬编码）
  //   AG[12] = 归档（原 VAULT，交付前的最后一站）
  //   AG[13] = 巡逻（原 CRAWLER，const CRAWLER = 13）
  // 中间 1..6 / 8..11 共 10 格放真正的记忆簇。
  var CL = [
    {k:'CORE',  zh:'记忆核心', role:'决定这一轮注入哪几条', tag:'CORE',   col:'#f3f4f8', sp:1,   keys:[]},
    {k:'PREF',  zh:'偏好',     role:'他喜欢什么、讨厌什么', tag:'SOUL',   col:'#ff5cae', sp:.9,  keys:['pref']},
    {k:'EVENT', zh:'事件',     role:'发生过的事',           tag:'TOPIC',  col:'#2fd27a', sp:.85, keys:['event','chat']},
    {k:'EMO',   zh:'情绪',     role:'当时的情绪底色',       tag:'SOUL',   col:'#ff7b54', sp:.8,  keys:['emotion','grievance']},
    {k:'NOTE',  zh:'手记',     role:'我自己写下的句子',     tag:'SOUL',   col:'#a774ff', sp:.7,  keys:['note']},
    {k:'FACT',  zh:'事实',     role:'可核对的信息',         tag:'HIPPO',  col:'#3b7cff', sp:.9,  keys:['fact','disclosure']},
    {k:'LESSON',zh:'教训',     role:'踩过的坑',             tag:'REVIEW', col:'#ffd23f', sp:.6,  keys:['lesson','win']},
    {k:'GATE',  zh:'门控',     role:'这条值不值得记',       tag:'RULE',   col:'#ff9a1f', sp:.5,  keys:[]},
    {k:'PERSON',zh:'人物',     role:'谁是谁',               tag:'SOUL',   col:'#62e6c7', sp:.8,  keys:['person']},
    {k:'REL',   zh:'关系',     role:'我们之间到哪一步',     tag:'SOUL',   col:'#ff4458', sp:.7,  keys:['relation']},
    {k:'KNOW',  zh:'知识',     role:'学到的结论',           tag:'KB',     col:'#9aa6ff', sp:.6,  keys:['knowledge']},
    {k:'PLAN',  zh:'约定',     role:'答应过的事',           tag:'PROJ',   col:'#25d6f0', sp:.75, keys:['plan','promise','project']},
    {k:'VAULT', zh:'落库',     role:'写进当月的 diary',     tag:'RULE',   col:'#b5ef3a', sp:.55, keys:[]},
    {k:'SCAN',  zh:'遗忘扫描', role:'找出该衰减的记忆',     tag:'PATROL', col:'#45e6f5', sp:1,   keys:[]}
  ];
  var byCluster = CL.map(function () { return []; });
  for (var j = 0; j < mem.length; j++) {
    var m = mem[j], hit = -1;
    for (var c = 0; c < CL.length && hit < 0; c++) if (CL[c].keys.length && CL[c].keys.indexOf(m.wmkind) >= 0) hit = c;
    if (hit < 0) hit = 2;                                 // 分不进偏好/情绪/手记的，一律算事件
    byCluster[hit].push(m);
  }
  // 功能位不装条目（核心 / 门控 / 落库 / 巡逻）
  byCluster[0] = []; byCluster[7] = []; byCluster[12] = []; byCluster[13] = [];

  var AG = CL.map(function (c) { return {k:c.k, zh:c.zh, role:c.role, tag:c.tag, col:c.col, sp:c.sp}; });

  // 05 NEBULA 的单元形状多一个 words[]（每个单元自带 14 个关键词，屏幕上滚的就是它）。
  // 从该簇的记忆里抽关键词；不够 14 个用通用词补齐，免得原版 words[13] 取到 undefined。
  var kwOf = function (list) {
    var m = {};
    for (var q = 0; q < list.length; q++) {
      var ks = list[q].keywords || [];
      for (var w = 0; w < ks.length; w++) { var kk = String(ks[w]); if (kk) m[kk] = (m[kk] || 0) + 1; }
    }
    var out = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
    var pad = ['记忆','召回','注入','日记','情绪','偏好','事件','事实','关系','约定','教训','人物','知识','落库'];
    for (var p = 0; out.length < 14 && p < pad.length; p++) if (out.indexOf(pad[p]) < 0) out.push(pad[p]);
    return out.slice(0, 14);
  };
  var AGN = CL.map(function (c, i) { return {k:c.k, zh:c.zh, role:c.role, col:c.col, words: kwOf(byCluster[i])}; });

  // 06 FORGE 的形状又是另一套：
  //   机器人 AGENTS = {id, role, c, beat[4]}  → 八个记忆职能（抽取/归类/情绪/去重/落库/排序/遗忘/注入）
  //   工单 JOBS    = {id, title, form, formName, short, parts[{n,en,task,ag}]}  → 正在锻造的那条真实记忆，
  //                  parts 拆成「时间/来源/情绪/关键词/人物/关联/结论」七个要素
  var FN = [['extract','抽取','#8fe3b9'], ['classify','归类','#8cc8ff'], ['mood','情绪标注','#f2b872'],
            ['dedup','去重','#f0a6c4'], ['store','落库','#72d4d0'], ['rank','召回排序','#b9a6ff'],
            ['forget','遗忘扫描','#d6df7c'], ['inject','注入','#ff9f8c']];
  var FAG = FN.map(function (f, i) {
    var list = byCluster[(i * 2 + 1) % 12] || [];
    var last = list.length ? span(list[list.length - 1]) : '暂无';
    return {id:f[0], role:f[1], c:f[2], beat:[list.length + ' 条', last, '队列 ' + (list.length % 5), '已同步']};
  });
  var FORMS = [['humanoid','HUMANOID 人形机器人','HUMANOID'],
               ['engine','RAPTOR-CLASS 推进单元','RAPTOR-CLASS'],
               ['line','ASSEMBLY LINE 工业产线','ASSEMBLY LINE']];
  var ELE = [['时间','WHEN'], ['来源','SOURCE'], ['情绪','MOOD'], ['关键词','KEY'],
             ['人物','WHO'], ['关联','LINK'], ['结论','RESULT']];
  var FJOB = mem.slice(-3).reverse().map(function (m, i) {
    var f = FORMS[i % 3];
    return {
      id: 'M-' + (function (v) { return v < 10 ? '0' + v : String(v); })(mem.length - i),
      title: span(m) || '一条还没写内容的记忆',
      form: f[0], formName: f[1], short: f[2],
      parts: ELE.map(function (e, k) {
        var task = k === 0 ? String(m.date || '今天') : span(m);
        if (k === 1) task = String(m.source || 'local');
        if (k === 3) task = String(m.wmkind || 'event');
        return {n:e[0], en:e[1], task:task, ag:FN[k % 8][0]};
      })
    };
  });

  // 11 条记忆通路：一条记忆从进簇 → 过门控 → 落库。
  // 关键：只给**有记忆的簇**开通路，否则屏幕会一直在念「空簇」，比假数据更难看。
  // 簇数量不够 11 条时，用「混合通路」把已有簇再组合一遍，凑满原版骨架的 11 条。
  var live = [];
  for (var c2 = 1; c2 < 12; c2++) if (c2 !== 7 && byCluster[c2].length) live.push(c2);
  var PATH = [];
  var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
  var route = function (c3) { return c3 === 4 ? [c3, 7, 12] : [c3, 4, 7, 12]; };
  live.forEach(function (c3, i) {
    PATH.push({id:'W' + pad2(i + 1), zh:CL[c3].zh + '通路', ch:i % 6, path:route(c3), cl:c3});
  });
  if (!live.length) {
    PATH.push({id:'W01', zh:'空通路', ch:0, path:[2, 7, 12], cl:2});
  } else {
    var mix = 0;
    while (PATH.length < 11) {
      var src = live[mix % live.length];
      PATH.push({id:'W' + pad2(PATH.length + 1), zh:'混合通路 ' + (++mix), ch:PATH.length % 6, path:route(src), cl:src});
    }
  }
  var WF = PATH.map(function (p) {
    var names = byCluster[p.cl].slice(-3).map(span).filter(Boolean);
    if (!names.length) names = ['（还没记忆）'];
    return {id:p.id, zh:p.zh, ch:p.ch, path:p.path, names:names};
  });

  // 6 个来源通道：按 source 统计条数（en 留着，原版通道标签要用）
  var SRCN = [['DSH对话','DSH','#ff4458','local'], ['QQ对话','QQ','#ffd23f','qq'], ['面板手记','PANEL','#3b7cff','panel'],
              ['历史导入','IMPORT','#2fd27a','import'], ['宫殿镜像','PALACE','#ff5cae','dafeiyu'], ['系统','SYS','#9aa6ff','sys']];
  var CH = SRCN.map(function (s) {
    var n = 0; for (var i2 = 0; i2 < mem.length; i2++) if ((mem[i2].source || 'local') === s[3]) n++;
    return {zh:s[0], en:s[1], col:s[2], n:n};
  });

  // 01 OPS 用的是 CONFIG 对象（不是 AG 数组），所以不去改它的对象字面量，
  // 而是在它下面接管三个数组：单元 / 任务名 / 工作流。
  var OPS = {
    agents: CL.slice(1, 13).map(function (c, i) {
      var n = i + 1;
      return [(n < 10 ? '0' + n : String(n)), c.zh];
    }),
    taskNames: (function () {
      var a = mem.slice(-16).map(span);
      while (a.length < 16) a.push('（还没记忆）');
      return a;
    })(),
    workflows: WF.map(function (w) { return w.zh; })
  };

  // 刷新模块：数据是页面启动时同步取的，按钮直接整页重载，保证拿到最新 diary。
  try {
    var btn = document.createElement('button');
    btn.textContent = '⟳ 刷新记忆';
    btn.title = '重新拉一次 diary，显示最新记忆';
    btn.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:8px 16px;'
      + 'border-radius:999px;border:1px solid #2b6a8a;background:rgba(10,22,34,.86);color:#9fe6ff;'
      + 'font:600 13px "Microsoft YaHei",sans-serif;cursor:pointer;backdrop-filter:blur(6px)';
    btn.onclick = function () { location.reload(); };
    btn.onmouseenter = function () { btn.style.borderColor = '#4ecbff'; };
    btn.onmouseleave = function () { btn.style.borderColor = '#2b6a8a'; };
    (document.body || document.documentElement).appendChild(btn);
  } catch (e) { console.warn('[whale-mind] 刷新按钮没挂上：', e && e.message); }

  window.__WM_RING__ = {
    agents: AG, pathways: WF, sources: CH,
    checks: ['去重', '隐私', '时效', '矛盾', '置信度'],
    nebula: { agents: AGN, pathways: WF },
    forge: { agents: FAG, jobs: FJOB },
    ops: OPS,
    clusters: byCluster.map(function (list, i) { return {k:CL[i].k, zh:CL[i].zh, n:list.length}; }),
    stats: { total: mem.length, rules: rules.length, sources: CH.map(function (c) { return c.zh + ' ' + c.n; }) }
  };
  console.log('[whale-mind] 记忆星环已接入真实数据：' + mem.length + ' 条 / ' + live.length + ' 个有记忆的簇 / ' + WF.length + ' 条通路');
})();
</script>
`;
must('头部注入点 </head>', html.includes('</head>'));
html = html.replace('</head>', BOOT + '</head>');

/* ---------- ② 只改 mountNeural 的配置块 ---------- */
const mStart = html.indexOf('function mountNeural(host, SR){');
const mSec2 = html.indexOf('/* ================= 2. 模拟状态（接真实数据时替换这一段） ================= */', mStart);
must('mountNeural 起点', mStart > 0);
must('mountNeural 配置结束标记', mSec2 > mStart);

function wrap(name, indent = '') {
  // 有真实数据 → 用记忆版；没有 → 原样退回
  return `${indent}const ${name} = (window.__WM_RING__ && window.__WM_RING__.${name === 'AG' ? 'agents' : name === 'WF' ? 'pathways' : name === 'CH' ? 'sources' : 'checks'}) || `;
}

let cfg = html.slice(mStart, mSec2);
const origCfg = cfg;

cfg = cfg.replace(/const AG = \[[\s\S]*?\n\];/, (m0) => {
  const inner = m0.replace(/^const AG = /, '');
  return `const AG = (window.__WM_RING__ && window.__WM_RING__.agents) || ${inner};`;
});
cfg = cfg.replace(/const WF = \[[\s\S]*?\n\];/, (m0) => {
  const inner = m0.replace(/^const WF = /, '');
  return `const WF = (window.__WM_RING__ && window.__WM_RING__.pathways) || ${inner};`;
});
cfg = cfg.replace(/const CH = \[[\s\S]*?\];/, (m0) => {
  const inner = m0.replace(/^const CH = /, '');
  return `const CH = (window.__WM_RING__ && window.__WM_RING__.sources) || ${inner};`;
});
cfg = cfg.replace(/const CHECKS = \[[\s\S]*?\];/, (m0) => {
  const inner = m0.replace(/^const CHECKS = /, '');
  return `const CHECKS = (window.__WM_RING__ && window.__WM_RING__.checks) || ${inner};`;
});
must('AG 接入点', cfg !== origCfg && cfg.includes('__WM_RING__.agents'));
must('WF 接入点', cfg.includes('__WM_RING__.pathways'));
must('CH 接入点', cfg.includes('__WM_RING__.sources'));
must('CHECKS 接入点', cfg.includes('__WM_RING__.checks'));
html = html.slice(0, mStart) + cfg + html.slice(mSec2);

/* ---------- ③ 动词与 id 前缀：派单→召回 等（只在该主题范围内） ---------- */
const mEnd = html.indexOf('function mountFactory(host, SR){', mStart);
must('mountNeural 结束边界', mEnd > mStart);
let neu = html.slice(mStart, mEnd);
const VERBS = [
  ["'派单'", "'召回'"], ["'接手'", "'激活'"], ["'打回'", "'拦截'"],
  ["'交接'", "'传导'"], ["'交付'", "'注入'"], ["'抓 bug'", "'衰减'"], ["'巡检'", "'遗忘扫描'"],
  ["lastDispatch = 'T-040'", "lastDispatch = 'M-000'"],
  ["'T-' + pad(++tid, 3)", "'M-' + pad(++tid, 3)"],
];
let verbHit = 0;
for (const [a, b] of VERBS) { const before = neu; neu = neu.split(a).join(b); if (neu !== before) verbHit++; }
must(`动词替换（命中 ${verbHit}/${VERBS.length}）`, verbHit >= 5);
html = html.slice(0, mStart) + neu + html.slice(mEnd);

/* ---------- ④ tpl-neural 内的静态文案 ---------- */
const t0 = html.indexOf('<template id="tpl-neural">');
const t1 = html.indexOf('</template>', t0);
must('tpl-neural 范围', t0 > 0 && t1 > t0);
let tpl = html.slice(t0, t1);
const TEXT = [
  ['CHIEF 拆单 · 12 个智能体接力 · CRAWLER 巡检', '记忆核心调度 · 12 个记忆簇接力 · 遗忘扫描巡逻'],
  ['<span class="cv" id="capV">派单</span>', '<span class="cv" id="capV">召回</span>'],
  ['NEURAL RING<i>神经星环 · 示例数据</i>', 'NEURAL RING<i>记忆星环 · 真实记忆</i>'],
  ['<h1><span>NEURAL</span><span>RING<em>神经星环</em></span></h1>', '<h1><span>NEURAL</span><span>RING<em>记忆星环</em></span></h1>'],
  ['<h2>NEURON CLUSTERS<i>神经团</i></h2>', '<h2>MEMORY CLUSTERS<i>记忆簇</i></h2>'],
  ['<h2>SYNAPTIC ACTIVITY<i>神经活动</i></h2>', '<h2>SYNAPTIC ACTIVITY<i>记忆激活</i></h2>'],
  ['<h2>SIGNAL FEED<i>突触日志</i></h2>', '<h2>SIGNAL FEED<i>记忆日志</i></h2>'],
  ['<h2>CRAWLER<i>巡检蛛</i></h2><span>先读再派</span>', '<h2>DECAY SCAN<i>遗忘扫描</i></h2><span>找出该衰减的</span>'],
  ['<span class="l">DELIVERED TODAY<i>今日交付</i></span>', '<span class="l">INJECTED TODAY<i>本轮注入</i></span>'],
  ['今日交付', '本轮注入'],
  ['在跑智能体', '活跃记忆簇'],
  ['神经星环：13 个智能体神经团，脉冲沿突触束在它们之间传递任务。拖动可转动视角，点击神经团可聚焦',
   '记忆星环：13 个记忆簇，脉冲沿突触束在它们之间传递被召回的记忆。拖动可转动视角，点击记忆簇可聚焦'],
];
let textHit = 0;
for (const [a, b] of TEXT) { const before = tpl; tpl = tpl.split(a).join(b); if (tpl !== before) textHit++; }
must(`tpl-neural 文案（命中 ${textHit}/${TEXT.length}）`, textHit >= 10);
html = html.slice(0, t0) + tpl + html.slice(t1);

/* ---------- ⑤ 主题选择卡 ---------- */
const CARD = [
  ['<b>03 · NEURAL 神经星环</b><small>13 个神经团 · 突触脉冲派单 · HUD 星环</small>',
   '<b>03 · NEURAL 记忆星环</b><small>13 个记忆簇 · 突触激活召回 · HUD 星环</small>'],
];
for (const [a, b] of CARD) html = html.split(a).join(b);

/* ---------- ⑥ 05 NEBULA：只换数据源，画面和骨架一律不动 ---------- */
const nbStart = html.indexOf('function mountNebula(host, SR){');
const nbEnd = html.indexOf('function mountForge(host, SR){', nbStart);
must('mountNebula 起点', nbStart > 0);
must('mountNebula 结束边界', nbEnd > nbStart);
let neb = html.slice(nbStart, nbEnd);
for (const [key, re, decl] of [
  ['agents', /const AG = \[[\s\S]*?\n\];/, 'const AG'],
  ['pathways', /const WF = \[[\s\S]*?\n\];/, 'const WF'],
]) {
  const before = neb;
  neb = neb.replace(re, (m0) => {
    const inner = m0.slice(decl.length + 3);
    return `${decl} = (window.__WM_RING__ && window.__WM_RING__.nebula && window.__WM_RING__.nebula.${key}) || ${inner};`;
  });
  must(`NEBULA ${key} 接入点`, neb !== before);
}
html = html.slice(0, nbStart) + neb + html.slice(nbEnd);

/* ---------- ⑦ 06 FORGE：机器人和工单都换成记忆 ---------- */
const fgStart = html.indexOf('function mountForge(host, SR){');
const fgEnd = html.indexOf('function mountIon(host, SR){', fgStart);
must('mountForge 起点', fgStart > 0);
must('mountForge 结束边界', fgEnd > fgStart);
let forge = html.slice(fgStart, fgEnd);
for (const [key, re, decl] of [
  ['agents', /var AGENTS = \[[\s\S]*?\n\];/, 'var AGENTS'],
  ['jobs', /var JOBS = \[[\s\S]*?\n\];/, 'var JOBS'],
]) {
  const before = forge;
  forge = forge.replace(re, (m0) => {
    const inner = m0.slice(decl.length + 3);
    return `${decl} = (window.__WM_RING__ && window.__WM_RING__.forge && window.__WM_RING__.forge.${key}) || ${inner};`;
  });
  must(`FORGE ${key} 接入点`, forge !== before);
}
html = html.slice(0, fgStart) + forge + html.slice(fgEnd);

/* ---------- ⑧ 01 OPS：CONFIG 对象不改字面量，只接管它下面三个数组 ---------- */
const opStart = html.indexOf('function mountOps(host, SR){');
const opEnd = html.indexOf('function mountSpider(host, SR){', opStart);
must('mountOps 起点', opStart > 0);
must('mountOps 结束边界', opEnd > opStart);
{
  const marker = '/* ================= 2. 工具 ================= */';
  const at = html.indexOf(marker, opStart);
  must('OPS 配置块边界', at > opStart && at < opEnd);
  const inject = `// whale-mind：数据换成真实记忆（样式与骨架不动）
if (window.__WM_RING__ && window.__WM_RING__.ops) {
  CONFIG.agents = window.__WM_RING__.ops.agents;
  CONFIG.taskNames = window.__WM_RING__.ops.taskNames;
  CONFIG.workflows = window.__WM_RING__.ops.workflows;
}

`;
  html = html.slice(0, at) + inject + html.slice(at);
}

/* ---------- ⑨ 文案：把战术屏的词换成记忆语义（只动显示文字，不碰标识符） ---------- */
function swapIn(from, to, pairs, label) {
  let seg = html.slice(from, to), hit = 0;
  for (const [a, b] of pairs) { const before = seg; seg = seg.split(a).join(b); if (seg !== before) hit++; }
  html = html.slice(0, from) + seg + html.slice(to);
  must(`${label}（命中 ${hit}/${pairs.length}）`, hit >= Math.ceil(pairs.length * 0.55));
  return hit;
}
function swapTemplate(id, pairs, label) {
  const a = html.indexOf(`<template id="tpl-${id}">`);
  const b = html.indexOf('</template>', a);
  must(`tpl-${id} 范围`, a > 0 && b > a);
  return swapIn(a, b, pairs, label);
}

swapTemplate('nebula', [
  ['· SPEC CRAWL', '· MEMORY CRAWL'],
  ['星核蜘蛛', '记忆审判'],
  ['星云蛛逐字审需求 · 模糊词打上断言 · 评分过线才派单', '记忆逐条过审 · 含混处补成断言 · 质量过线才落库'],
  ['示例数据 · 本地模拟 · 未接模型', '真实记忆 · 本地 diary · 已接库'],
  ['BRIEF', 'BRIEF'],
  ['读需求', '读记忆'],
  ['CRAWL LOG', 'RECALL LOG'],
  ['爬取日志', '召回日志'],
  ['SPEC RADAR', 'MEMORY RADAR'],
  ['需求质量', '记忆质量'],
  ['负责人', '来源'],
  ['验收点', '证据'],
  ['WORD HEAT', 'KEYWORD HEAT'],
  ['读词热力', '关键词热力'],
  ['读词 / 分钟', '召回 / 分钟'],
  ['连线 linked', '关联 linked'],
  ['标红 flagged', '存疑 flagged'],
  ['瞎猜 guessed', '推断 inferred'],
  ['SPEC SCORE', 'MEMORY SCORE'],
  ['需求评分', '记忆质量分'],
  ['CRAWLER.PY', 'AUDIT.PY'],
  ['审查脚本', '审判脚本'],
  ['今日派单', '今日召回'],
  ['模糊词补齐', '含混处补全'],
  ['平均评分', '平均质量分'],
  ['星核蜘蛛 · 示例数据', '记忆审判 · 真实记忆'],
  ['当前需求', '当前记忆'],
], 'NEBULA 文案');

swapTemplate('forge', [
  ['· EVENT HORIZON', '· MEMORY FORGE'],
  ['视界熔炉', '记忆熔炉'],
  ['子 Agent 情报汇入黑洞 · 星核锻造成工单零件 · 逐件验收交付',
   '一段经历汇入熔炉 · 熔成一条长期记忆 · 逐条校验落库'],
  ['示例数据 · 本地模拟 · 未接模型', '真实记忆 · 本地 diary · 已接库'],
  ['子 AGENT 阵列', '记忆职能阵列'],
  ['交付|DELIVER', '落库|DELIVER'],
  ['锻造工位 · FORGE BAY', '记忆工位 · FORGE BAY'],
  ['WAITING FOR CORE', 'WAITING FOR MEM'],
  ['等待星核成形', '等待熔炉就绪'],
  ['解析需求', '提取要点'],
  ['生成方案', '归类'],
  ['执行改动', '情绪标注'],
  ['交叉校验', '去重'],
  ['合并入核', '落库'],
  ['交付记录 · DELIVERED', '落库记录 · DELIVERED'],
  ['星核遥测 · CORE TELEMETRY', '熔炉遥测 · CORE TELEMETRY'],
  ['星核质量', '记忆质量'],
  ['交付工单', '已落库'],
  ['今日交付', '今日落库'],
], 'FORGE 文案');

swapTemplate('ops', [
  ['12 AGENTS / DISPATCH', '12 CLUSTERS / RECALL'],
  ['TASKS → AGENTS → OUTPUTS · 示例数据 ·', '记忆 → 记忆簇 → 注入 · 真实数据 ·'],
  ['AGENT OPS / ', 'MEMORY OPS / '],
  ['WORKFLOW / REVIEW STATE', 'PATHWAY / REVIEW STATE'],
  ['TASK FEED', 'MEMORY FEED'],
  ['任务流', '记忆流'],
  ['AGENTS', 'CLUSTERS'],
  ['WORKFLOWS', 'PATHWAYS'],
  ['TASKS', 'MEMORIES'],
  ['OUTPUTS', 'INJECTED'],
  ['调度中心', '记忆调度'],
  ['智能体', '记忆簇'],
  ['工作流', '通路'],
  ['任务', '记忆'],
  ['产出', '已注入'],
  ['已匹配', '已归位'],
  ['待复核', '待核实'],
], 'OPS 文案');

/* ---------- 导出 ---------- */
fs.writeFileSync(OUT, html, 'utf8');
const kb = (n) => (n / 1024).toFixed(0) + 'KB';
console.log(report.join('\n'));
console.log(`\n原版  ring.html        ${kb(fs.statSync(SRC).size)}`);
console.log(`改造版 ring-memory.html ${kb(fs.statSync(OUT).size)}  (只改了 NEURAL 一个主题)`);
