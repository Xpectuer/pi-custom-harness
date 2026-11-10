---
tags:
  - pi-durable
  - release
  - agent-harness
sources:
  - https://earendil.com/posts/pi-durable/
updated: 2026-11-10
---

# Pi Durable 发布博客（Earendil，2026-10-01）

[索引](../README.md) · 原文：<https://earendil.com/posts/pi-durable/>（抓取于 2026-11-10）

## 概要

Earendil 与 Pi 社区发布 Pi 1.0 的同一天，推出实验包 Pi Durable：面向长期运行、可崩溃恢复、可热更新、可多端接入的 agent 应用框架。博客以导览方式说明设计目标与关键机制，并给出最小代码片段与演示入口。

## 提取要点

### 定位

- Pi 1.0 定位不变：终端里、单人、跑在（远程）机器上的 coding agent；进程死掉由人看现场再让它继续。
- Pi Durable 不是 coding agent 的替代品，而是构建任意 agentic 应用的 harness；与 coding agent 共享 `pi-ai` 及极简、可塑的原则。
- 实验性包；设计经验验证后会回流到 Pi coding agent。
- 源码约 15k 行（不含测试），GPT 计约 150k tokens、Claude 约 250k tokens；storage 后端约 3k 行，agent 通常不必读。

### Harness 定义

- Harness = 存储 + 并行运行一个或多个 LLM 会话所需的机器，提供工具及其执行环境。
- 会话（conversation）是与 agent 的交互，记录为 transcript；agent = LLM + 设置（如 thinking level）+ 可调用工具。
- 工具通过 execution environment 工作：笔记本、远程 VM、内存沙箱均可；工具与环境按会话决定。
- 从模型调用到工具执行的每个动作都是 task。

### 长期运行与任意环境

- 目标是在任何有 JavaScript runtime 的地方运行；提供 memory、SQLite、JSONL 存储。
- SQLite 与 JSONL 核心不用 Node API，配小幅 adapter 可跑在 Bun 或 Cloudflare Durable Object。
- storage 接口小，可基于 KV 或 Postgres 实现；同一 storage 同时只有一个进程拥有，其他客户端附着。
- SQLite 下内存只保留 working set：活跃 transcript、live task、待处理 submission；其余在磁盘按需加载。
- 活跃 transcript 天然受模型上下文窗口约束，因为 compaction 会在溢出前总结旧消息；数万条消息的会话也能 snugly 放进内存。
- execution environment 可换远程实现：harness 跑一处、工具跑另一处；`env` 函数按会话 cwd 为每次工具调用构造环境。

### 崩溃恢复

- 每个 task 每一步先存 checkpoint；进程死亡后，新进程打开同一 storage，找到未完成 task，从最后 checkpoint 继续。
- 被切断的模型请求重发；部分回答作为 aborted entry 留在 transcript。
- 被切断的工具调用仅在安全时重跑，否则把“被中断”及已存输出告诉模型，由模型决定。
- 没有内置 subagent；subagent 只是“工具创建并拥有一个会话”，几行代码即可；子会话同样可恢复，replay-safe 的子代理工具会找回子会话并等待答案。
- 排队消息仍然排队；`requestId` 让 submission 恰好一次，崩溃后重试拿回原结果。

### 并发与 fork

- 一个 harness 可并发运行任意多会话，保证相同。
- 会话可从 transcript 任意点 fork，看到父历史而不复制。
- Slack 模型：频道是一个会话，线程是回复点上的 fork；两者同时运行、互不阻塞。
- 每个会话存自己的 agent：模型、thinking level、扩展与激活工具、附加指令、cwd；reviewer 可用更便宜模型、只读工具、独立 checkout。

### 扩展与工具

