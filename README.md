# dsh-pstack

[pstack](https://github.com/backnotprop/pstack) 的 DeepSeek Harness 插件：poteto-mode 和它的全部技能，外加一件纯技能做不到的事——**凡是运行时能强制执行的规则，不再靠模型自觉**。

pstack 以 `SKILL.md` 分发，所以“只提交你改过的文件”“先写失败的测试”“裁判必须来自另一家厂商”这些规则都只是文字，模型一上头就会跳过。本插件把它们接到 DSH 的工具管线上。

## 现在能做什么

| | 状态 |
|---|---|
| 58 个 pstack 技能、22 个 playbook、24 条原则，输入 `/poteto-mode` 即用 | 可用 |
| 否决 `git add -A`、`git commit -a`、草稿 PR，并告诉模型正确写法 | 可用 |
| 强推、发布、部署之前先向你确认 | 可用 |
| TDD 门禁、playbook 进度、决策日志、原则引用审计 | 内核已写好并有测试，尚未接入 DSH |
| arena、interrogate、swarm 的多模型编排，跨厂商裁判 | 裁判选择已写好，编排未做 |
| hillclimb 实验台 | 判定逻辑已写好，实验台未做 |
| Web 界面 | 只有规划和可视稿 |

“可用” 的两项已在真实的 DSH 0.2.2-rc.5 里加载验证。其余见[路线图](docs/04-roadmap.md)。

## 安装

需要 Node 24.9 以上和 DSH 0.2.2-rc.5 以上。

```bash
git clone https://github.com/qybaihe/dsh-pstack.git
```

```bash
dsh plugin --profile web add ./dsh-pstack
```

如果 pnpm 报 `ERR_PNPM_ADDING_TO_ROOT`，在 `add` 后面加 `-w`。装好后新开一个会话，输入 `/poteto-mode` 加你的任务。

两行插件可以在 **Plugins** 页分别启停。要改护栏规则，在你自己配置的 `cordis.patch.yml` 里按 id 重写这一行：

```yaml
- id: pstack-guard
  name: '@qybaihe/dsh-pstack/guard'
  config:
    protectedBranches: [main, release]
    askPatterns: ['^make deploy\b']
```

`config` 是整体替换，没写的字段回到默认值。

## 开发

```bash
pnpm install
```

```bash
pnpm run check
```

```bash
pnpm run smoke
```

`check` 是类型检查、单元测试和构建。`smoke` 会下载 DSH，把构建产物装进一个临时配置并在真实运行时里检查，不碰你自己的 DSH 配置，不调用模型。改了 `src/` 之后要重新构建并提交 `lib/`，因为 DSH 从 git 安装插件时不跑构建。

更新上游技能：

```bash
pnpm run sync:pstack
```

## 目录

```
src/core/      规则内核，纯函数，不依赖 DSH
src/skills/    插件：技能提供者
src/guard/     插件：命令护栏
vendor/pstack/ 上游技能原文，见 UPSTREAM.json
scripts/       同步脚本与冒烟测试
docs/          分析、架构、界面规划、路线图
```

## 文档

1. [分析：哪些规则该搬进运行时](docs/01-analysis.md)
2. [架构](docs/02-architecture.md)
3. [界面规划](docs/03-ui.md)，[可视稿](docs/ui/mockup.html)
4. [路线图](docs/04-roadmap.md)

## 注意

命令护栏防的是模型手滑，不是安全边界。它看得懂 `bash -c`、`env`、`sudo` 这些包装，看不懂别名和脚本文件。

DSH 的插件接口尚未稳定。升级 DSH 之前先跑一遍 `pnpm run smoke`。

## 许可

MIT。`vendor/pstack` 下的技能来自 [backnotprop/pstack](https://github.com/backnotprop/pstack)，它是 [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack) 的镜像，作者 Lauren Tan，同为 MIT 许可，许可文本保留在 [`vendor/pstack/LICENSE`](vendor/pstack/LICENSE)。
