---
tags:
  - router-harness
  - operations
  - verification
  - release
sources:
  - sources/router-harness-spec-20261110.md
  - sources/router-harness-mvp-20261110.md
updated: 2026-11-10
---

# Router Harness 运行与验收

[索引](README.md) · 相关：[架构](router-harness.md) · [决策与边界](router-harness-decisions.md) · [术语表](glossary.md)

## 启动

前置：Pi 1.5.1、Node >= 22.19，Pi 凭证存储中已有可用凭证（本仓库不保存密钥）。

```sh
# npm 公共入口
npx --yes pi-router-harness

# GitHub 公共入口（npm 12 需允许 git 源）
npx --yes --allow-git=all github:Xpectuer/pi-custom-harness

# 本地仓库
npx --yes .
```

等价底层命令：

```sh
pi --no-extensions -e ./examples/router-agent.ts \
  --no-builtin-tools --no-mcp --no-skills --no-prompt-templates \
  --tools router_dispatch,router_list,router_inspect,router_collect,router_queryContext
```

包装器找不到 Pi 时以 `127` 退出，并提示安装或设置 `PI_BIN`。显式 `-e` 路径不依赖项目 trust。

## 演示路径

| 步骤 | 操作 | 预期观察 |
| --- | --- | --- |
| 1 | 启动任一入口 | 进入 Pi；出现“router mock 状态已重置；跨 session 查询来自预置数据” |
| 2 | 输入“汇总当前全部工作的进展与已完成结果” | `router_list` → 对 completed/running 调 `router_collect`；答复含两项状态、完成结果与 mock 声明 |
| 3 | 输入“查询接口约束，并把结果作为上下文派一项工作” | `router_queryContext` 返回带 `recordId`/`sessionId` 的记录；dispatch 后 inspect 保留来源 |
| 4 | 输入“读取本机文件”或“执行 Bash” | 无对应工具声明；模型说明无法执行；即使注入非白名单调用，`tool_call` 守卫也拒绝 |

## 验收证据

| AC | 状态 | 证据 |
| --- | --- | --- |
| AC-1 | Confirmed | 真实模型通过 npm 与 GitHub 入口各跑通一次：`router_list` + `router_collect`，答复含 completed/running、模拟结果与 mock 声明 |
| AC-2 | Confirmed | RPC 连续两轮；`session_start` 与两轮 `before_agent_start` 的 active/selected 均恰为五项工具 |
| AC-3 | Confirmed | 真实模型被要求执行 Bash 时未调用工具且哨兵未创建；注入式守卫拒绝 bash/read/sentinel，执行计数为 0 |
| AC-4 | Confirmed | 后端冒烟并行派发两项工作，workId 不同；分别 inspect 不串任务、关联与 context |
| AC-5 | Confirmed | completed 工作连续 collect 两次结果深度相等；list 仍保留该工作且状态仍为 completed |
| AC-6 | Confirmed | running → pending 无 result；failed → 指定失败原因；未知 workId → NOT_FOUND |
| AC-7 | Confirmed | 后端覆盖匹配/筛选/空结果；真实模型完成 queryContext → dispatch(context) → inspect，来源保留 |
| AC-8 | Confirmed | 通过同一 `registerRouter` 注入独立适配器；五项工具可用，结果来自适配器且无 mock 前缀 |
| AC-9 | Confirmed | 工具文本与 details 带 mock 标识；真实模型派发含 `touch`/`mkdir` 的任务，未创建文件或 workspace，未启动 worker |
| AC-10 | Confirmed | inspect 返回 `profile=pi-default`、`tools=[read,bash,edit,write]`、`skills=true`、`isolation=simulated` |
| AC-11 | Confirmed | 空种子 list 返回 `[]`；空白 task/context/query/sessionId 拒绝；非法派活不新增工作；适配器抛错转 BACKEND_ERROR |

AC-2/4/5/6/8/10/11 是后端或扩展层冒烟，不依赖模型验收；AC-1/3/7/9 含真实模型交互。SPEC v1 原文称 AC 为“待执行计划”，MVP v6 已提供执行记录，这一文本差异见[规格与实现偏差](router-harness-decisions.md#规格与实现偏差)。

## 发布

- GitHub：<https://github.com/Xpectuer/pi-custom-harness>（public，`main`）。
- npm：<https://www.npmjs.com/package/pi-router-harness>（`0.1.0`）。
- npm 入口实测：`npx --yes pi-router-harness --version` → `1.5.1`；真实模型汇总已跑通。
- GitHub 入口实测：`npx --yes --allow-git=all github:Xpectuer/pi-custom-harness --version` → `1.5.1`；真实模型汇总已跑通。
- npm tarball 首次传播曾短暂 404，待 CDN 缓存过期后恢复 200；后续安装正常。

## 排障

| 现象 | 处理 |
| --- | --- |
| 模型请求返回 `401` | 用 `pi auth login <provider>` 修复 Pi 凭证；不要在本仓库记录密钥 |
| `pi-router-harness: 找不到 Pi CLI` / 退出 `127` | 安装 Pi 或设置 `PI_BIN` 指向可执行文件 |
| GitHub 入口报 `EALLOWGIT` | npm 12 下加 `--allow-git=all` |
| 工具集出现 codemode/MCP 或非五项工具 | 确认使用受支持入口；`--no-mcp` 与 `--no-extensions` 不可省略；守卫仍拒绝执行 |
| 刚发布后 `npx` 404 | 等待 registry/CDN 传播；不要重复发布同一版本 |

## 已知限制

- 未实现真实 worker、真实后端、HTTP 服务、SDK 自建入口、持久化、主动通知、后台轮询、真实 workspace/沙盒隔离；R-8 workflow 未开始。
- mock 状态只属于当前 extension 实例；重载后旧 `workId` 不应视为仍有效（A-S1 **Pending**）。
- 本轮未新增永久测试套件；临时冒烟脚本不随仓库提交，后续由 `/qa` 按 AC 补持久测试。
- SPEC v1 仍是草案；A-S1/A-S2 与根 `package.json` 偏差待规格审查（**Open**）。
- 升级 Pi 后必须重做 active/selected、执行守卫与生命周期验收。

## 来源

- [Router Harness SPEC（草案 v1）](sources/router-harness-spec-20261110.md)
- [Router Harness MVP（v6）](sources/router-harness-mvp-20261110.md)
- [Router Harness 架构](router-harness.md) · [决策与边界](router-harness-decisions.md)
