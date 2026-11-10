---
tags:
  - glossary
  - pi-durable
  - router-harness
sources:
  - sources/earendil-pi-durable-post.md
  - sources/pi-durable-readme.md
  - sources/router-harness-intent-20261110.md
  - sources/router-harness-discuss-20261110.md
  - sources/router-harness-spec-20261110.md
  - sources/router-harness-mvp-20261110.md
updated: 2026-11-10
---

# 术语表

[索引](README.md) · Pi Durable 与 Router Harness 文档中的术语，按英文名排序。相关主题：[架构](durable-harness.md)、[执行语义](durable-execution.md)、[扩展与工具](durable-extensions-and-tools.md)、[Router Harness](router-harness.md)、[Router 运行](router-harness-operations.md)、[Router 决策](router-harness-decisions.md)。

- **Agent** — 一个会话运行时的完整配置：model、thinking level、选中的 extensions、tools/modelTools、instructions、cwd、maxTurns、compaction。存于 `pi.agent`，只存名字，每次使用时对 registry 解析。
- **Background task** — 属于会话但不属于当前工作的 task。会话在其运行期间仍可 idle，普通 abort 不会中止它；`abort(..., { background: true })` 或直接 abort 该 task 才能停止。
- **Checkpoint** — task 每一步提交的状态。进程重启后从最后一个 checkpoint 继续，而不是从头重放。
- **Code Mode** — `codemode` 工具：模型写 JavaScript，在 QuickJS 沙箱中把会话工具当作 `await tools.<name>(args)` 调用；每次调用是嵌套 tool task，脚本执行确定性重放。
- **Collect** — router 只读收取单项工作结果的工具/方法；completed 返回结果，running 返回 pending，failed 返回错误；不消费、不改状态、不合并代码。
- **CollectResult** — `collect` 的返回联合：completed 返回 `{status,workId,result}`，running 返回 `{status:pending,workId}`，failed 返回 `{status:failed,workId,error.message}`。
- **Commit** — 原子写。entries、documents、tasks 可以在同一个 commit 中一起写入，要么全部落库，要么全部不落。
- **Compaction** — 后台 task，把较老 entries 总结为 `pi.compaction` entry；旧 entries 仍保留在存储中，模型只看 reset 之后或摘要 head 之后的内容。
- **ContextRecord** — router mock 上下文记录，含 `recordId`、`sessionId`、`text`；是内容与来源标识，不是可执行引用。
- **Conversation** — transcript，即不可变 entry 的序列。handle 本身无状态，按 `id` 比较；`root()` 首次创建根会话，重启后仍是同一个。
- **Document** — 与 transcript 同库的类型化 JSON 状态，在 commit 中读写。内置 document 有 `pi.agent`、`pi.provider`、`pi.live`、`pi.inbox`、`pi.usage`。
- **Entry** — 一条不可变 transcript 记录：`pi.user`、`pi.assistant`、`pi.tool-result`、`pi.system`、`pi.reset` 或应用自定义 kind。
- **Extension** — 命名的 `tools` + `sections` + `hooks` + `wraps` + `tasks` 捆绑。会话只存扩展名与工具名，不存代码。
- **Fork** — 从某条 entry 分叉出的会话：看到父会话截至该 entry 的历史而不复制，继承该时点的 agent，但获得新的 provider session identity。
- **Generation task** — 内置 task，调用模型，拥有该轮 tool calls 的 `pi.tool` task，等待它们并交给下一次 generation。
- **Harness** — 一个打开的 storage 加上运行 agent 的机器：调度 task、执行模型请求与工具、维护提交线。所有变更经它提交。
- **Hook** — extension 注入内置 task 的钩子。`GenerationTask` 有 `beforeRequest`、`beforeProviderRequest`、`afterResponse`、`onYield`、`afterTools`、`afterRun`；`ToolTask` 有 `beforeTool`、`afterTool`。
- **Memo** — 存在 task 上的小值，首次写入生效；hook 崩溃重跑时用它避免重复决策（例如重复询问审批）。
- **Mock backend** — router 的进程内合成后端；默认两项工作与跨 session 上下文；不启动 worker、不读写真实 session、不创建 workspace。
- **npx entry** — `npx --yes pi-router-harness` 或 GitHub 入口；固定加载 router extension、收紧五项工具并透传参数。
- **Outcome** — router 后端统一返回：成功 `{ok:true,mode,data}`，失败 `{ok:false,mode,error}`；错误码仅 `INVALID_ARGUMENT`、`NOT_FOUND`、`BACKEND_ERROR`。
- **Ownership** — task 或 conversation 的归属：`task`、`conversation` 或 `ownerless`。abort 自底向上，先清理被拥有者，再执行自己的 abort handler。
- **Registry** — 当前进程安装的 extensions 集合。运行期间可增删；新工作使用新状态，已开始的调用沿用旧代码。
- **Replay-safe** — 工具声明 `replay: "safe"` 后，崩溃中断的调用可以重跑；未声明则模型收到 `interrupted` 错误结果与已产出的输出。
- **Router** — 指挥 workers、查询进度与跨 session 上下文，并把结果汇总给用户的 Pi agent。
- **Router extension** — `examples/router-agent.ts`；注册五项 `router_*` 工具、收紧工具集、执行 `tool_call` 守卫与每轮提示词。
- **Run / Turn** — turn 是一次模型响应及其 tool calls；run 是从一个输入到最终答案之间的所有 turn。run 运行期间会话为 busy。
- **Section** — system prompt 的一个片段，每次请求前按扩展顺序渲染；变更以 positional `pi.system` entry 记录，只发送变化部分以保住 provider prompt cache。
- **Submission** — 交给会话的输入或待写 entry，可 `wait()`。带 `requestId` 时恰好一次，崩溃后重试会拿回原 submission。
- **Task** — durable 状态机，每步存 checkpoint；内置 `pi.generation`、`pi.tool`、compaction，extension 也可 `defineTask()` 定义自己的。
- **Tool task** — 内置 task，一次工具调用一个；intent 在 `execute()` 之前提交，结果按 replay 策略恢复。
- **Work** — 一项可跟踪的派活；`workId` 在实例内唯一，状态为 running/completed/failed。
- **Worker** — 执行工作的 Pi agent；契约保留 Pi 默认工具与沙盒 workspace 责任，mock 只描述关联。
- **WorkerDescriptor** — inspect 返回的 worker 描述：workspace 关联与 capabilities（profile/tools/skills）；mock 的 `isolation=simulated`。
- **WorkEvent** — worker 从 running 转为 completed/failed 的推送事件，含 `eventId`、`workId`、状态、worker/session 与时间；不含结果正文，结果仍由 `router_collect` 读取。
- **WorkSummary / WorkDetail** — list/dispatch 返回摘要；inspect 返回详情，含 context 与 worker，不含完成结果。
- **Wrap** — extension 对某个 tool 或 section 的装饰器，作用于该名字最终胜出的实现。
- **状态推送** — 后端通过可选 `subscribe(listener)` 把 `WorkEvent` 交给 router extension；extension 去重、合并后用 `router_work_event` 自定义消息唤醒模型，不新增工具或后台轮询。

## 来源

- [Pi Durable 发布博客（2026-10-01）](sources/earendil-pi-durable-post.md)
- [pi-durable README（main，2026-11-10 抓取）](sources/pi-durable-readme.md)
- [Router Harness INTENT（v7）](sources/router-harness-intent-20261110.md)
- [Router Harness 讨论检查点 CP-3](sources/router-harness-discuss-20261110.md)
- [Router Harness SPEC（草案 v1）](sources/router-harness-spec-20261110.md)
- [Router Harness MVP（v6）](sources/router-harness-mvp-20261110.md)
