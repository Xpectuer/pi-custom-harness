---
tags:
  - pi-durable
  - durable-execution
  - recovery
sources:
  - sources/earendil-pi-durable-post.md
  - sources/pi-durable-readme.md
updated: 2026-11-10
---

# Durable 执行语义

[索引](README.md) · 相关：[架构](durable-harness.md) · [扩展与工具](durable-extensions-and-tools.md) · [术语表](glossary.md)

## 核心保证

- **提交先行**：conversation、模型轮次、工具调用、应用状态都在展示前提交；没有“先展示、后落库”的窗口。
- **每步 checkpoint**：每个 task 每一步先存状态；进程死亡后新进程从最后一个 checkpoint 继续，而不是重放整个日志。
- **恰好一次准入**：`requestId` 让 submission 幂等，崩溃后重试拿回原 submission。
- **工具重跑可控**：只有 `replay: "safe"` 的工具会在崩溃后重跑；否则模型收到 `interrupted` 错误结果与已提交的部分输出。
- **崩溃循环可终止**：`restartLimit`（默认 5）保证确定性崩溃的 task 不会无限重启。
- **睡眠持久化**：等待时间的 task 以 `sleeping` 状态结束 phase，不占调用栈，跨重启保留。

## Task 树与一次回答

```text
pi.generation（模型响应，拥有本轮 tool calls）
├─ pi.tool（工具调用 1）
├─ pi.tool（工具调用 2）
└─ … 全部结束后，generation 把 run 交给下一次 generation
compaction / 自定义 task 也在这棵树里，按 ownership 挂到 task 或 conversation
```

- 每个 task 有 owner：会话或另一个 task；task 与 conversation 构成所有权树。
- 状态：`pending` → `running` →（`waiting`）→（`completing`）→ terminal；重启后原 `running` 先显示 `pending`，再次运行时恢复。
- 一个 task 若在拥有工作仍在运行时结束，进入 `completing`：outcome 已定，但 `waitForTask()` 要等拥有工作结束才返回；失败/abort 的 outcome 会先 abort 拥有工作。
- 子任务等待：commit `waiting` 状态 + `on`（task id 列表）+ `policy`；`allSettled` 等全部完成，`failFast` 首个失败会 abort 其余；等待期间不运行代码。`on` 也可用 `allSettled` 等非子任务。

## 崩溃恢复

1. 进程死亡后，新进程打开同一 storage，`harness.resume()` 查找未完成 task 并继续；提交或等待也会启动调度器。
2. 被切断的模型请求算一次失败尝试（受 `settings.retry` 控制）；partial answer 作为 aborted entry 留在 transcript，backoff 后重发；重试用尽，run 以 `runFailure: interrupted` 结束。
3. deferred response 被切断时作为下一次尝试再次轮询，而不是重新发起请求；run 结束会取消。
4. 被切断的工具调用：`replay: "safe"` 才重跑；否则模型收到 `interrupted` 错误结果和已提交输出。replay-safe 调用连续被切断达到 `restartLimit`，得到 `restart_limit` 错误结果。
5. 排队消息仍然排队；`requestId` 重试找回原 submission；`harness.submission(id)` 可按 id 重新获取。
6. **close 不是 crash**：close 停止的模型请求会重发。

### 崩溃循环与计数

- open 时每个被 crash、eviction 或 reset 切断的 task 计数加一；task 提交新状态时计数清零。
- 达到 `settings.restartLimit`（默认 5；`Infinity` 永不因它终止）后：
  - 工具调用得到 `restart_limit` 错误结果；
  - compaction 记 `compactionFailure`；
  - run 以 `runFailure: restart_limit` 结束；
  - 自定义 task 变为 `faulted`。
- 内置 task 以 `task_interrupted` 上报，保证 crash loop 一定到达 `onReport`。
- 进程死亡时所有运行中的 task 都计数，不只“肇事”的那个；abort handler 被切断同样次数后 task 为 `faulted`；用户主动 abort 的 run 仍以 `aborted` 结束，detail 记录切断。

