# 分析：pstack 里哪些规则该从提示词搬进运行时

## 结论

pstack 的第 24 条原则 `encode-lessons-in-structure` 要求“能写成 lint、运行时检查或脚本的规则，就不要再多写一段文字”。但 pstack 自己只能以 `SKILL.md` 分发，所以它的大量规则仍然是文字。做成 DeepSeek Harness（下称 DSH）插件后，这些规则里凡是关于**顺序、事实、数字**的，都能交给运行时执行；关于**品味和判断**的，继续留在技能文本里。

本仓库已经把第一批搬完并在真实 DSH 里验证（见 [路线图](04-roadmap.md) 的 M0）。本文说明划分依据，以及调研后对最初设想做的修正。

## 一、规则盘点

“强制方式”一列的含义：

- **否决**：`ctx.tools.guard()`。同步、单调，别的插件无法把它改回放行。模型收到原因和改法后自行重写命令。
- **审批**：`tools/pre-execute` 返回 `ask`，由 `ctx.approval` 交给人决定。没有人能回答时默认拒绝。
- **拉回**：`agent/turn-stopping` 里调用 `agent.steer()`，模型想结束本轮时被要求先补做。
- **接管**：这件事不再由模型做，改由插件代码做，模型只拿结果。

| pstack 原文（出处） | 现在靠什么 | 插件里的强制方式 | 状态 |
|---|---|---|---|
| “`git add <files>`, never `-A`”（`playbooks/hillclimb.md`） | 模型自觉 | 否决，并告诉模型改成按路径暂存 | 已实现 |
| “Open every PR ready for review, never as a draft”（`poteto-mode/worker.md`） | 模型自觉 | 否决 `gh pr create --draft` | 已实现 |
| “Always pause for irreversible writes: force-push to shared branches, deploys”（`poteto-mode/SKILL.md`） | 模型自觉 | 审批 | 已实现 |
| “Never rebase, retarget, or force-push”（`playbooks/babysit.md`） | 模型自觉 | babysit 期间把审批升级为否决 | 内核已实现，按 playbook 自动切换在 M1 |
| “Write the failing test first… Run the new test before fixing”（`skills/tdd`） | 模型自觉 | 状态机：没见到红灯前否决对生产代码的写入 | 内核已实现，接线在 M1 |
| “Copy its steps into the todolist tool first”（`poteto-mode/SKILL.md`） | 模型自觉 | 接管：插件解析 playbook，直接写入步骤 | 解析器已实现，接线在 M1 |
| “Cite only principles whose leaf SKILL.md you read this session” | 模型自觉 | 拉回：回复里点了没读过的原则，要求先读或删掉 | 内核已实现，接线在 M1 |
| “one row per decision… Append-only”（`show-me-your-work`） | 模型调用 `log.sh` | 接管：插件写日志，模型无法改历史 | 内核已实现（与 `log.sh` 逐字节一致），接线在 M1 |
| “The judge is never from the parent's vendor”（`skills/arena`） | 模型解析一个 Markdown 配置文件 | 接管：代码挑裁判，证明不了不同厂商就不选 | 内核已实现，编排在 M2 |
| “A finding survives only when a run proves it”（`skills/interrogate`） | 主代理手动重跑 | 接管：插件重跑复现命令，跑不挂的结论不进上下文 | M2 |
| “median of N… Accept only when the metric moves past noise and the gate stays green”（`playbooks/hillclimb.md`） | 模型自己跑、自己算、自己判 | 接管：插件采样、算中位数和噪声、判定保留或回滚 | 内核已实现，实验台在 M3 |
| “build the measurement harness… then freeze it”（同上） | 模型自觉不去改 | 否决：冻结后对基准文件的写入一律拒绝 | 漂移检测已实现，接线在 M3 |

## 二、调研后的修正

最初的设想基于对 DSH 的印象。读完 DSH 源码并实际加载插件后，下面这些需要改。左列是原设想，右列是 DSH 里实际能做的。标“未运行”的条目来自源码阅读，本仓库还没有代码验证它。

