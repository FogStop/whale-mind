# whale-mind · 三板面板（DSH 插件）

一块面板，三个按钮，来回切换鲸鱼娘的三种记忆形态。全部是**原样采用的开源项目本体**，whale-mind 只做数据接线。

| 按钮 | 板 | 本体 | 许可 |
|---|---|---|---|
| 🧠 记忆星脑 | 3D 神经元视图，8 大分区（大脑中枢/海马体/用户灵魂/记忆库/论衡/语言中枢/插件生态/技能库） | [1DAdidi/dsh-memory-brain-plugin](https://github.com/1DAdidi/dsh-memory-brain-plugin) | 见仓库 |
| 🌀 神经星环 | 赛博老爸作战大屏 03 NEURAL：19,563 神经元 · HUD 星环 · 脉冲沿突触束流动 | [cyberdaddyleo/agent-display](https://github.com/cyberdaddyleo/agent-display) | PolyForm 非商业 ⚠️ |
| 🌌 记忆银河 | 真三维银河：时间=半径、点星拉星座连线、正文底部浮现 | [小克家 galaxy-template](https://chat.xiaoke.love/galaxy-tutorial/) | 照搭用途模板 |

## 独立预览（不需要 DSH）

```bash
cd whale-mind
npm run panel        # → http://127.0.0.1:4180/whale-mind/panel
```

## 装进 DSH

和 feiyu-memory 同一套装法：

```bash
# 1) 放插件
mkdir -p ~/.dsh/plugins && cd ~/.dsh/plugins
git clone <whale-mind 仓库> whale-mind     # 或复制本目录

# 2) 挂进 profile（桌面端默认 profiles/desktop）
#    profile 的 package.json dependencies 加一行：
#      "whale-mind": "link:C:/Users/<你>/.dsh/plugins/whale-mind"
#    dsh.profile.bundles 末尾加一项：
#      "whale-mind"
#    node_modules 下建目录联接：
#      mklink /J node_modules\whale-mind C:\Users\<你>\.dsh-plugins\whale-mind

# 3) 重启 DSH
```

重启后：**会话顶栏 / 设置 → 打开 `http://127.0.0.1:<DSH端口>/whale-mind/panel`** 即是三板面板。
记忆星脑的图数据直接来自 whale-mind 引擎的真实 store（`src/plugin.mjs` 里 `/whale-mind/panel/brain/api/graph` → `store.active()` 实时映射 8 大分区）。

## 数据接线

- 记忆星脑：`panel/brain-data.mjs` 把 diary JSONL 条目按 kind 映射到分区——
  交底→海马体·事实 / 聊天→语言中枢·话题 / 小胜→论衡·复盘 / 委屈·手记→用户灵魂 / 承诺→记忆库·项目
- 神经星环：用自带模拟器；接真实数据见其 README（agent-display 的「配置」一节）
- 记忆银河：`panel/memory.json`（stars 格式，最早的记忆自动成为银河核心）；真实接入时由 store 定时导出

## 许可

- 记忆星脑：见原仓库
- 神经星环：**PolyForm Noncommercial 1.0.0**（⚠️ whale-mind 将来 MIT 开源时需取得授权或摘除此板）
- 记忆银河：作者公开分享的照搭模板（无明确 LICENSE），个人使用；分发前与作者确认
