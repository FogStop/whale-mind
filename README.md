# whale-mind 鲸脑 🐋🧠

给鲸鱼娘（DeepSeek Harness 桌宠 / QQ 机器人）的记忆引擎：
**短记忆 + 长记忆 + 人格内核 + 衰减遗忘 + 检索召回**，配套三风格可视化
（V1 拟真大脑 / V2 宇宙星海 / V3 赛博钟表）。非商业免费开源，商业使用需授权。

## 当前状态：M1 引擎原型 ✅（源码精读校准版）

按 feiyu-memory SPEC/源码 与 dsh-mnemon 架构逐条校准（见 `docs/学习笔记-M0.md`，带 file:line 出处）。
零依赖（Node 18+ 原生），离线可跑（本地门控 + 本地固化，0 次 API 调用）；
配置 `llm.enabled=true` 且设置 `DEEPSEEK_API_KEY` 后自动切 DeepSeek 真实判断/固化。

## 快速开始

```bash
node src/cli.js --selftest   # 自检（9 项断言，全过）
node src/cli.js --demo       # 剧本演示：记住→注入预览→跨会话召回→遗忘→体检
node src/cli.js              # 交互模式（/帮助）
```

## 引擎管线（M1-M4，1219 行 / 12 模块）

```
你说的话
→ gate    门控：模型 judge（三条听法，24 token，认不出默认记）；离线兜底；SUPPRESS_RE 用户控制
→ consolidate 固化：一次调用出 日记(kind/salience/resolved/tags) + 关系patch + forget清单；后置质量门
→ store   存储：diary/YYYY-MM.jsonl 追加 + manifest 墓碑；relationship.json
→ index   检索：score = a·sim + 0.45·salience + c·fresh − d·刚提过惩罚
          sim = 1−exp(−Σgain/τ) 饱和函数（bigram 倒排，不用向量）；softmax wander 可关
→ inject  注入：身份声明帧(不裁剪) → 我自己想的(note) → 关系 → 最近的事(永远在场)
          → 突然想起来(强相关) → 防幻觉/防投毒尾行；budgetTokens 按权重裁剪
→ decay   遗忘：每日 ×0.9，floor 0.16 —— 遗忘=降级不是删除，冷存储仍可召回
```

## 与参考项目的关系

设计校准自 feiyu-memory（MIT）与 dsh-mnemon（MIT），代码自写，致谢见 `NOTICE.md`。
差异化：**三风格可视化**（独有）+ 修掉 feiyu 评测暴露的三坑（去重/隐私打码/真删除，M2 落地）。

## 路线图

- [x] M0 源码精读（feiyu SPEC 1381 行 + core 3972 行逐模块；mnemon 架构）
- [x] M1 引擎原型（selftest 9/9）
- [x] M2 DSH 插件骨架 + 隐私三默认 + 带外队列 + HTTP 路由 + note 工具（冒烟 6/6）
- [x] M2.5 手记.md + 夜间自整理（tidy）+ /焚毁
- [x] M3 三风格可视化预览（preview/index.html：V1 拟真大脑 / V2 宇宙星海 / V3 赛博钟表）
- [x] M4 qqbot 共脑方案（同 dataDir 即同脑）+ 真机验证脚本（scripts/verify-dsh.cmd）+ 发布清单
- [ ] 真实 DSH 端到端验证（scripts/verify-dsh.cmd，需退出桌面端后跑）
- [ ] GitHub 发布 + dsh-hub 收录 + B 站演示视频（见 docs/发布清单.md）

## 许可证

**非商业用途免费，商业使用需授权** —— 详见 [LICENSE](LICENSE)。

- **免费**：个人学习、研究、自用；教学与非营利项目；非商业项目中的修改与分发（保留署名与本许可）
- **需授权**：出售、SaaS/订阅等付费服务、集成进商业产品、企业内部生产环境的商业运营
- **星环面板**（`panel/ring.html`、`panel/ring-memory.html`）基于 @赛博老爸 的「Agent 战术大屏」改造，
  其原始条款同为「非商业免费、商业需授权」，这块的商业授权需另行联系原作者

