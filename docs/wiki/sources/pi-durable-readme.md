---
tags:
  - pi-durable
  - api-reference
  - agent-harness
sources:
  - https://github.com/earendil-works/pi/blob/main/packages/durable/README.md
updated: 2026-11-10
---

# pi-durable README（main 分支）

[索引](../README.md) · 原文：<https://github.com/earendil-works/pi/blob/main/packages/durable/README.md>（抓取于 2026-11-10）

> 内容对应 main 分支，包处于 Experimental，API 不承诺兼容。与本地归档 `modules/pi`（commit `815541a14`）是否逐字一致尚未核对，标 **Pending**。

## 概要

`@earendil-works/pi-durable` 是 durable agent harness：conversation、模型轮次、工具调用与应用自有状态都在展示前提交到存储；进程在 turn 中途死亡，重新打开同一 storage 会从断点继续。基于 `@earendil-works/pi-ai`（模型访问）与 `@earendil-works/chord`（document state）。安装三个包：`pi-durable`、`pi-ai`、`chord`。

## 提取要点

### 核心概念

- **Harness**：一个 storage 加上在其上运行 agent 的机器；所有变更走一条原子 commit 线，提交前不展示。
- **Conversation**：不可变 entry 组成的 transcript；`root()` 首次创建根会话，重启后仍是同一个；handle 无状态，按 `id` 比较。
- **Entry**：`pi.user`、`pi.assistant`、`pi.tool-result`、`pi.system`、`pi.reset` 或自定义 kind；模型只看到最近一次 reset 之后的内容。
- **Commit**：原子写，可同时追加 entries、编辑 documents、创建 tasks；全存或全不存。
- **Document**：与 transcript 同库的类型化 JSON；内置 `pi.agent`（agent 选择）、`pi.provider`（provider session identity）、`pi.live`（运行中的 generation/tools）、`pi.inbox`（排队 submission）、`pi.usage`（花费）。
- **Task**：每步存 checkpoint 的 durable 状态机；每个 task 有 owner（会话或另一个 task）。内置 `pi.generation` 调模型，拥有并等待其 tool calls 的 `pi.tool` task，再把 run 交给下一次 generation。
- **Submission**：交给会话的输入或待写 entry，可等待；turn 是一次模型响应及其 tool calls，run 是输入到最终答案的全部 turn；run 期间会话 busy。
- **Extension**：命名的 tools、system prompt sections、hooks、wrappers、tasks 捆绑；**Registry** 是进程安装的扩展集合；**Agent** 是会话运行配置，存为名字。
- 一次回答的结构：`submit → pi.user → pi.generation → pi.system（仅当 prompt/tools 变化）→ pi.assistant(tool calls) → pi.tool×n → pi.tool-result×n → 下一次 generation → 最终 pi.assistant → submission done`。

### 持久化与恢复

- SQLite 或 JSONL 存储可跨重启保留；`root()` 拿回同一根会话，`resume()` 继续上次进程未完成的 run；提交或等待也会启动调度器。
- 只读 viewer 用 `readOnly: true`：open 不恢复，写、`resume()`、会运行 task 的调用都以 `ReadOnlySession` 拒绝；JSONL 还需 `openNodeJsonlStorage(..., { readOnly: true })`，因为可写 open 会修复 writer 正在追加的文件；SQLite 可照常打开。
- 每个会话在 `pi.provider` 持久化 UUIDv7 作为 provider `sessionId`；跨 reopen、重试、reset、compaction、换模型保持；子会话或 fork 获得新 identity；旧会话在首次 generation/compaction 前补发并持久化。
- 同一 `requestId` 重试返回原 submission；`harness.submission(id)` 可按 id 重新获取。
- 崩溃后未完成工作保持 pending；`resume()` 启动调度器。被切断的 model 请求按 `settings.retry` 算失败尝试，partial answer 留作 aborted entry，等 backoff 再试，重试用尽则 run 以 `runFailure: interrupted` 结束；deferred response 被再次轮询而不是重新请求。
- close 不是 crash：它停止的请求会重发。
- 崩溃循环：open 时每个被 crash/eviction/reset 切断的 task 计数加一，task 提交新状态时计数清零；达到 `settings.restartLimit`（默认 5，`Infinity` 不终止）即终止：工具调用得到 `restart_limit` 错误结果，compaction 记 `compactionFailure`，run `runFailure: restart_limit`，自定义 task `faulted`。内置 task 以 `task_interrupted` 上报，确保 crash loop 一定到达 `onReport`。进程死亡时所有运行中的 task 都计数；abort handler 被切断同样次数则 task `faulted`；用户 abort 的 run 仍为 `aborted`，detail 记录切断。
- `onReport` 的 `kind`：`storage_failed`、`task_faulted`、`task_interrupted`、`migration_failed`、`task_outdated`（`missing_task` / `task_too_old` / `migration_failed`）、`task_error`；另有 `extension_error`、`host_error`、`listener_error`。`report.task` 含 id/kind/conversationId，`report.extension` 指出安装者。
- run 失败后，排在它后面的输入默认继续等待，直到下一次输入；`settings.afterFailedRun` 设为 `continue` 会立即用它们开新 run，`withdraw` 则以 `run_failed` settle 为 `unanswered`。
- 定义缺失或不可迁移的 task 在 task graph 中显示 blocked 原因；registry 变化解除阻塞时 `onWake` 报告 active。