### 报告与失败后的队列

- `onReport` 的 `kind`：`storage_failed`、`task_faulted`、`task_interrupted`、`migration_failed`、`task_outdated`（`missing_task` / `task_too_old` / `migration_failed`）、`task_error`、`extension_error`、`host_error`、`listener_error`。`report.task` 含 id/kind/conversationId，`report.extension` 指出安装者。
- run 因模型错误、缺模型、无可回答内容、turn 上限或崩溃失败后，排在后面的输入默认等待下一次输入；`settings.afterFailedRun: "continue"` 立即用它们开新 run，`"withdraw"` 以 `run_failed` settle 为 `unanswered`。
- 定义缺失或不可迁移的 task 在 task graph 中显示 blocked 原因；registry 变化解除阻塞时 `onWake` 报告 active，宿主无需轮询。

## 睡眠与唤醒

- task 通过结束 phase 等待时间：sleep 被存储，不占 invocation，跨重启保留；`now` 到达 `until` 后从 checkpoint 继续。
- **phase 内不能 sleep**：重启后 phase 从顶部重跑；等待后的工作必须放进下一 phase，所需数据放 checkpoint。
- `runtime.sleepUntil(at, { phase }, context)` 与 `runtime.commit()` 返回的 `{ status: "sleeping", until, checkpoint }` 等价，后者可与其他写一起提交。
- 重试 backoff、deferred-response 轮询都用同一机制。
- 定时器走 `setTimer`（默认 `setTimeout`），时间走 `now`（默认 `Date.now`），可注入 fake clock 测试；Node environment、file watcher、image worker 用自己的定时器。sleep deadline 存在 `now` 上，**同一 storage 的所有进程必须使用同一时钟**。
- 可被驱逐的宿主（Cloudflare Durable Object）用 `onWake`：Harness 不再为 sleep 设定时器，而在 `harness.wake()` 变化时告知宿主 `active`（有 task 可运行或正在运行）与 `at`（最早 sleep）。宿主保持 alarm，触发时 `resume()`。
  - 典型做法：open 前设 60s fallback alarm；任何可能启动工作的调用（submit、compact、abortTask、abort、registry 变化）之前 arm；`onWake` 写 alarm 失败则 abort 对象；运行时以 60s heartbeat 作为恢复心跳，取 heartbeat 与最早 sleep 的较早者。
  - 早触发无害，漏触发会让工作搁浅。
- 默认 `setTimer` 拒绝只为释放内存的 Worker 定时器，避免阻止 hibernation/eviction；内存会在后续 commit 时释放。

## 所有权、中止与任务图

- 普通 abort 自底向上：先 abort 被拥有者，再运行自己的 abort handler，因此每个 task 先清理自己的效果；父任务只有拥有工作结束后才终止。
- **前台 task**：属于当前工作，会话 idle 要等它们结束；Esc/`abort()` 中止它们及其拥有的一切。
- **后台 task**（`background: true`）：属于会话但不属于当前工作；会话可 idle，普通 abort 不碰它。适合跨 turn 存活的 subagent、明天的提醒；`abort(..., { background: true })` 或直接 abort 该 task 才能停止。
- 子会话（subagent）由 task 拥有：abort 调用会 abort 子会话；caller 失败（`execute()` 抛错、非 replay-safe 调用被 crash 中断）同样。
- `abandonOnRestart: true` 用于只在内存中等待、重启后不会被 caller 恢复的 task：后来 Harness 调度时发现它仍 live，就在运行任何东西之前以 `abortReason: "restart"` 连同拥有物 abort。非 replay-safe 工具的嵌套调用自动如此，其 `api.createTask()` 子任务也如此；定义缺失则等到扩展装回以执行 abort handler，期间 caller 与会话 blocked。
- `watchTaskGraph()` 观察所有 live task：owner、status、background/abort 标记、拥有的 conversations。blocked 原因不在图中，由 `harness.inspect()` 报告；owner task 终态后，其会话里的后续 task 成为顶层节点，`ConversationRecord.owner` 仍链接父级。

