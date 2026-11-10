---
title: "MVP — Pi Router Agent 接口与 Mock"
subtitle: "用一条 npx 命令启动五项协调工具的模拟汇总"
lang: zh
template: sheet
theme: blueprint
task: router-agent-harness
status: 可体验
version: v6
updated: "2026-11-10"
spec: docs/current/SPEC.md（v1）
spec_status: 草案
intent: docs/current/INTENT.md（v7，已确认）
review_surface: 1
---

## 默认审查

| 用户行为 | 本轮变化 | 需要决定 | 如何验收 |
| --- | --- | --- | --- |
| 在 Pi CLI 加载 router 后派活，只问一次整体进展，期望一次答复包含全部状态与完成结果。 | 创建公开 GitHub 仓库 `Xpectuer/pi-custom-harness`，并发布 npm 包 `pi-router-harness@0.1.0`；两种 npx 入口固定加载现有 extension 并透传参数。仍不接入真实 worker、真实后端或持久化。 | Q-S1 已解决；npm 与 GitHub 入口均已验证。A-S1、A-S2 是 SPEC 中的草案假设，仍需随规格审查确认。 | npm：`npx --yes pi-router-harness --version` → 1.5.1；GitHub：`npx --yes --allow-git=all github:Xpectuer/pi-custom-harness --version` → 1.5.1。两个入口均完成真实模型汇总。 |
| 查询其他 session 的上下文，再把记录作为上下文派活，期望来源不丢失。 | `router_queryContext` 返回带 `recordId`/`sessionId` 的合成记录，`router_dispatch` 原样保存到 `context`，`router_inspect` 可回读。 | 无新增产品决定。A-S1、A-S2 仍需规格审查。 | 真实模型已完成 `router_queryContext` → `router_dispatch(context)` → `router_inspect` 串联，来源保留；见 AC-7。 |

## 摘要

让 Pi CLI 中的 router 仅凭五项协调工具完成一次模拟汇总。npm 与 GitHub 两个公共 npx 入口均已可用，核心路径已在真实模型下跑通。

## 核心路径与范围

- **公共入口**：npm `npx --yes pi-router-harness`（0.1.0）；GitHub `npx --yes --allow-git=all github:Xpectuer/pi-custom-harness`；本地仓库 `npx --yes .`。三者固定加载 `examples/router-agent.ts`，关闭内置工具、MCP、Skill、提示词模板与其他扩展，只暴露五项 `router_*` 工具。
- **核心路径**：启动 Pi → 用户问整体进展 → `router_list` → 对 completed 调 `router_collect` → 答复包含 running/completed 状态、完成项模拟结果与 mock 声明。
- **上下文路径**：`router_queryContext` → 把返回记录放入 `router_dispatch.context` → `router_inspect` 回读 `recordId` 与 `sessionId`。
- **范围外**：真实 worker 执行、真实后端、HTTP 服务、SDK 自建入口、持久化、主动通知、后台轮询、真实 workspace/沙盒隔离、R-8 workflow。
- **mock**：进程内两项演示工作（一项 completed、一项 running）、三个跨两个 session 的合成上下文；默认派活立即 completed 且结果为固定模拟文本；worker 能力为静态描述，workspace 的 `isolation` 固定为 `simulated`；不读写文件、不启动进程、不访问网络业务接口。
- **实例边界**：mock 状态只属于当前 extension 实例；`workId` 带实例标识，退出、reload、新建、恢复或 fork 后重建并失效，启动时提示“mock 状态已重置；跨 session 查询来自预置数据”。

## 运行入口

1. 前置：Pi 1.5.1、Node >= 22.19；Pi 凭证存储中已有可用的 DeepSeek 凭证（本仓库不保存密钥）。
2. 启动：

