# AGENTS.md — pi-custom-harness

## 项目定位

本仓库是 pi 的定制 harness 工作区，不是 pi 源码仓。上游源码以 git submodule 形式归档在 `modules/pi`，根仓库只放定制代码、验证方法和文档。

目标：用尽量少的核心改动，把 pi 定制成符合自己工作流的 harness。优先使用 extension 和 SDK 能力；只有绕不过去时才修改上游源码。

## 目录

| 路径 | 用途 |
|---|---|
| `modules/pi` | 上游 pi 源码归档，固定 commit `815541a`（CLI 1.5.1）。只读参考，不在其中开发或提交 |
| `examples/` | 自定义 extension / 工具示例，供 `pi -e` 直接加载 |
| `docs/` | 调研、设计、决策和实测证据；[工具调研](docs/pi-custom-tools-research.md)、[当前规格](docs/current/SPEC.md)（[评审视图](docs/current/SPEC.html)，本地任务上下文） |
| 根目录 | `package.json` 仅用于 npx 入口，`bin/pi-router-harness.mjs` 是启动包装器；无依赖和构建脚本，不要在本仓库根安装 Pi 依赖 |

## 定制原则

- 工具、命令、快捷键优先通过 extension 实现：`pi.registerTool()` 可注册新工具，也可覆盖同名内置工具。
- 默认最小工具集：`--no-builtin-tools --no-mcp` 关闭内置工具和 MCP，再用 `--tools` 收紧白名单。
- 确需修改 pi 核心时，把 pi fork 到自己的仓库并在 fork 中开发；根仓库再把 `modules/pi` 的 URL/commit 指向该 fork。不要在归档目录留下未推送的本地提交，也不要把源码复制回根目录。
- 不提交密钥。认证用 `pi auth login <provider>`，凭证存放在 `~/.pi/agent/`。
- 文档用中文，提交信息用英文；结论必须附命令或实测输出，并写入 `docs/`。

## 常用命令

```sh
# 一次性运行自定义工具集
pi -e ./examples/custom-tools.ts --no-builtin-tools --no-mcp

# 精确白名单
pi -e ./examples/custom-tools.ts --tools custom_ping --no-mcp

# 一键启动 router harness（本地；发布后用 npx --yes pi-router-harness）
npx --yes .
```

项目内固化时可写 `.pi/settings.json`：

```json
{
  "defaultTools": ["custom_ping"],
  "extensions": ["../examples/custom-tools.ts"]
}
```

`defaultTools: []` 只关闭内置工具；extension/custom/MCP 工具仍会保留。

## 验证

- 模型可见工具用 `before_agent_start` 里的 `pi.getActiveTools()` 或 `systemPromptOptions.selectedTools` 判断；`getAllTools()` 会列出未激活工具，不能作为依据。
- 真实调用需要有效 API key。当前 DeepSeek key 曾返回 401；遇到认证失败先记录为 blocker 并重新配置。
- 修改 extension 后至少运行一次上述命令，确认工具注册和工具集选择符合预期。

## 已知边界

详见 `docs/pi-custom-tools-research.md`，关键点：

- MCP 默认是 `codemode` exposure；`--no-builtin-tools` 不会关闭它，完全隔离要加 `--no-mcp`。
- `--tools` 非空时不会自动过滤 MCP；只有空列表才连 MCP 一起禁用。
- 项目 `.pi/extensions` 需要项目 trust；`-e` 显式路径不需要。
- `pi.getAllTools()` 只反映注册表，不代表模型实际可见的工具。

## 更新归档

```sh
git -C modules/pi fetch origin main
git -C modules/pi checkout <commit>
git add modules/pi
git commit -m "chore: bump pi archive to <commit>"
```

归档必须对应干净、可获取的上游 commit；定制改动留在 fork 或根仓库。

## cola-land-sdlc 的基本概念
- **cola-land-sdlc**: 为用户提供一组Skill，这组Skill层层递进，每层产出可审查的交付物。
- **软件开发**：用户的意图经过一组 cola-land-sdlc 提供的Skill，一步步可靠地实现为可交付的产品
- **项目**：自包含的文档+代码仓库，项目有1个或多个git仓库组成，agent应当在项目里得到关于软件的所有信息，包括用法、部署方法、开发贡献方法等。
- **PM系统**：用于管理追踪项目进度，将大型需求拆成可被agent和用户共同理解的一组小的实现步骤，方便用户验收，方便agent执行和自动review，往往部署在外部供应商的服务器上，典型的有github, gitlab(issues), linear,jira 等

## 元规则
- AGENTS.md 上限为 2500 tokens（固定使用 cl100k_base 计数）。每次修改后，在项目根运行 `uv run "$(git rev-parse --show-toplevel)/scripts/check-agents-tokens.py"`；超限时将非核心细节迁至 docs/ 合适目录，保留核心约束、必要摘要和相对 Markdown 链接，再检查至通过，以减少初始上下文占用。
- 所有结果文档落 docs/ 
- docs/current 是本开发者本地的当前任务上下文：已在 `.gitignore` 中忽略（可只保留 `.gitkeep`），NEVER 提交到 Git；用户未指定任务上下文时，默认从 docs/current 读取
- 所有任务上下文中间结果(e.g. INTENT.html / SPEC.html and etc) 都通过 [answer-me-with-html skill](https://github.com/QingYunA/answer-me-with-html) 呈现
- docs/archives/<dev/debug>-<brief>-<YYMMDD> 下保存了历史任务的上下文
- docs/lessons 下保存了历史任务失败中吸取的教训
- docs/rules 下是codebase规则，如coding style、best practices、security practices等
- docs/wiki 下保存了项目的历史、基本知识、基本术语等，这些会文档链接到 docs下的其他文档
- 所有文档和代码注释均描述当前状态，不得记录任何 AI 历史修改记录。更新当前状态描述不得将尚未确认的实现偏差写成新的业务规则。
  - 比如某次开发工作临时规划了 phase1 到 phase5 阶段，那么任何文档不允许记录 phase1-phase5 相关字段描述，只需要按照代码和项目现状更新文档内容即可。
  - 比如某次开发需求 A 决策是当前项目现状，B 决策是这次开发任务新的决策，且 A 决策作废，那么文档记录就不能留下 A 决策的历史，只需要记录这次新的决策 B。
- [docs/pm.yaml](docs/pm.yaml) 下保存了PM系统的信息（项目名、url、地址、秘钥等），由 /setup-pm 创建
- PM 操作优先使用 `docs/pm.yaml` 的配置，按 `default` 选择系统及对应的项目、地址和凭证；coding harness 自带的 PM MCP（如 Linear MCP）不得覆盖这些配置。仅当 MCP 的目标与认证身份均与所选配置一致时才可使用；配置缺失或不可用时先运行 /setup-pm 补齐或修复，不得自动回退到 harness 的默认 PM。用户本次明确指定的目标优先。

## 软件开发流程

软件开发的核心流程由一组skill组成（它们可能在同一会话也可能跨会话）：

```text
/intake => INTENT.html
↓
/discuss => INTENT.html with discussion result appended
↓
/to-spec => SPEC.html 规定了需求的边界、设计规格等
↓
/mvp => Minimum Viable Product 用户可以快速直观地验收并更改spec 
↓ 
/spec-to-dag => DAG in PM System
↓
/dag-to-wt (optional) => isolated worktree for agent to fix or dev feature
↓
1. /impl => IMPL-LOG.html + code diffs
2. /qa => TEST-PLAN.html + tests diffs
↓
/review-diff => REVIEW.html
```
