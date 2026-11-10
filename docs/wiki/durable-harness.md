---
tags:
  - pi-durable
  - architecture
  - agent-harness
sources:
  - sources/earendil-pi-durable-post.md
  - sources/pi-durable-readme.md
updated: 2026-11-10
---

# Pi Durable harness 架构

[索引](README.md) · 相关：[执行语义](durable-execution.md) · [扩展与工具](durable-extensions-and-tools.md) · [术语表](glossary.md)

## 定位

- `@earendil-works/pi-durable` 与 Pi 1.0 同日发布（2026-10-01），是**实验性**包，API 不承诺兼容。
- 它不是 Pi coding agent 的替代品：coding agent 仍是终端里、单人、跑在（远程）机器上的交互工具。Pi Durable 是构建任意 agentic 应用的 **harness 框架**，coding agent 只是其中一种应用。
- 与 coding agent 共享 `pi-ai` 及极简、可塑原则；在 durable 上验证过的设计会回流到 coding agent。
- 源码约 15k 行（不含测试），GPT 计约 150k tokens、Claude 约 250k tokens；storage 后端约 3k 行，理解架构通常不必读。
- 实现选择 TypeScript 是为快速起步，不排除未来移植 Rust 等；MIT 许可。安装：`npm install @earendil-works/pi-durable @earendil-works/pi-ai @earendil-works/chord`。
- 设计目标：长期运行、可在任何有 JavaScript runtime 的地方运行、可从任意 surface 接入、无限长对话、扛住进程/宿主故障、支持多人 steer 同一 agent。

## 概念骨架

| 概念 | 定义 | 关键点 |
|---|---|---|
| Harness | 一个打开的 storage + 运行 agent 的机器 | 所有变更走一条原子 commit 线；提交前不展示 |
| Conversation | 不可变 entry 组成的 transcript | handle 无状态，按 `id` 比较；`root()` 重启后仍是同一会话 |
| Entry | transcript 记录 | `pi.user` / `pi.assistant` / `pi.tool-result` / `pi.system` / `pi.reset` 或自定义 kind；模型只看到最近 reset 之后 |
| Commit | 原子写 | entries、documents、tasks 一起存或一起不存 |
| Document | 与 transcript 同库的类型化 JSON | 内置 `pi.agent`、`pi.provider`、`pi.live`、`pi.inbox`、`pi.usage`；应用状态放这里 |
| Task | 每步存 checkpoint 的 durable 状态机 | 模型请求、每次工具调用、compaction 都是 task；可自定义 |
| Submission | 交给会话的输入或待写 entry | 可等待；`requestId` 保证恰好一次 |
| Extension | 命名的 tools/sections/hooks/wraps/tasks 捆绑 | registry 在进程内；会话只存名字 |
| Agent | 会话运行配置 | model、thinking level、extensions、tools/modelTools、instructions、cwd、maxTurns、compaction |
| Registry | 进程安装的 extensions 集合 | 运行时可替换；新工作用新状态，已开始的调用沿用旧代码 |

一次输入在存储中的形状：

```text
submit(input) → pi.user
  pi.generation → pi.system（仅当 prompt 或 tools 变化）, pi.assistant(tool calls)
    pi.tool × n → pi.tool-result × n   （generation 拥有并等待）
  下一次 pi.generation → pi.assistant（最终答案）→ submission done
```

## 多会话、fork 与身份

