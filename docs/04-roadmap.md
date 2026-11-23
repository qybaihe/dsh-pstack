# 路线图

每个里程碑以一条能重跑的检查结束。没有这条检查通过，不算完成。

## M0 骨架、技能、命令护栏 —— 已完成

- pstack 按固定 commit 入库，同步脚本可重跑。
- 内核模块：命令策略、TDD 状态机、实验判定、决策日志、模型路由、playbook 解析、原则引用、技能文件解析、全量目录与会话投影折叠器。
- 可加载插件：`pstack-skills`、`pstack-guard`。
- 文档：分析、架构、界面规划、交互可视稿。

**检查**：`pnpm run check && pnpm run smoke`

## M1 poteto-mode 成为一等公民 —— 已完成

- 根行 `pstack`：登记 5 个 Agent Preset（`poteto-agent`、`comment-sicko`、`pstack-adversary`、`pstack-judge`、`pstack-worker`），通过 `@qybaihe/dsh-pstack/preset-role` 为 `comment-sicko` 与 `pstack-judge` 施加双重只读锁（`tools.restrict` + `tools.guard`），并注入 DSH 工具名适配说明与 `pstack` 会话投影。
- `pstack-playbook`：识别 `playbooks/*.md` 读取事件，向会话日志追加原生 `todo/write` 事件使内置 Todo 面板与薯条进度条同步（已验证 `todo/write` 为会话层原生事件，不受 preset 内部 `tool-todo` 隔离阻碍）；提供 `pstack_step` 与 `/playbook`；`babysit` 期间把强推升级为否决，`investigation` 期间收掉写工具。
- `pstack-tdd`：仅人类可控的 `/tdd on|off|status` 命令与侧栏开关，未见失败测试前否决生产文件写入并放行测试文件，红灯测试后自动放行。
- `pstack-ledger`：`pstack_log` 双写 `storageDomain` 与 `.audit/decisions.tsv`，`pstack_no_comments` 注释审计，以及 `agent/turn-stopping` 在回合结束前对“未读先引原则”与缺证据记录做自动转向提醒。
- 客户端 UI：esbuild 打包生成 `window.__ModuleLoader__.load` 格式 `lib/client.js`，实现输入框上方薯条进度条、左侧 `poteto` 徽标、新会话 Playbook 胶囊、右侧栏 `Playbook` 与 `记录` 页、会话列表尾部徽标与悬停预览、启用欢迎卡。

**检查**：`src/m1.test.ts`、`src/client.test.ts` 与 `pnpm run smoke`（在真实 DSH `web` 与 `sdk` 配置下验证 5 个 preset 全部解析且 `broken: null`、`/tdd on` 否决 `src/a.ts` 并放行 `src/a.test.ts`、红灯测试后解锁 `src/a.ts`）。

## M2 面板：arena、interrogate、swarm —— 已完成

- `pstack-panel`：多模型席位池解析、跨厂商裁判挑选（单厂商配置时显式标记 `judgeStatus: skipped` 并解释原因）、并发上限队列、绑定 `ctx.effect` 的 `git worktree` 生命周期。
- 编排工具：`pstack_arena` + `pstack_arena_adopt`、`pstack_interrogate`（在宿主机实跑每条缺陷的复现命令，退出码为 0 或无命令的臆测一律丢弃）、`pstack_swarm`（缺 SHA 或 approach 自动重派一次，仍缺则标为 `gap`）。
- 客户端 UI：Arena / Interrogate / Swarm / Comment Sicko 专属工具卡片、右侧栏 `面板` 页（评分矩阵、候选 diff 预览与一键采纳、实证缺陷列表、Swarm 切片表），以及 **Plugins** 页中 `pstack-guard`（带命令干跑试算器）与 `pstack-panel`（带跨厂商裁判实时预览）的可视化配置表单。

**检查**：`src/m2-m3-m4.test.ts` 中带真实缺陷的临时 Git 仓库夹具验证 `pstack_interrogate` 保留真缺陷并丢弃伪造结论、单厂商 `pstack_arena` 明确跳过裁判、`pstack_swarm` 重派与 `gap` 升级。

## M3 实验台：hillclimb —— 已完成

- `pstack-bench`：SHA-256 冻结基准与门禁文件，冻结期间通过 `ctx.tools.guard` 否决任何对基准/门禁文件的写入（`PSTACK_BENCH_FROZEN`），每次 `pstack_attempt` 前二次校验哈希漂移。
- 统计判定与 Git 纪律：执行 N 次基准采样与门禁命令，计算中位数、scaled MAD 与 `work` 一致性；仅当门禁通过、`work` 未变且改进超过噪声阈值与最小相对增益时，按改动文件路径执行 `git add -- <files>` 提交保留，否则自动回滚至干净工作区。
- 客户端 UI：`pstack_bench` / `pstack_attempt` 实验卡片，右侧栏 `实验` 页（当前最佳、基线、保留比大字统计，带尝试折线与 `±MAD` 噪声带的 SVG 图表，冻结锁提示与每次尝试明细表）。

**检查**：`src/m2-m3-m4.test.ts` 中可调延迟基准夹具仓库验证：真改进产生仅含改动文件的提交、噪声内改动回滚且工作区干净、`work` 变化改动回滚、冻结期间对基准文件的写入被 `PSTACK_BENCH_FROZEN` 否决。

## M4 无人值守与自演进 —— 已完成

- `pstack-autopilot`：接入 `ctx.goals` 与 `ctx.schedule` 实现定时巡检与目标轮次驱动；监控登记的子代理会话，超时无进展时自动 `interrupt` 并派发携带交接上下文的替换子代理，同时向决策账本写入替换记录；支持连续已验证 PR 栈检查（`autopilot-stack` 锁住 `gh pr merge`）与断点保存/恢复。
- `pstack_ketchup`：结构化追赶决策卡（决策点、推荐方案、改动/依据/风险与一键发送选项按钮），联动会话列表番茄红角标。
- `pstack_correct` 与 `/correct`：将经验教训编码为命令护栏规则，立即热更新当前运行态（无需重启 DSH），并通过 `ctx.configEditor` 写回配置持久化。
- 说明：`benny` 仍待上游 webhook 运行时稳定后再接入。

**检查**：`src/m2-m3-m4.test.ts`（挂起子代理被定时检测、中断并替换，账本落盘对应记录）与 `pnpm run smoke`（真实 DSH 进程内调用 `pstack_correct` 后无需重启，探针命令立即从放行变为 `PSTACK_DEPLOY` 否决）。

## 之后

`src/core/` 完全不依赖 DSH，同一套纯函数规则内核可直接复用于其他 Agent Harness 扩展，新增部分仅限宿主接线层。
