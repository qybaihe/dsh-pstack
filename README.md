# 🥔 dsh-pstack

[pstack](https://github.com/backnotprop/pstack) 的 DeepSeek Harness 插件：poteto-mode 和它的全部 58 个技能、5 个专用子代理预设、完整土豆视觉系统 Web/Desktop UI，外加一件纯技能做不到的事——**凡是运行时能强制执行的规则，不再靠模型自觉**。

pstack 原生以 `SKILL.md` 分发，所以“只提交你改过的文件”“先写失败的测试”“裁判必须来自另一家厂商”“引用的原则必须先读过”这些规则原本只是提示词文字，模型一上头就会跳过。本插件把它们接到 DeepSeek Harness 的工具守卫、会话事件流、子代理与定时巡检管线上。

## 功能总览（M0–M4 全部完成）

| 模块 | 插件行 ID | 运行时能力 | 状态 |
|---|---|---|---|
| 根行与 UI 宿主 | `pstack` | 注册 5 个 Agent Preset（`poteto-agent` / `comment-sicko` / `pstack-adversary` / `pstack-judge` / `pstack-worker`）、`pstack` 会话投影、DSH 工具名适配提示词、`/pstack` RPC 通道与 `./client` 浏览器包 | 已完成 |
| 技能目录 | `pstack-skills` | 提供全部 58 个 pstack 技能、22 个 Playbook、24 条工程原则；保留 `disable-model-invocation` 策略，输入 `/poteto-mode` 即用 | 已完成 |
| 命令护栏 | `pstack-guard` | 拦截 `bash`/`pwsh`：否决 `git add -A`、`git commit -a`、草稿 PR（告知模型正确写法）；强推、发布、部署前触发审批；支持 `babysit` 强推升级否决与 `/correct` 在线热更新 | 已完成 |
| Playbook 引擎 | `pstack-playbook` | 识别已读 Playbook 并同步写入原生 `todo_write` 与步骤进度，`pstack_step` 工具与 `/playbook` 命令；`investigation` 期间锁死写工具，`babysit` 期间禁止一切强推 | 已完成 |
| TDD 写入门禁 | `pstack-tdd` | 仅用户可控的 `/tdd on\|off\|status` 与侧栏开关；未见失败测试前否决生产代码写入（放行测试文件、文档与 `.audit/`），监听测试运行自动走完 `red-pending → red-observed → green` | 已完成 |
| 决策账本与审计 | `pstack-ledger` | `pstack_log` 双写 `storageDomain` 与 `.audit/decisions.tsv`；`pstack_no_comments` Comment Sicko 注释审计；`agent/turn-stopping` 在本轮结束前拦截“未读先引原则”与无证据决策行 | 已完成 |
| 多模型面板 | `pstack-panel` | 并发队列与独立 `git worktree` 生命周期：`pstack_arena`（含跨厂商裁判校验与 `pstack_arena_adopt`）、`pstack_interrogate`（宿主机实跑复现命令，剔除伪造缺陷）、`pstack_swarm`（缺 SHA/approach 单次重派与 `gap` 标记） | 已完成 |
| Hillclimb 实验台 | `pstack-bench` | SHA-256 冻结基准与门禁文件并否决篡改写入（`PSTACK_BENCH_FROZEN`）；`pstack_bench` + `pstack_attempt` 多轮采样计算中位数与 scaled MAD，显著改进且门禁全绿才按路径提交，否则干净回滚 | 已完成 |
| 无人值守与自演进 | `pstack-autopilot` | `pstack_autopilot` + `/autopilot`（接入 `ctx.goals` 与 `ctx.schedule`，卡死子代理检测、中断与交接替换，连续已验证 PR 栈检查，断点恢复）；`pstack_ketchup` 追赶决策卡；`pstack_correct` + `/correct` 规则热更新与持久化 | 已完成 |
| 土豆 Web/Desktop UI | `./client` | 覆盖全部 8 类 UI 插槽：输入框上方薯条进度条、左侧 `poteto` 徽标、新会话 Playbook 快捷胶囊、右侧栏四分页（`Playbook / 面板 / 实验 / 记录`）、会话列表尾部徽标与悬停预览、7 张专属工具卡、Plugins 行配置表单（含命令干跑试算器与席位预览）及启用欢迎卡；支持深浅色与中英双语 | 已完成 |

已在真实的 DeepSeek Harness `0.2.2-rc.3`（Desktop 内置运行时）与 `0.2.2-rc.5`（CLI）的 `sdk` 和 `web` 配置下通过端到端冒烟验证。

## 安装

需要 Node 24.9+ 与 DeepSeek Harness `>=0.2.2-rc.0 <0.3.0`。

```bash
git clone https://github.com/qybaihe/dsh-pstack.git
cd dsh-pstack
pnpm install && pnpm run build
```

安装到 DeepSeek Harness Desktop 配置（或将 `desktop` 换为 `web`）：

```bash
dsh plugin --profile desktop add -w ./dsh-pstack
```

若使用 macOS 桌面端内置 CLI，可直接调用：

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add -w /path/to/dsh-pstack
```

装好后在 **Settings → Plugins** 中可单独启停全部 9 行插件，并可视化配置 `pstack-guard`（命令护栏 + 实时干跑试算器）与 `pstack-panel`（多模型席位池 + 跨厂商裁判预览）。新开会话后输入 `/poteto-mode` 即可开始，或直接点击欢迎页的 Playbook 胶囊。

如需在自己的 `cordis.patch.yml` 中按行覆盖配置：

```yaml
- id: pstack-guard
  name: '@qybaihe/dsh-pstack/guard'
  config:
    protectedBranches: [main, release]
    askPatterns: ['^make deploy\b']
```

## 开发与验证

```bash
pnpm install
pnpm run check
pnpm run smoke
```

- `pnpm run check`：宿主机与浏览器双端 TypeScript 严格类型检查、构建 `lib/client.js`、运行全部 103 项单元/集成/UI 测试，并输出 `lib/`。
- `pnpm run smoke`：创建临时 `DSH_HOME`，在真实 DSH 的 `sdk` 与 `web` 两种配置中挂载构建产物，逐项验证 9 行插件、58 个技能、13 个工具、4 条斜杠命令、5 个子代理预设、`clientModules` 打包注册、命令护栏、TDD 红绿灯门禁与 `/correct` 在线热更新，不触碰本机真实配置，也不消耗模型调用。
- 本地指定 DSH 二进制冒烟：`node scripts/smoke-dsh.mjs --dsh-bin "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"`。
- 同步上游技能：`pnpm run sync:pstack`。

## 目录结构

```
src/
  index.ts         根插件 pstack：Agent Presets、会话投影、系统提示词适配、RPC 网关
  core/            纯函数规则内核（零 DSH 依赖，宿主机与浏览器共用）
  host/            DSH 服务窄契约与同根插件共享状态桥
  preset-role/     5 个子代理预设的角色提示词与只读工具锁
  skills/          pstack-skills：上游 58 技能目录提供者
  guard/           pstack-guard：Shell 命令护栏与动态规则
  playbook/        pstack-playbook：Playbook 识别、todo_write 同步、只读/禁强推门禁
  tdd/             pstack-tdd：/tdd 命令与先红后写门禁
  ledger/          pstack-ledger：决策日志、Comment Sicko、未读原则引用转向
  panel/           pstack-panel：arena / interrogate / swarm 并发与 worktree 编排
  bench/           pstack-bench：hillclimb 基准冻结、采样统计与按路径提交/回滚
  autopilot/       pstack-autopilot：无人值守巡检、卡死替换、ketchup 追赶卡与 /correct
client/src/        土豆视觉系统 React 客户端（8 类 UI 插槽、深浅色、中英双语）
locale/            全部插件行的中英文配置与界面文案
vendor/pstack/     上游技能原文（固定 commit，见 UPSTREAM.json）
scripts/           客户端打包脚本、上游同步脚本与真实 DSH 冒烟套件
docs/              规则分析、架构设计、UI 规范与路线图
```

## 文档

1. [分析：哪些规则该搬进运行时](docs/01-analysis.md)
2. [架构](docs/02-architecture.md)
3. [界面规划](docs/03-ui.md) 与 [交互可视稿](docs/ui/mockup.html)
4. [路线图](docs/04-roadmap.md)

## 注意

命令护栏防的是模型手滑与偷懒，不是沙盒安全边界。它能剥离 `bash -lc`、`env`、`sudo` 等常见包装，不解析自定义 shell 别名或外部脚本内部命令。

## 许可

MIT。`vendor/pstack` 下的技能来自 [backnotprop/pstack](https://github.com/backnotprop/pstack)（[cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack) 镜像，作者 Lauren Tan，MIT 许可，详见 [`vendor/pstack/LICENSE`](vendor/pstack/LICENSE)）。