- `createConversation({ ownership })` 创建新会话；`fork(entryId, { ownership })` 从父会话某条 entry 分叉。
- fork 看到父 entries 至 `entryId`，不复制历史；继承该时点的 agent，但获得新的 provider session identity。
- 两者都接受 `agent` 与 `init`，在创建 commit 中应用；`HarnessOptions.conversationCreated(tx, conversation)` 在每个创建或 fork 会话的 commit 中运行，包括工具直接 `tx.createConversation()`。
- ownership 取 `{ kind: "task" }`、`{ kind: "conversation" }` 或 `{ kind: "ownerless" }`；中止与清理语义见[执行语义](durable-execution.md#所有权中止与任务图)。
- 每个会话在 `pi.provider` 持久化 UUIDv7，作为 provider `sessionId` 转发；跨 reopen、重试、reset、compaction、换模型保持；子会话或 fork 获得新 identity；旧会话在首次 generation/compaction 前补发并持久化。

## 应用状态（documents）

- `defineDoc({ kind, version, scope, history: "latest" | "rewindable", fork: "initial" | "current" | "asOf", initial, checkpointWhen })` 定义类型化 JSON 状态。
- 在 `conversation.commit()` 内用 `tx.doc()` 读写；`harness.snapshot()` 读当前值，`snapshotAsOf()` 读旧值（需要 `rewindable`）。
- document 与 transcript 在同一原子 commit 中改变，应用状态不会与产生它的 transcript 矛盾。
- fork 行为：`initial` 取全新值、`current` 取父当前值、`asOf` 取父在 fork entry 时点的值。
- `checkpointWhen` 必需：返回 true 时把该变更存成完整 base，限制 replay 范围。
- deferred commit（`persistence: { kind: "deferred", withinMs }`）只适用于只改已有、且 `history: "latest"` + `fork: "initial"` documents 的 commit；watch 立即看到，storage 延迟到下一次读写、离开内存、close 或最迟 `withinMs`；崩溃丢未存储值。
- `watchDoc()` 跟随 document 地址：retirement 是带 `retired: true` 的调用，之后在同一地址新建 document 会以根替换到达；task document 的 watch 随 task 结束。

## 存储

| 后端 | 导入 | 特性 |
|---|---|---|
| Memory | 包根 `MemoryStorage` | 不持久，测试/嵌入用 |
| SQLite | `storage/sqlite/node` | 单文件；WAL + `synchronous = NORMAL`；进程崩溃可恢复，掉电/宿主故障可能丢最新提交 |
| JSONL | `storage/jsonl/node` | append-only 目录；`fsync` 可选；全历史也驻内存，长跑应选 SQLite；可 `readOnly` 查看 |
| IndexedDB | `storage/indexeddb` | 浏览器单数据库；需 Web Lock 保证单持有者；必要时 `navigator.storage.persist()` |
| Cloudflare DO | `storage/sqlite/cloudflare` | SQLite-backed Durable Object 的 storage，commit 即其事务 |

约束：

- **单写者**：同一 storage 同时只有一个进程写，没有跨进程锁；其他客户端附着到该进程。只读 viewer 对 Harness 用 `readOnly: true`，JSONL 还要以 `readOnly: true` 打开存储本身（可写 open 会修复 writer 正在追加的文件）。
- SQLite 可用 `{ prefix }` 在共享库中命名空间表与索引；前缀须合法且不能以 `sqlite_` 开头，改前缀不迁移数据。
- 同一 storage 的多个 Pi storage 经 Cloudflare adapter 自动共享操作队列；与宿主表共用数据库时，宿主查询也走同一 adapter，直接调用可能被 Pi 事务回滚。
- 自定义后端实现 `commit(batches, receive, context)`：按序存 batches，每批原子、带 seq、基于前批状态校验，尽量少往返；遇到自身检查拒绝（全局 ID、document actions、copy resolution）即停止，之前的批次保留，本批及之后不存；durable 后同步按序 `receive(index, seq)` 再 resolve `{ stored, refused? }`，未知结果（断连、语句/COMMIT 失败）reject。`receive` 是 durability receipt，不调用 Storage、不抛错。
- 自定义后端可用 `registerStorageConformance()` 跑一致性测试；可移植 SQLite/JSONL 核心不依赖 Node API（Bun、Cloudflare DO），需异步 `SqliteDatabase` facade 或 `FileSystem`。

SQLite 下内存只保留 working set：活跃 transcript、live task、待处理 submission；其余按需从磁盘加载。活跃 transcript 受模型上下文窗口约束，因为 compaction 会在溢出前总结旧消息。

## 执行环境

- `env` 函数在每个 tool call、section 渲染、`runtime.env()` 时构造，收到会话 ID、agent cwd 与已提交 reads；可按会话给不同目录，甚至给每个会话一个容器。
- `NodeExecutionEnv` 提供本地文件与 shell；`RemoteExecutionEnv` / `LocalExecutionEnv`（pi-env）可把工具放到另一台机器，harness 与工具分离。
- env 抛错成为该调用的错误结果；没有 env 时内置工具失败。
- `edit`/`write` 按 environment `id` + path 串行化同一文件的修改；自定义 env 必须设置 `id`，相等 id 表示同机同路径。
- 宿主可 `openBinaryReader()` 读字节区间、`openDirReader()` 分页目录、`exec(argv)` 无 shell 运行程序并区分 stdout/stderr；abort context 停止单次调用，`cleanup()` 关闭环境。
- 可选 `listFiles()` 返回任意深度文件列表（按 gitignore 跳过，超界带 `truncated`）；`NodeExecutionEnv` 不实现，调用方自行 walk 作为回退。
- 执行环境有 `registerEnvConformance()` 一致性测试。

## 每会话 agent 与运行策略

每个会话在 `pi.agent` 存自己的运行配置，`configure()` 一次 commit 修改，传 `null` 清回宿主默认：

| 字段 | 作用 |
|---|---|
| `model` / `thinkingLevel` | 模型与思考级别 |
| `extensions` | 选中的扩展；数组为精确选择，`{ remove }` 从宿主默认删 |
| `tools` | 启用的工具全集；数组为精确启用，`{ remove }` 删除 |
| `modelTools` | 在 tools 中只收窄“模型可见”的集合，脚本仍可调用其余 |
| `instructions` | 追加在 system prompt 最后的 instructions section |
| `cwd` | 执行环境工作目录 |
| `maxTurns` | 单 run 最多工具轮数；达到上限的那一轮仍执行工具，然后 `unanswered` + `turn_limit`；答案永不被截断 |
| `compaction` | 每会话压缩设置，见[执行语义](durable-execution.md#上下文管理) |

- `maxTurns` 的计数在 `pi.live.run.turns`，跨重启保留；每个 run 从 0 开始，`onYield` continuation 也重置，自动续跑的扩展必须自己限流。`configure()` 对非整数或小于 1 的值抛 `RangeError`。
- 扩展与工具以对象传入、按名存储；扩展卸载后，选中它的会话暂时得不到它，装回即恢复。
- 任务拥有的会话（subagent）从 owner 会话复制 agent；fork 继承 fork entry 时点的 agent。
- 请求在准备时固定 model/prompt/tools，变更从下一请求生效；tool call 与 hook 按 phase 解析 agent，env 每次按当前 cwd 构造，所以 cwd/扩展变更可以影响模型已经发出的调用。
- `settings` 是跨会话策略，每次使用读取、不存储，可用 getter 做 live 配置：默认扩展选择、`stream.timeoutMs`、`retry.maxRetries`、`compaction`、`progress` 的三个间隔、`toolExecution: "parallel"`、`contextRetentionMs`、`documentRetentionMs`、`followUpMode`。
- `HarnessOptions.identity` 控制 provider 归因头（默认 `PI_ATTRIBUTION`）；`telemetry` 接入宿主 `TelemetryContext`。

## 观察、多人协作与用量

- UI 需要的一切都是已提交状态；`watch()` 返回 attachment 时视图 + 每个相关 commit 的 Chord operations，一次一个回调。
- `value.entries` 是 transcript 窗口：初始 50 条，追加，超过 100 条时一次 splice 回落到最新 50；`watch(context, { min, max, from })` 可调。
- `value.docs` 提供 `pi.live`（run、流式部分、重试、工具输出、compaction、runFailure）、`pi.inbox`、`pi.usage`、`pi.agent`、`pi.provider`。
- `ConversationTranscript.merge()` 维护客户端全量 transcript，支持 `loadEarlier()`、`fillGap()`、断线 `resume`；entries 不可变，merge 只增。
- 晚到或重连的客户端从当前视图开始，之后只收变化；任意客户端可 `viewState()` 拿全量视图，或 `submit(..., { whenBusy: "steer" })` 介入运行中的工作。
- 远程客户端可 `watch()` 发送精确 operations，或用 `watchEvents()` 转成 coding agent 风格事件（字节更多）。
- 同步 observer（`observeConversation`、`observeTaskGraph`、`observeDoc`）在内存采纳变更时调用，commit 会等待它；不得 await、调用 Harness 或抛错。超过 10,000 pending operations 时回调收到根替换 `[["r", view]]`。
- watch 以 `WatchEnd` 结束：`stopped`、`aborted`、`ended`、`listener_error`、`failed`；Durable watch 不发送可恢复的 failed call。
- 用量按会话记在 `pi.usage`：按 `provider/model` 累计模型响应，按工具名累计报告 usage 的工具结果；失败与 abort 的尝试也计数；`harness.usage()` 给全 Session 汇总。
- Telemetry：`pi.durable.submit`、`pi.durable.phase` span；`pi.durable.entry`/`submission`/`checkpoint`/`replay`/`report` 事件；`pi.durable.phase.duration` 与 `pi.durable.tasks.active` 指标。属性只含 ID 与控制元数据，不含消息、参数或结果；`DURABLE_TELEMETRY_SCHEMA` 记录 schema。

## 上游入口与本地归档

- 官方入口：`packages/durable`、`packages/durable/test/examples`（00–36）、`packages/coding-agent/src/experimental/durable`（小 coding agent）、`.../vacation`（度假规划 agent，约 1300 行，多数是 TUI，v1.0.0）。
- 演示流程：subagent 并行三个搜索 → 进程死亡 → 重启只重跑未完成的 replay-safe 搜索 → 切换并 steer subagent → 主会话同时压缩/steer → 报告回来变成计划。
- 本仓库归档 `modules/pi` 的 commit `815541a14` 已包含 `packages/durable`，同目录还有 `chord`、`codemode`、`env`、`schema`、`telemetry`。归档与 main 分支 README 是否逐字一致 **Pending**，引用具体 API 前应核对本地版本。
- benchmark 分 storage、storage:memory、tool-output、nested-tools 四组，命令见 README；规范见 `packages/durable/docs/spec.md`。

## 来源

- [Pi Durable 发布博客（2026-10-01）](sources/earendil-pi-durable-post.md)
- [pi-durable README（main，2026-11-10 抓取）](sources/pi-durable-readme.md)
