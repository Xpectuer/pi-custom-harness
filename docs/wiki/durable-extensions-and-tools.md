---
tags:
  - pi-durable
  - extensions
  - tools
  - code-mode
sources:
  - sources/earendil-pi-durable-post.md
  - sources/pi-durable-readme.md
updated: 2026-11-10
---

# 扩展、工具与 Code Mode

[索引](README.md) · 相关：[架构](durable-harness.md) · [执行语义](durable-execution.md) · [术语表](glossary.md)

## Extension 与 registry

- extension 是命名的 `tools` + `sections` + `hooks` + `wraps` + `tasks` 捆绑，用 `defineExtension({ name, ... })` 定义。
- 应用把扩展装进 `registry`；默认每个会话选择所有已安装扩展，按安装顺序。`settings.extensions` 可给默认选择；会话在 `pi.agent` 只存扩展名与工具名。
- `registry.install()` 同名的扩展一次替换；`registry.uninstall()` 移除同名扩展。
- 运行中的工作沿用旧代码：正在跑的工具调用用旧实现跑完；每个 task phase 在开始时解析 hooks 与 agent，下一 phase、下一请求或下一次调用才用新代码。
- 重启后需要重新安装扩展；pending task 在扩展装回后继续运行。定义缺失的 task 显示 blocked，装回后解除。

## System prompt sections

- system prompt 每次请求前按 sections 顺序重建；section 可读 resolved agent、请求的 environment、已提交 documents。
- section 返回 `undefined` 则省略；例如 `section("cwd", (input) => input.env?.cwd)` 渲染为 `<cwd>…</cwd>`。
- 会话的 `instructions` 最后渲染为 `instructions` section。
- sections 与 tools 的变化以 positional `pi.system` entry 记录在 transcript，重启或 fork 看到模型当时看到的内容；支持的模型上只发送变化部分，保住 provider prompt cache。
- 每次返回不同内容的 section（如当前时间）会破坏缓存，需权衡。

## 工具

- `@earendil-works/pi-durable/tools` 提供 `read`、`write`、`edit`、`bash` 与 `CodingTools`；它们只通过调用的 execution environment 访问文件与进程。
- 图片：`read` 把图片作为 image block，默认限制 2000×2000 像素、4.5 MB base64。没有 image processor 时按文件头判断尺寸，PNG/JPEG/GIF/WebP 在限制内原样发送，超限或其他格式拒绝；有 processor 时解码、按 EXIF 转正、BMP 转 PNG 并缩放。
  - Photon 基于 WebAssembly，`/images/node` 在 worker 线程处理，30s 无图片后退出；`/images/cloudflare` 在调用线程处理且 WebAssembly 内存不收缩，内存受限宿主慎用。
  - 模型不支持图片输入时看到占位符，`read` 在 diagnostic 中说明。
- `defineTool()` 用 `@earendil-works/pi-schema` 从 `parameters` 推导 `args`，execute 前由 Harness 校验与 coerce；`api.output()` 流式输出，execute 未返回 `output` 时成为结果。
- 每次调用是独立 durable task，intent 在 `execute()` 前提交；崩溃后仅 `replay: "safe"` 重跑，否则模型收到 `interrupted` 错误结果与已提交输出。replay-safe 调用连续被切断达到 `restartLimit` 得到 `restart_limit` 错误结果。execute 抛错得到错误结果。
- 结果三通道：
  - `output`：给模型；
  - `structuredOutput`：给调用该工具的程序；声明 `structuredOutputSchema` 时校验；
  - `details`：给 UI。
  transcript 只存 `output` 与 `details`；`structuredOutput` 是工具自己的值，schema 工具的错误结果也保留该值。
- 结果可带 `usage` 计入会话；可带 `control: { terminate: true }`，当整轮所有结果都要求 terminate 时，run 不再请求模型直接结束。
- 同名工具的后者覆盖前者；`wrapTool()` 装饰该名字最终胜出的实现，无论由哪个扩展提供。`wrapSection()` 同理装饰 section。

## 嵌套调用与工具可见性