## 忙会话与输入

| 形式 | 语义 |
|---|---|
| follow-up（默认） | 排队，当前 run 回答后开始下一次 run |
| `whenBusy: "steer"` | 当前 tool round 之后放入，加入正在运行的 run |
| `whenBusy: "reject"` | 忙时抛 `ConversationBusy`；空闲时正常开始 run |
| `whenIdle: "reject"` | 空闲时拒绝，不自行启动 run；与 steer 合用可“只插队不启动” |
| `write` | 只追加 entry，不问模型；仅 `kind`+`data` 的 write 立即追加，可在 run 中；带 `model`/`head`/`edits` 的写像 steer 一样等边界 |
| `continue` | `{ type: "continue" }`：当前 context 有可回答内容时开新 run；忙时抛 `ConversationBusy` |

- `steeringMode: "all"` / `followUpMode: "all"` 一次放入全部排队项，而不是每 turn 一个。
- `submit(tx, draft)` 在宿主自己的 commit 内准入，返回 submission id；检查、准入、写入同一 commit。必须在 commit 自己的表写（`appendEntry`、`createTask`、另一个 admission）之前、每 commit 一次调用，否则 `ReadAfterWrite`；documents 可在前后读写；`ConversationBusy`/`ConversationIdle` 在写入前抛出；callback 之后抛错则 submission 不存在。
- `submission.abort()` 撤回排队输入。
- 输入可带自定义 `entry` kind（不能以 `pi.` 开头），模型仍看到 `content` 作为 user message；排队时 inbox item 携带该 entry。
- run 失败后排队项保留到下一次输入、write 或 continue；`runFailure` 原因：`model_error`、`no_model`、`aborted`、`reset`、`interrupted`、`faulted`、`orphaned`、`restart_limit`、`turn_limit`、`nothing_to_answer`。run 的输入也记录在其中并 settle 为 `unanswered`；orphaned 的输入带 `missing_task`/`task_too_old`/`migration_failed`。
- continue 的排队项先放入并加入新 run；context 为空或以答案结尾（包含被输出上限截断的纯文本答案）时，以 `nothing_to_answer` 结束；带 tool calls 的截断答案可以 continue，因为工具调用从未运行，context 以它们的错误结果结尾。

## 上下文管理

### Compaction

- compaction 是普通 task：总结较老 entries，追加 `pi.compaction`（摘要 + 保留的首条 entry 的 head）；旧 entries 仍保留在存储中。
- 会话继续工作；摘要 idle 时立即放置，否则下一个 turn 边界放置。
- 手动 `compact(instructions)` 返回 task id，可 `waitForTask()` 后读 outcome；Esc 可取消手动 compaction。
- 自动设置（`settings.compaction`）：`enabled`、`reserveTokens`（超过 `contextWindow - reserveTokens` 时下一请求等待）、`keepRecentTokens`（保留多少原文）、`backgroundTokens`（提前多少开始后台摘要，0 关闭）、`modelOverrides`（按 `provider/modelId` 覆盖）。
- 每会话可 `configure({ compaction })` 覆盖；取值层级：会话 `modelOverrides` → settings `modelOverrides` → 会话字段 → settings。模型专属值优先于通用值，同层会话优先于 settings；会话 `enabled: false` 也优先于 settings 的 modelOverrides。整组替换，token 数非整数或 <0 抛 `RangeError`；子会话与 fork 继承。
- provider 报 context 过长时，generation 自动 compaction 并重试一次。
- 摘要若在放置时切到当前 context 起点之前，settle 为 `stale`；多个在飞时最远的切点生效。
- 摘要花费计入 `pi.usage`；`CompactionTask` 的 `beforeCompact` hook 可拒绝或自带摘要。
- 阻塞阈值等待的 compaction 失败时，generation 不请求模型直接失败，输入以 `model_error` + detail `Compaction failed: <error>` settle；无可压缩内容或被拒绝时请求继续。
- 运行中的 compaction 在 `pi.live.compactions`（trigger `manual`/`threshold`/`overflow`、attempt、backoff）；最近失败在 `pi.live.compactionFailure`，直到下一次产出摘要。