| 原设想 | DSH 的实际情况 |
|---|---|
| 用 “Shell Seam” 拦截命令 | Seam 是可替换的能力提供者，不是拦截层，DSH 里没有 “intercept layer” 这个概念。拦截工具调用的正路是 `ctx.tools.guard()` 和 `tools/pre-execute`。已验证。 |
| 拦下 `git add -A` 后自动降级成安全命令 | 做不到。DSH 明确不允许改写工具参数，因为日志、界面和实际执行必须一致。只能否决并把正确写法告诉模型，模型下一步自己改。 |
| 进入只读阶段时卸载写文件工具 | 能做，但只能按代理做：`agent.ctx.tools.restrict({ deny })`。在根上下文调用会抛错。还要配一个 guard 兜住已发出的旧调用。未运行。 |
| 终端常驻状态栏 | DSH 没有 TUI，也没有名叫 status bar 的槽位。可扩展的界面只有 Web 客户端（桌面版共用）。最接近的位置是输入框上方的 `conversation.input.dock`。 |
| 读取已注册的 Provider，保证裁判来自不同厂商 | DSH 里模型用 `{ provider, model }` 一对值标识，没有厂商字段，而且 provider 可能是转发多家模型的网关。厂商得自己判断，见 [`model-routing.ts`](../src/core/model-routing.ts)。判断不出时不当作“不同”。 |
| 一键创建 N 个 worktree | `ctx.worktrees` 是实验包：`create()` 会把调用者自己的会话切进新目录，而且没有公开的删除接口。更稳的做法是通过 `ctx.subprocess` 自己跑 `git worktree add/remove`，把路径作为 `cwd` 传给子代理。未运行。 |
| 并发拉起异构模型 | `ctx.subagents.startActivation({ agentOptions: { provider, model, reasoningEffort }, delivery: 'caller' })`。一棵代理树默认最多 8 个活跃子代理，超了直接拒绝、不排队，所以要自己排队。Claude Code 和 Codex 两个外部提供者的模型写死在各自配置里，不能按次指定。未运行。 |
| 给子代理单独指定工具白名单和系统提示 | 生成子代理时不能指定。只能预先声明成 Agent Preset，再用 `agentPreset` 选它。所以 `poteto-agent`、只读的 `comment-sicko`、评审员、裁判都要做成 preset。未运行。 |
| 把决策记录写进会话日志 | 不能。仓库外的插件往会话日志里写自定义事件类型，会让这个会话再也打不开。要么从已有事件推导（`ctx.sessionProjections`），要么存进 `ctx.storageDomain`。 |
| 监听“技能被加载”事件来做反假读校验 | 没有这个事件。改为观察 `tools/result` 里的 `skill` 和 `read` 调用，以及用户消息的 `skill-invocation` 来源。 |
| autopilot 做成守护进程，定时巡检 | 代码定时器用 `ctx.interval`。`ctx.schedule` 是“按时把一段提示词投进会话”，最短 60 秒，正好对应 pstack 依赖的 `/loop 1h`。`ctx.goals` 对应“定义完成条件后一直跑”。webhook 运行时是实验包。未运行。 |
| `/correct` 生成新规则并热加载 | 可行，因为护栏规则本来就是数据（正则和分支名）。写回用 `configEditor.edit`，DSH 会自动重载插件。未运行。 |

还有一条影响界面设计：审批策略为 `never` 的会话（`danger-full-access` 权限预设）里，`ask` 会被直接拒绝而不弹窗。对强推这类规则来说结果仍然是安全的，但用户会看到“被拒绝”而不是“被询问”，界面上要说明原因。

## 三、不该做成硬门禁的

运行时擅长检查发生了什么，不擅长检查做得好不好。下面这些留在技能文本里：

- **测试是否因为预期的原因失败。** TDD 门禁只保证先红后绿的顺序。红灯是不是编译错误，得模型自己看。
- **改动是否最小。** `laziness-protocol` 没有可计算的定义。
- **文字好坏。** `unslop` 和 `technical-writing` 是风格判断。
- **该不该写测试。** `tdd` 技能明确说便宜才写，所以门禁必须由人打开和关闭，不能默认开启，也不能让模型自己关。

第四条对应 DSH 的一条实践：放宽策略的动作只属于用户，代理不应该有对应的工具。

## 四、为什么先做 DSH

- **机制对得上。** 上表右列的每一种强制方式，DSH 都有文档化的扩展点。
- **副作用可逆。** 所有注册都挂在 `ctx.effect` 上，插件卸载或代理销毁时自动撤销。“进入 playbook 时收紧、退出时恢复”不需要自己写清理代码。
- **可以按行开关。** 一个 bundle 能插入多行插件，用户在插件页逐行启停。不想要 TDD 门禁的人关掉那一行即可。
- **有界面。** pstack 的 `ketchup`、`arena`、`hillclimb` 都在往聊天里吐长文本，这些内容本来是表格、图表和待决事项。