- `api.executeTool()` 让工具调用另一个工具（Code Mode 脚本、MCP bridge 都走这条路径）。嵌套调用是独立 tool task，归调用者所有：经过校验与 `ToolTask` hooks，有自己的输出限制与 replay 策略；返回 `taskId`、`structuredOutput`、`details`、`diagnostics`、`usage`、`isError`，**不返回**给模型的 `output`。
- `executeTool()` 在 caller 的 `execute()` 返回后、caller abort 时、Harness close 时 reject；取消传入的 context 只停止等待。blocked、invalid、failed、aborted 的嵌套调用返回 `isError` 结果。
- hooks 通过 `call.parent` 区分嵌套调用，可对脚本发起的调用采用不同策略。
- caller 运行期间，嵌套调用列在 `pi.live.nestedTools`（`parentCallId`、`parentTaskId`、参数、完成后的 error/duration/usage summary）；`progress: false` 不把运行输出放进 `pi.live`。caller settle 前遗留的嵌套调用（包括早先 attempt 创建的）被 abort；caller 的结果消息不列出它们，task 记录保留。
- key 与重放：嵌套调用以在 caller 中的位置为 key，也可由 caller 传 `{ key }`。replay-safe caller 崩溃后按同序/同 key 重跑，会拿回已完成或仍在运行的嵌套调用，而不是新建。崩溃时未提交结果的嵌套调用按自己的 replay 策略处理；非 replay-safe caller 重启后，未完成的嵌套调用连同拥有物被放弃。
- 嵌套调用的 `usage` 记在该工具名下；caller 结果再传一次会**重复计费**。嵌套结果只暂存在 caller 的 `NestedCallDoc`，caller settle 后只留小回执。
- 嵌套深度无上限；工具默认 `callers: ["model", "tools"]`，可调用自己。需要限制时设置 `callers: ["model"]`（脚本不能启动脚本）或 `["tools"]`（不提示给模型）。
- `modelTools` 只收窄模型可见的工具集合，不影响脚本调用；`tools` 仍决定启用的全集，`modelTools` 不能添加。
- `deferred: true` 工具在加载前不提示给模型，但其他工具可随时调用；`tool_search` 扩展让模型搜索 deferred 工具，并用 `control.addTools` 加载，加载记录进 `modelTools`，在该分支上跨 compaction 保留。适用于大型工具集（如 MCP server）。
- `abandonOnRestart: true`：只在内存中等待、重启后不会被 caller 恢复的 task；后来 Harness 调度时发现仍 live，就在运行任何东西前以 `abortReason: "restart"` 连同拥有物 abort。非 replay-safe 工具的嵌套调用自动如此，其 `api.createTask()` 子任务也如此；定义缺失则等扩展装回执行 abort handler，期间 caller 与会话 blocked。

## Code Mode

- `@earendil-works/pi-durable/codemode` 增加 `codemode` 工具：模型写 JavaScript，在 QuickJS 沙箱（`@earendil-works/pi-codemode`）中 `await tools.<name>(args)`；每次调用是嵌套 tool call，只有脚本输出给模型。
- 跨重启恢复：沙箱确定性执行（虚拟时钟、种子随机、UTC），工具在交付每个结果前写 journal；重启后重跑脚本并按序喂回 journal 结果，重挂到同 key 的嵌套调用后继续。
  - 脚本走不同路径、沙箱 fingerprint 或 code mode 版本变化、`timeout_ms` 已过时，rerun 以错误结束。
  - 重启时仍在运行的嵌套调用按自己的 replay 策略处理。
- `codemode` prompt section 用 token 预算列出脚本可调用的工具的 TypeScript 声明；脚本可用 `searchTools()`、`describeTool()`、`describeNamespace()` 找其余工具；`namespaces: [{ name, description, prefix }]` 按名字前缀分组（如 MCP 的 `mcp__github__`）。
- 结果包含 header、脚本输出、失败时已做的调用；超过 `max_output_tokens` 的文本截断，全文放临时文件。
- 脚本可用 `models.*`：模型目录、`classify()`、`generateImages()`，作为内部工具的嵌套调用；`models: false` 关闭。
- `store(key, value)` / `load(key)` 每会话保存 JSON；fork 看到 fork entry 时点的值。
- Cloudflare 用 `RemoteCodemodeSandbox`；关闭沙箱（例如 shutdown）不算结果，脚本在下一进程的 sandbox 继续。
- 嵌套调用失败在脚本中 reject（带错误文本），除非工具声明 schema 并返回自身错误值；例如 `bash` 以 `{ output, exitCode }` resolve，脚本应检查 `exitCode`。