### 睡眠与唤醒

- task 通过结束 phase 来等待时间：sleep 被存储，不占 invocation，跨重启保留，时钟到达 `until` 后从 checkpoint 继续；phase 不会在中途 sleep，重启后 phase 从顶部重跑，因此等待后的工作放下一 phase，所需数据放 checkpoint。
- `runtime.sleepUntil()` 与 `runtime.commit()` 返回的 `{ status: "sleeping", until, checkpoint }` 等价；重试 backoff 与 deferred-response 轮询也这样 sleep。
- Session、scheduler、task 的定时器走 `setTimer`（默认 `setTimeout`），时间走 `now`（默认 `Date.now`），可注入 fake clock；Node environment、file watcher、image worker 用自己的定时器。sleep deadline 存在 `now` 上，同一 storage 的所有进程必须用同一时钟。
- 可被驱逐的宿主（如 Cloudflare Durable Object）用 `onWake`：Harness 不再为 sleep 设定时器，而是在 `harness.wake()` 变化时告知宿主 `active`（有 task 可立即运行或正在运行）与 `at`（最早 sleep）；宿主保持 alarm 并在触发时 `resume()`。示例在 open 前设 60s fallback alarm，任何可能启动工作的调用前 arm，`onWake` 写入 alarm 失败则 abort 对象。
- 默认 `setTimer` 拒绝只为释放内存的 Worker 定时器，避免阻止 hibernation/eviction。

### 扩展与注册表

- `defineExtension({ name, tools, sections, hooks, wraps, tasks })`；默认每个会话选所有已安装扩展，按安装顺序。registry 内容不存储，会话只存扩展名。
- `registry.install()` 同名替换；`uninstall()` 移除同名扩展；运行中的调用沿用旧代码，每个 task phase 在开始时解析一次 hooks/agent，下一 phase/请求/调用用新代码；重启后需重新安装，pending task 在扩展装回后继续。

### 工具

- `@earendil-works/pi-durable/tools` 提供 `read`、`write`、`edit`、`bash` 及 `CodingTools`；只通过调用的 environment 访问文件与进程。
- `read` 把图片作为 image block；默认限制 2000×2000 像素、4.5 MB base64。无 image processor 时按文件头判断尺寸，PNG/JPEG/GIF/WebP 原样发送，超限或其他格式拒绝；有 processor 时解码、按 EXIF 转正、BMP 转 PNG 并缩放。Photon 基于 WebAssembly，`/images/node` 在 worker 线程处理，30s 空闲退出；`/images/cloudflare` 在调用线程处理且 WebAssembly 内存不收缩，内存受限宿主慎用。
- `defineTool()` 用 `@earendil-works/pi-schema` 生成参数类型并在 execute 前校验/coerce；`api.output()` 流式输出，execute 无 output 时成为结果。
- 每次调用是独立 durable task，intent 在 `execute()` 前提交；崩溃后仅 `replay: "safe"` 重跑，否则模型收到 `interrupted` 错误结果与已提交输出；连续切断达到 `restartLimit` 得到 `restart_limit` 错误结果；execute 抛错得到错误结果。
- 结果三通道：`output`（给模型）、`structuredOutput`（给程序）、`details`（给 UI）；声明 `structuredOutputSchema` 时校验。transcript 只存 `output` 与 `details`。结果可带 `usage`（计入会话）与 `control: { terminate: true }`（整轮所有结果都要求时，run 不再请求模型直接结束）。
- 同名工具的后者覆盖前者；`wrapTool()` 装饰最终胜出的实现，无论哪个扩展提供。