```sh
# npm
npx --yes pi-router-harness

# 公共 GitHub 入口（npm 12 需允许 git 源）
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

3. 数据准备：无需外部种子文件；extension 实例启动时自动创建默认 mock 工作与上下文。
4. 已知失败：凭证失效时请求返回 `401`；找不到 Pi 时包装器以 `127` 退出并提示安装或设置 `PI_BIN`；npm 12 拉取 GitHub 源必须加 `--allow-git=all`；省略 `--no-mcp` 可能引入 MCP/codemode 工具（守卫仍拒绝执行）；显式 `-e` 路径不依赖项目 trust。

## 演示路径

| 步骤 | 操作 | 预期观察 |
| --- | --- | --- |
| 1 | 运行 `npx --yes pi-router-harness` | 进入 Pi；出现提示“router mock 状态已重置；跨 session 查询来自预置数据” |
| 2 | 输入“汇总当前全部工作的进展与已完成结果” | 已验证：调用 `router_list` 与 `router_collect`；答复含 running/completed、完成项模拟结果与 mock 声明 |
| 3 | 输入“查询接口约束，并把结果作为上下文派一项工作” | 已验证：`router_queryContext` 返回带 `recordId`/`sessionId` 的记录，派活后 `router_inspect` 保留来源 |
| 4 | 输入“读取本机文件”或“执行 Bash” | 已验证：模型说明没有 Bash/文件工具，未调用任何工具；哨兵文件未创建。即使注入非白名单调用，`tool_call` 守卫也在执行前拒绝 |

## 验证结果

| AC | 结果 | 说明 |
| --- | --- | --- |
| AC-1 | 已验证 | 真实模型通过 npm 打包入口与公共 GitHub 入口各跑通一次；调用 `router_list` 与 `router_collect`，答复含两项状态、完成结果与 mock 声明 |
| AC-2 | 已验证 | 按 SPEC 启动命令用 RPC 连续发两轮提示；`session_start` 与两轮 `before_agent_start` 的 active/selected 均恰为五项工具 |
| AC-3 | 已验证 | 工具声明无 read/bash/codemode/tool_search；真实模型被要求执行 Bash 后未调用工具并说明无此能力，哨兵未创建；注入式守卫对 bash/read/sentinel 均 block，执行计数为 0 |
| AC-4 | 已验证 | 后端冒烟并行派发两项任务，workId 不同；分别 inspect 的任务、worker/session/workspace 与 context 各自对应，不串结果 |
| AC-5 | 已验证 | 对 completed 工作连续 collect 两次，Outcome 深度相等；list 仍保留该工作且状态仍为 completed |
| AC-6 | 已验证 | running 返回 pending 且无 result；failed 返回指定失败原因；未知 workId 返回 NOT_FOUND |
| AC-7 | 已验证 | 后端与工具层覆盖匹配、session 筛选、空结果与来源保留；真实模型完成 `router_queryContext('接口约束')` → `router_dispatch(context)` → `router_inspect`，context 保留 `recordId`/`sessionId` |
| AC-8 | 已验证 | 通过同一 `registerRouter` 注入独立适配器；五项工具仍可用，结果来自适配器，且不带 mock 前缀 |
| AC-9 | 已验证 | 工具文本与 details 均带 mock 标识；真实模型派发含 `touch`/`mkdir` 的任务并 collect，未创建文件或 workspace，未启动 worker；答复明确否定真实执行 |
| AC-10 | 已验证 | inspect 返回 `profile=pi-default`、`tools=[read,bash,edit,write]`、`skills=true`；workspace 仅标识关联，`isolation=simulated` |
| AC-11 | 已验证 | 空种子 list 返回 `[]`；空白 task 与非法 context 返回 INVALID_ARGUMENT 且不新增工作；空白 query/sessionId 同样拒绝；适配器抛错转 BACKEND_ERROR |

```text
公共仓库：https://github.com/Xpectuer/pi-custom-harness（public，main @ bbf8469）
npm 包：https://www.npmjs.com/package/pi-router-harness（0.1.0 Public）
npm 入口：npx --yes pi-router-harness --version → 1.5.1；tarball 无查询 URL 返回 200
GitHub 入口：npx --yes --allow-git=all github:Xpectuer/pi-custom-harness --version → 1.5.1
GitHub 真实模型：router_list → router_collect ×2 → 答复含 completed/running/mock 声明
本地入口：npx --yes . --version → 1.5.1；PI_BIN=/nonexistent/pi → 127
npm pack：6 个文件，包含 bin、examples/router-agent.ts、examples/router/*

代码基线：main @ bbf8469；源码与文档已提交并推送（2026-11-10）
环境：macOS 26.2 arm64；Node v26.3.1；Pi 1.5.1；npm 12.0.2；
  DeepSeek 凭证已通过 Pi 凭证存储更新（密钥未记录）
```

## 已知限制与下一步

- npm 0.1.0 与 GitHub 入口均已可用；npm 首次传播完成后，`npx --yes pi-router-harness` 已实测返回 1.5.1。
- GitHub 入口在 npm 12 下必须加 `--allow-git=all`；首次拉取较慢，后续有缓存。
- Q-S1 已解决：AC-1、AC-3、AC-7、AC-9 已用真实模型验收。SPEC 未改写，仍为草案；密钥只保存在 Pi 凭证存储，未写入本仓库或报告。
- A-S1：mock 状态随 extension 实例重建、workId 带实例标识，属于草案假设；影响“刷新后旧 workId 是否仍有效”，由 SPEC 审查确认。
- A-S2：三模块布局与入口注入是草案设计；已用独立适配器冒烟验证可替换，无新增注册框架。
- 真实 worker、真实后端、持久化、主动通知与沙盒隔离均未实现，按 SPEC 属于范围外；R-8 workflow 仍未开始。
- 本轮未新增永久测试套件；验证使用临时冒烟脚本，后续由 `/qa` 按 AC 补持久测试。
- 升级 Pi 后必须重做 active/selected、执行守卫与生命周期验收。

## 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1 | 2026-11-10 | 初版：五项工具、后端接口与 mock、启动入口、本地验证结果与 Q-S1 阻塞说明 |
| v2 | 2026-11-10 | 真实模型验收通过 AC-1、AC-3、AC-7、AC-9；状态升级为可体验；记录 Q-S1 解决，不修改 SPEC |
| v3 | 2026-11-10 | 新增根 npx 入口、bin 包装器与 README；打包入口真实模型验收通过 |
| v4 | 2026-11-10 | 创建公开 GitHub 仓库并完成 GitHub npx 真实验收；npm 0.1.0 发布已接受，等待 registry 传播 |
| v5 | 2026-11-10 | npm 0.1.0 已公开；记录 tarball CDN 缓存短暂 404，补充 npm 与 GitHub 入口 |
| v6 | 2026-11-10 | npm tarball 与 `npx --yes pi-router-harness` 实测通过；双公共入口可用 |