## Hooks

- `GenerationTask` hooks：`beforeRequest`（替换一次请求的 messages）、`beforeProviderRequest`（替换 provider 请求体，例如设置 provider 专属字段）、`afterResponse`、`onYield`（用另一条 user message 继续 run）、`afterTools`（一轮工具完成后运行）、`afterRun`。
- `ToolTask` hooks：`beforeTool`（阻断或改写参数）、`afterTool`（替换结果）。`afterTool` 看到工具 task 写入的每个结果，包括 Harness 自己写的 unavailable/invalid/blocked/interrupted/restart_limit/aborted 错误结果；超过 `settings.restartLimit` 后不再运行；abort 时在 abort handler 内运行，慢 hook 会延迟 `abort()`。
- 链式语义：多个扩展 hook 同一目标时按会话选择顺序组成链；`beforeTool` 把改写后的参数往下传，首个 block 停止链；`afterTool` 把结果往下传；`onYield` 停在首个让 run 继续的 hook；`afterResponse` 这类 observer 总是全部运行。
- hook 抛错会被报告；`beforeTool` 例外，抛错即阻断该调用。
- hook 崩溃后会重跑，因此会做决策的 hook 必须把决策写进 `api.memo()`（小值、首次写入生效），例如审批结果。
- hook 可读已提交 documents（`api.snapshot()`）与原始历史（`api.entry()` / `api.entries()`，compaction 不改动原始历史）。`beforeCompact` 可拒绝 compaction 或自带摘要。
- 要将 hook 限定到部分会话，只在这些会话选择其扩展，例如 `configure({ extensions: { add: [Guard] } })`。

### afterRun

- `afterRun` 在 run 回答后启动 durable 工作（例如编辑文件后跑测试），返回 `runEndTask()` 创建的 tasks；generation 作为子任务创建并等待。
- 触发时机：最终答案或 `terminate` 轮之后；`onYield` continuation 期间、失败或 abort 后不运行。
- answer 先提交、submission 先 settle 为 `done`；`pi.live.run` 与 `run.afterRun` 保留，会话保持 busy，`waitForIdle()` 包含这些任务；Stop abort 它们；崩溃会恢复。任务存在前崩溃会再次询问 hooks，存在后不会重复。
- 任务用 `runtime.conversation()` 拿 handle，在 commit 内 `handle.submit(tx, draft)` 写消息/跟进，run 结束时放置；follow-up 会开 fix run 并重新问 `afterRun`，需要自行限流。
- 损坏的请求（未安装/内置 task、非 JSON 输入、`initial()` 抛错）经 `onReport` 对 hook 的扩展报告并跳过，run 仍结束。

## 自定义 task 与 subagent

- `defineTask({ name, version, initial, phases, abort })`：泛型为 input、state、result；phase 内用 `runtime.commit()` 提交 `terminal` outcome、`waiting`（含 checkpoint、`on`、`policy`）或 `sleeping`。
- checkpoint 必须包含下一 phase 所需数据；phase 重启从顶部重跑，不能依赖内存在等待后仍存在。
- `abort` handler 自底向上清理自己拥有的工作；`runtime.outcomes()` 读子任务结果。
- 所有权由 `tx.createTask(..., { ownership })` 决定；工具可用 `api.createTask()` 创建并 `api.waitForTask()` 等待，或用 `api.createTask(..., { background: true })` 放后台。
- subagent 不是内置概念：工具在 `api.commit()` 中用 `ownership: { kind: "task", taskId: api.taskId }` 创建子会话，配置更便宜模型/更少工具，`submit()` 后 `wait()`，再读子会话 transcript 的答案。replay-safe 的 subagent 工具崩溃重跑时会找回同一子会话与同一 submission，不会重复创建。子会话拥有自己的 usage，UI 可通过 tool 的 `details` 挂到调用下。示例 21（前台）与 22（后台持久 subagent）。
- 任务图 `watchTaskGraph()` 观察所有 live task 的 owner、status 与 background 标记；blocked 原因用 `harness.inspect()`。

## 来源

- [Pi Durable 发布博客（2026-10-01）](sources/earendil-pi-durable-post.md)
- [pi-durable README（main，2026-11-10 抓取）](sources/pi-durable-readme.md)