### 嵌套调用与工具可见性

- `api.executeTool()` 让工具调用另一个工具（Code Mode 脚本、MCP bridge 都这样做）；嵌套调用是独立 tool task，归调用者所有，经过校验与 `ToolTask` hooks，有自己的输出限制与 replay 策略；返回 `taskId`、`structuredOutput`、`details`、`diagnostics`、`usage`、`isError`，不返回给模型的 `output`。
- `executeTool()` 在 caller execute 返回后、caller abort 时、Harness close 时 reject；取消它的 context 只停止等待。hooks 通过 `call.parent` 区分嵌套调用。
- caller 运行期间嵌套调用列在 `pi.live.nestedTools`（`parentCallId`、`parentTaskId`、参数、完成后的 summary）；`progress: false` 不把运行输出放进 `pi.live`。caller settle 前，遗留的嵌套调用（包括早先 attempt 创建的）被 abort；caller 结果不列出它们，task 记录保留。
- 嵌套调用以位置为 key，也可由 caller 传 `{ key }`；replay-safe caller 崩溃后按同序/同 key 重跑会拿回已完成或仍在运行的嵌套调用，而不是新建。崩溃时未提交结果的嵌套调用按自己的 replay 策略处理；非 replay-safe caller 重启后其未完成嵌套调用连同拥有物被放弃。
- 嵌套调用的 `usage` 记在该工具名下；caller 结果再传一次会重复计费。嵌套结果只暂存在 caller 的 `NestedCallDoc`，caller settle 后只留小回执。
- `callers` 限定 `model` / `tools`；`modelTools` 只收窄模型可见工具，不影响脚本调用；`tools` 决定启用的全集。
- `deferred: true` 工具在加载前不提示给模型，但其他工具可调用；`tool_search` 扩展让模型搜索 deferred 工具并用 `control.addTools` 加载，记录进 `modelTools`，在该分支上跨 compaction 保留。
- `abandonOnRestart: true` 用于只在内存中等待、重启后不会被 caller 恢复的 task：后来 Harness 调度时发现它仍 live，就以 `abortReason: "restart"` 连同拥有物 abort，再运行任何东西之前完成。非 replay-safe 工具的嵌套调用自动如此，其 `api.createTask()` 子任务也如此；定义缺失则等到扩展装回以执行 abort handler，期间 caller 与会话 blocked。

### Code Mode

- `@earendil-works/pi-durable/codemode` 增加 `codemode` 工具：模型写 JavaScript，在 QuickJS 沙箱（`@earendil-works/pi-codemode`）里 `await tools.<name>(args)`；每次调用是嵌套 tool call，只有脚本输出给模型。
- 脚本跨重启恢复：沙箱确定性执行（虚拟时钟、种子随机、UTC），工具在交付每个结果前写 journal；重启后重跑脚本并按序喂回 journal 结果，重挂到同 key 的嵌套调用后继续。脚本走不同路径、沙箱 fingerprint 或 code mode 版本变化、`timeout_ms` 已过时，rerun 以错误结束；重启时仍在跑的嵌套调用按自己的 replay 策略。
- 扩展还加 `codemode` prompt section，用 token 预算列 TypeScript 声明；脚本可 `searchTools()`、`describeTool()`、`describeNamespace()`；`namespaces` 按名字前缀分组（如 MCP 的 `mcp__github__`）。
- 结果含 header、脚本输出、失败时已做的调用；超过 `max_output_tokens` 截断，全文放临时文件。脚本可用 `models.*`（catalog、`classify()`、`generateImages()`，作为内部工具嵌套调用，`models: false` 关闭）。Cloudflare 用 `RemoteCodemodeSandbox`；关闭沙箱不算结果，下一进程 sandbox 继续脚本。
- 嵌套调用失败在脚本中 reject（带错误文本），除非工具声明 schema 并返回自身错误值（如 `bash` 以 `{ output, exitCode }` resolve，脚本检查 exitCode）。`store(key, value)` / `load(key)` 每会话保存 JSON，fork 看到 entry 时点的值。