### Reset 与 handoff

- `reset()` 开新 context：模型不再看到旧 entries，但旧 entries 保留。
- 忙时 reset 像 write 一样排队；在 tool round 中放入则当前 run 以 `reset` settle 为 `unanswered` 并结束，排队输入在新 context 中运行。
- 工具返回 `control: { handoff: "note" }` 写同样的 reset，但 run 继续：下一次模型请求用新 context，submission 最终 settle；queued writes/steers 落在 handoff 文本后，follow-ups 等 run 结束；若整轮所有结果同时 `terminate: true`，handoff 后结束。
- 旧消息始终可检索，因此可以 build “交接给自己、之后再搜历史”的 agent。

## 错误与持久化边界

### 错误三规则

1. **storage 错误结束 Harness**：调用 reject；后续调用与 pending wait 以 `SessionFailed` reject（`cause` 是原错误）；watch 以 `failed` 结束；运行 task 收到 abort signal；`onReport` 收到一次；Harness 自行 close。没有自动重试（自定义 storage 自己重试瞬时错误）；重开恢复，commits 原子保证一致，`requestId` 重试找回已准入 submission。
2. **非法读只失败该调用**：坏 cursor、未知会话、不保留的历史；被取消的读也只失败自己。但 `commit()`/`mintId()` 的任何错误（包括 `StorageRequestError`）都按规则 1 结束 Harness。
3. **用户代码只失败自己的单元**：task phase 抛错 → task faulted；tool 抛错 → 错误结果；hook 抛错 → 报告并跳过（`beforeTool` 阻断调用）；commit callback 抛错 → 回滚该 commit；listener 抛错 → 报告，其他继续。例外：`RegistryReader.snapshot()` 抛错会让 Harness 失败，因为调度无法进行。

`harness.closed` 在 close 或 storage 失败后 settle；失败时 `end.kind === "failed"`；close 等待运行中的 task 代码返回，忽略 abort signal 的代码会延迟 close。

### 持久化边界

- **只读**：Harness `readOnly: true` 时 open 不恢复，写、`resume()`、会运行 task 的调用都以 `ReadOnlySession` 拒绝；JSONL 存储也要 `readOnly: true` 打开。SQLite 可照常打开，文件锁保证安全。
- **流式输出**：partial answer 与 tool output 默认最多每 100 ms 提交一次，watch 立即看到；storage 以 deferred commit 稍后合并写入，最迟 `persistWithinMs`（默认 1,000 ms）。崩溃最多丢约该窗口；流在第一秒内崩溃可能没有 aborted entry，该次 usage 也不记录。`settings.progress` 可调。
- **deferred commit**：仅适用于只改已有、且 `history: "latest"` + `fork: "initial"` documents 的 commit；watch 立即看到，storage 延迟到下一次读写该 document、离开内存、close 或最迟 `withinMs`；崩溃丢未存储值。entries、新 document、task 状态等会让 commit 立即落库。
- **watch/observer**：watch 的 `value.entries` 是窗口；`ConversationTranscript` 负责客户端全量合并与补洞。Durable watch 不发送可恢复的 failed call，失败即结束。

## 来源

- [Pi Durable 发布博客（2026-10-01）](sources/earendil-pi-durable-post.md)
- [pi-durable README（main，2026-11-10 抓取）](sources/pi-durable-readme.md)