- extension = 命名的 system prompt sections + tools + hooks + tasks 捆绑；应用把扩展装进 registry，会话只存名字。
- system prompt 每次请求前由 sections 重建；变更以位置记录在 transcript，重启或 fork 看到模型当时看到的内容；支持的模型只发送变化，保住 prompt cache。
- 每次工具调用是独立 durable task，intent 先落库；崩溃后按 `replay: "safe"` 决定重跑或报中断。
- 工具结果有三通道：给模型的 `output`、给程序的 `structuredOutput`、给 UI 的 `details`；transcript 只存 output 与 details。
- 同名工具后者覆盖前者；wrap 装饰最终胜出的实现。
- hooks 可改请求、阻断/改写工具调用、替换结果、让 run 继续或自写摘要；崩溃后会重跑，因此决策写入 memo。

### 任务与所有权

- 扩展可定义 task，获得与内置 task 相同的 checkpoint、定时器与等待机制。
- task 与 conversation 构成所有权树；abort 自底向上，每个 task 先清理自己的效果再结束自己；task 只有在拥有的工作结束后才终止。
- 前台 task 属于当前工作，会话 idle 要等它们结束；Esc abort 会中止它们及其拥有的一切。
- 后台 task（`background: true`）属于会话但不属于当前工作；会话可 idle，普通 abort 不碰它。适合跨 turn 存活的 subagent 或明天的提醒。

### 上下文管理

- compaction 是普通 task，在会话继续工作时后台运行；接近模型上限时总结旧消息，摘要落在下一个 turn 边界；只有下一个请求放不下时才阻塞等待。
- provider 仍报超长时，compaction 后重试一次；旧消息始终保留。
- 可随时手动 compact 并给指令；`reset(note)` 或工具返回 `control: { handoff }` 开启新 context，旧消息仍可用 `search_history` 搜索。

### 应用状态与热更新

- 应用状态（todo、plan、ticket、sandbox）放 document：与 transcript 同库的类型化 JSON，在同一原子 commit 中改变，状态不会与 transcript 矛盾。
- document 声明 fork 时取父值（`asOf`）、当前值（`current`）或全新值（`initial`）。
- registry 可在会话运行中改变：同名安装即时替换；运行中的工具调用用旧代码跑完，下一次调用用新代码；重启后进程安装什么就用什么。

### 多人协作

- UI 需要的一切都是已提交状态；任意多客户端可附着任意会话。
- 新客户端先拿当前视图：transcript、正在流式输出的答案、运行中的工具与输出、排队消息、agent、用量；之后只收变化；晚到或重连从当前视图开始。
- 任意客户端可 steer 正在运行的会话或排队 follow-up；远程客户端 `watch()` 拿 commit 的精确 operations，或用 `watchEvents()` 转成 coding agent 风格事件。

### 可试用入口

- 指向 `packages/durable`、30+ examples、`packages/coding-agent/src/experimental/durable` 的小 coding agent、`.../vacation` 的度假规划 agent（约 1300 行，多数是 TUI，v1.0.0）。
- 演示：subagent 并行三个搜索、进程死亡、重启后只重跑未完成的 replay-safe 搜索、切换并 steer subagent、主会话同时压缩/steer、报告回来变成计划。
- 安装：`npm install @earendil-works/pi-durable @earendil-works/pi-ai @earendil-works/chord`。
- FAQ：选 TypeScript 是为快速起步；不排除未来移植 Rust 等。

## 要点落页

| 要点组 | 落入 |
|---|---|
| 定位、harness 定义、存储/环境、每会话 agent、观察与多人 | [架构](../durable-harness.md) |
| checkpoint、崩溃恢复、replay、所有权、compaction、reset | [执行语义](../durable-execution.md) |
| extension、sections、tools、hooks、wrap、热更新、subagent 模式 | [扩展与工具](../durable-extensions-and-tools.md) |
| 术语 | [术语表](../glossary.md) |

## 链接

- 原文：<https://earendil.com/posts/pi-durable/>
- 相关源：[pi-durable README（main）](pi-durable-readme.md)
- 主题：[架构](../durable-harness.md) · [执行语义](../durable-execution.md) · [扩展与工具](../durable-extensions-and-tools.md)