### System prompt、Agent、Settings、Environment

- system prompt 每次请求前按 sections 顺序渲染；section 可读 resolved agent、请求的 environment、已提交 documents；会话的 `instructions` 最后渲染为 `instructions` section。sections/tools 变化以 positional `pi.system` entry 存储，只发送变化部分保住 prompt cache；每次不同的 section（如当前时间）会破坏缓存。
- 每会话 `pi.agent` 存 model、thinkingLevel、extensions、tools、modelTools、instructions、cwd、maxTurns、compaction；`configure()` 一次 commit 修改，传 `null` 清回宿主默认；扩展/工具以对象传入、按名存储。任务拥有的会话（subagent）从 owner 会话复制 agent；fork 继承 fork entry 时点的 agent；请求在准备时固定 model/prompt/tools，变更从下一请求生效；tool call 与 hook 按 phase 解析 agent，environment 每次按当前 cwd 构造，所以 cwd/extension 变更可影响模型已发出的调用。
- `maxTurns` 限制单 run 的工具轮数；达到上限的那一轮仍执行工具，然后 run 以 `unanswered` + `turn_limit` 结束（受 `afterFailedRun` 影响）；答案永不被截断。计数在 `pi.live.run.turns`，跨重启保留，每个 run 从 0 开始，`onYield` continuation 也重置。`configure()` 对非整数或 <1 抛 `RangeError`。
- `settings` 是跨会话运行策略，每次使用读取、不存储，可用 getter 做 live 配置：`extensions` 默认选择、`stream.timeoutMs`、`retry.maxRetries`、`compaction`、`progress`（`partialIntervalMs`、`outputIntervalMs`、`persistWithinMs`）、`toolExecution: "parallel"`、`contextRetentionMs`、`documentRetentionMs`、`followUpMode`。
- `env` 在每个 tool call、section 渲染、`runtime.env()` 时构造，收到会话 ID、agent cwd、已提交 reads；抛错成为该调用的错误结果；没有 env 时内置工具失败。`edit`/`write` 按 environment `id` + path 串行化同一文件的修改；自定义 `ExecutionEnv` 要设置 `id`，相等 id 表示同机同路径。宿主可 `openBinaryReader()`、`openDirReader()`、`exec(argv)`（接收 stream 信息）；abort context 停止单次调用，`cleanup()` 关闭环境。storage 与 env 都有 conformance suite（`registerStorageConformance` / `registerEnvConformance`）。可选 `listFiles()` 返回任意深度文件列表，按 gitignore 跳过，超界带 `truncated`；`NodeExecutionEnv` 不实现，pi-env 的 `RemoteExecutionEnv`/`LocalExecutionEnv` 实现，缺失时调用方自行 walk。

### 观察、忙会话、reset 与 compaction

- UI 所需都是已提交状态。`watch()` 返回结构视图：attachment 时值 + 每个相关 commit 的 Chord operations，一次一个回调；`value.entries` 是 transcript 窗口（初始 50 条，追加，超过 100 条时一次 splice 回落到最新 50；`min`/`max` 可调，`from` 指定起点）；`value.docs` 含 `pi.live`、`pi.inbox`、`pi.usage`、`pi.agent`、`pi.provider`。
- `ConversationTranscript.merge()` 维护客户端全量 transcript，支持 `loadEarlier()`、`fillGap()`、断线 `resume`；entries 不可变，merge 只增。
- watch 以 `WatchEnd` 结束：`stopped`、`aborted`、`ended`、`listener_error`、`failed`；Durable watch 不发送可恢复的 failed call。同步 observer（`observeConversation`、`observeTaskGraph`、`observeDoc`）在内存采纳变更时调用，commit 会等待它；不得 await、调用 Harness 或抛错。超过 10,000 pending operations 时回调收到根替换 `[["r", view]]`。
- partial answer 与 tool output 默认最多每 100 ms 提交一次，watch 立即看到；storage 稍后合并写入（deferred commit），最迟 `persistWithinMs`（默认 1,000 ms）；崩溃最多丢约该窗口的输出，第一秒内崩溃可能没有 aborted entry，且该次 usage 不记录。
- 忙会话：`submit` 默认 follow-up 排队；`whenBusy: "steer"` 在当前 tool round 后加入正在运行的 run；`whenBusy: "reject"` 在空闲时抛 `ConversationBusy`；`whenIdle: "reject"` 在空闲时拒绝，不自行启动 run；`steeringMode`/`followUpMode: "all"` 一次放入所有排队项。
- `submit(tx, draft)` 在自己 commit 内准入，规则相同，返回 submission id；检查、准入、写入同一 commit。必须在 commit 自己的表写（`appendEntry`、`createTask`、另一个 admission）之前、每 commit 一次调用，否则 `ReadAfterWrite`；documents 可前后读写；`ConversationBusy`/`ConversationIdle` 在写入前抛出；callback 后抛错则 submission 不存在。
- `write` 只追加 entry 不问模型；仅 `kind`+`data` 的 write 立即追加，可在 run 中；带 `model`/`head`/`edits` 的 write 像 steer 一样等边界。`submission.abort()` 撤回排队输入。
- run 失败后排队项留到下一次输入/write/continue；`runFailure` 原因包括 `model_error`、`no_model`、`aborted`、`reset`、`interrupted`、`faulted`、`orphaned`、`restart_limit`、`turn_limit`、`nothing_to_answer`，并记录输入（`unanswered` 原因相同，orphaned 用 `missing_task`/`task_too_old`/`migration_failed`）。
- `{ type: "continue" }` 在没有用户消息时续跑当前 context；忙碌时抛 `ConversationBusy`；失败 run 留下的排队项先放入并加入该 run；没有可回答内容时 `nothing_to_answer`。输入可带自定义 `entry` kind（不能以 `pi.` 开头），模型仍看到 `content` 作为 user message。
- `reset()` 开新 context，旧 entries 保留；忙碌时像 write 一样排队；在 tool round 中放入则当前 run 以 `reset` settle 并结束，排队输入在新 context 中运行。工具返回 `control: { handoff }` 写同样的 reset 但 run 继续，下一次请求用新 context，submission 最终 settle；同时全部 `terminate: true` 则 handoff 后结束。
- compaction 总结旧 entries 并追加 `pi.compaction`（摘要 + 保留的首条 entry）；手动 `compact(instructions)` 返回 task id，可等 outcome；会话继续工作，摘要 idle 时立即放入，否则下个 turn 边界；Esc 可取消手动 compaction。
- 自动 compaction 设置：`enabled`、`reserveTokens`（超过 `contextWindow - reserveTokens` 时下一请求等待）、`keepRecentTokens`（保留多少原文）、`backgroundTokens`（提前多少开始后台摘要，0 关闭）、`modelOverrides`（按 `provider/modelId` 覆盖）。每会话可 `configure({ compaction })` 覆盖；取值层级：会话 modelOverrides → settings modelOverrides → 会话字段 → settings；会话 `enabled: false` 优先于 settings 的 modelOverrides；整组替换，token 数非整数或 <0 抛 `RangeError`；子会话与 fork 继承。
- provider 报 context 过长时 generation 自动 compaction 并重试一次；摘要若在放置时切到当前 context 起点之前则 settle 为 `stale`，多个在飞时最远的切点生效；摘要花费计入 `pi.usage`；`CompactionTask` 的 `beforeCompact` hook 可拒绝或自带摘要。阻塞阈值等待的 compaction 失败时 generation 不请求模型直接失败，输入以 `model_error` + `Compaction failed: ...` settle；无内容或拒绝则请求继续。运行中的 compaction 在 `pi.live.compactions`，最近失败在 `pi.live.compactionFailure`。

### Hooks、子任务、任务图与自有状态

- Generation hooks：`beforeRequest`、`beforeProviderRequest`、`afterResponse`、`onYield`（用另一条 user message 继续 run）、`afterTools`、`afterRun`。Tool hooks：`beforeTool`（阻断/改写参数）、`afterTool`（替换结果，也看到 Harness 写的错误结果；abort 时在 abort handler 内运行，慢 hook 会延迟 abort）。hook 可读已提交 documents（`api.snapshot()`）与原始历史（`api.entry()`/`entries()`，compaction 不改）。
- `afterRun` 在 run 回答后启动 durable 工作：返回 `runEndTask()` 创建的 tasks，generation 作为子任务创建并等待。answer 先提交、submission 先 settle 为 done；`pi.live.run` 保留到任务完成，会话保持 busy；Stop abort 它们；崩溃会恢复；任务存在前崩溃会再次询问 hooks，存在后不会重复。任务用 `runtime.conversation()` 拿 handle，在 commit 内 `handle.submit(tx, draft)` 写入/跟进，run 结束时放置；follow-up 会开 fix run 并重新问 `afterRun`，需要自行限流。只在最终答案或 terminate 轮后运行，不在 onYield continuation、失败或 abort 后运行。损坏的请求经 `onReport` 报告并跳过，run 仍结束。
- 更多会话：`createConversation({ ownership })`、`fork(entryId, { ownership })`；fork 看到父 entries 至 entryId，继承该时点 agent，获得新 provider session identity；都接受 `agent` 与 `init`，在创建 commit 中应用。
- `abort()` 停止会话：撤回排队输入（排队 write 保留），abort 当前工作的所有 task，resolve 时会话 idle。会话可由 task 拥有；subagent 工具在 `api.commit()` 中用 `ownership: { kind: "task", taskId }` 创建子会话，再 `api.conversation(id)` 驱动；abort 调用会 abort 子会话，caller 失败同样；父会话等子会话结束才 idle。`background: true` 是边界：拥有的工作不随父 abort 消失，也不让父 busy。示例 21（前台 subagent）、22（后台持久 subagent）。
- 子任务：`ownership: { kind: "task" }` 创建；commit `waiting` 状态与 `on`/`policy` 等待；`allSettled` 等全部，`failFast` 首个失败会 abort 其他；等待期间不运行代码；完成的 task 若拥有工作仍在跑则为 `completing`，outcome 已定但 `waitForTask()` 等拥有工作结束才返回；失败/abort 先 abort 拥有工作；abort 自底向上。示例 23。
- 任务图：`watchTaskGraph()` 观察所有 live task；节点含 owner、status、background/abort 标记、拥有的 conversations；状态 `pending`/`running`/`waiting`/`completing`；重启后 `running` 显示 `pending`；blocked 原因不在图中，由 `inspect()` 报告；只列 live task，owner task 终态后其会话里的后续 task 成为顶层节点，`ConversationRecord.owner` 仍链接父级。
- 自有状态：`defineDoc({ kind, version, scope, history: "latest"|"rewindable", fork: "initial"|"current"|"asOf", initial, checkpointWhen })`；`conversation.commit()` 内 `tx.doc()` 修改；`harness.snapshot()` 读；`snapshotAsOf()` 读旧值。deferred commit（`persistence: { kind: "deferred", withinMs }`）仅适用于只改已有且 `history: "latest"` + `fork: "initial"` documents 的 commit；watch 立即看到，storage 延迟到下一次读写该 document、离开内存、close 或最迟 withinMs；崩溃丢未存储值。`watchDoc()` 跟随 document 地址，retirement 与重建都有调用；task document 的 watch 随 task 结束。`conversationCreated(tx, conversation)` 在每个创建/fork 会话的 commit 中运行；`init` 写每次调用数据。
- 用量：每会话 `pi.usage` 按 `provider/model` 和 tool 名累计；失败与 abort 的尝试也计数；`harness.usage()` 给全 Session 汇总。

### 错误、存储与示例

- 错误三规则：1) storage 错误结束 Harness——调用 reject，后续与 pending wait 以 `SessionFailed` reject，watch 以 `failed` 结束，运行 task 收到 abort signal，`onReport` 收到一次，Harness 自行 close；只能重开恢复，`requestId` 重试找回已准入 submission。2) 非法读只失败该调用（坏 cursor、未知会话、未保留历史）；被取消的读也只失败自己；但 `commit()`/`mintId()` 的任何错误都按规则 1 结束 Harness。3) 用户代码只失败自己的单元：task phase 抛错 fault 该 task；tool 抛错给错误结果；hook 抛错报告并跳过（`beforeTool` 阻断）；commit callback 抛错回滚该 commit；抛错的 listener 被报告，其他继续。例外：`RegistryReader.snapshot()` 抛错会让 Harness 失败。
- `harness.closed` 在 close 或 storage 失败后 settle；失败时 `end.kind === "failed"`；close 等待运行中的 task 代码返回。
- Storage 后端：Memory（不持久）、IndexedDB（浏览器，一个数据库；用 Web Lock 保证单持有者，必要时 `navigator.storage.persist()`）、SQLite（单文件，WAL + `synchronous = NORMAL`，进程崩溃可恢复，掉电/宿主故障可能丢最新提交）、JSONL（append-only 目录，`fsync`、`readOnly`；全历史也进内存，长跑用 SQLite）、Cloudflare DO（SQLite-backed DO 的 storage，commit 即其事务）。
- SQLite 可 `{ prefix }` 命名空间共享数据库，前缀须为合法标识符且不能以 `sqlite_` 开头（宿主还可能保留 `_cf_`）；改前缀不迁移数据。同一 storage 的多个 Pi storage 经 Cloudflare adapter 自动共享操作队列；与宿主表共用数据库时，宿主查询也应走同一 adapter，直接调用可能被 Pi 事务回滚。
- 一个进程同时写一个 storage，无跨进程锁；JSONL 的可写 open 会截断撕裂行、清理 sidecar，viewer 必须 `readOnly`，其 `commit()` 以 `JsonlStorageReadOnlyError` 拒绝，与提交竞争时重试。可移植 SQLite/JSONL 核心不依赖 Node API（Bun、Cloudflare DO），需异步 `SqliteDatabase` facade 或 `FileSystem`。
- 自定义 storage 的 `commit(batches, receive, context)` 按序存 batches，每批原子、带 seq、基于前批状态校验，尽量少往返；遇到自身检查拒绝（全局 ID、document actions、copy resolution）即停止，之前的批次保留，本批及之后不存；durable 后同步按序 `receive(index, seq)`，再 resolve `{ stored, refused? }`；未知结果（断连、语句/COMMIT 失败）reject。`receive` 是 durability receipt，不调用 Storage、不抛错。
- 示例：`test/examples` 13–36 覆盖问答、真实模型、coding tools、print/JSON 模式、inbox、late join、前后台 subagent、子任务、compaction、plan mode、reviewer、每会话 sandbox、工具覆盖、热更新、transcript 窗口、afterRun 测试、turn limit/continue、commit 内 submit、Chord StoreStorage、Durable views；00–12 是更底层的 session/document/fork/watch/recovery。设计文档 `docs/spec.md`（规范）；benchmark 命令见原文；MIT。

## 要点落页

| 要点组 | 落入 |
|---|---|
| 核心概念、存储、环境、每会话 agent、settings、观察、用量 | [架构](../durable-harness.md) |
| 恢复、sleep、失败计数、所有权、busy、reset、compaction、错误规则、持久化边界 | [执行语义](../durable-execution.md) |
| 扩展、sections、工具、嵌套调用、Code Mode、hooks、自定义 task、热更新 | [扩展与工具](../durable-extensions-and-tools.md) |

## 链接

- 原文：<https://github.com/earendil-works/pi/blob/main/packages/durable/README.md>
- 相关源：[Pi Durable 发布博客](earendil-pi-durable-post.md)
- 主题：[架构](../durable-harness.md) · [执行语义](../durable-execution.md) · [扩展与工具](../durable-extensions-and-tools.md)
- 术语：[术语表](../glossary.md)
