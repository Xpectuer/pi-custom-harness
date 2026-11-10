---
tags:
  - router-harness
  - architecture
  - pi-extension
  - mock
sources:
  - sources/router-harness-intent-20261110.md
  - sources/router-harness-discuss-20261110.md
  - sources/router-harness-spec-20261110.md
  - sources/router-harness-mvp-20261110.md
updated: 2026-11-10
---

# Router Harness

[索引](README.md) · 相关：[运行与验收](router-harness-operations.md) · [决策与边界](router-harness-decisions.md) · [术语表](glossary.md)

## 定位

Router Harness 是基于 custom Pi extension 的 router：用户把任务交给 workers，只问一次整体进展，router 查询各项工作、收取已完成结果并汇总，减少在多个 session 之间切换与搬运上下文的负担。**Confirmed**（INTENT v7、MVP v6）。

本轮实现协调接口、进程内 mock 与 worker 状态推送：后端可选地把 running 之后的变化推给 router，router 被唤醒后仍用 `router_collect` 取结果。真实 worker、真实后端、持久化与真实沙盒隔离未实现；R-8 workflow 定义为后续版本。

## 核心路径

1. 用户从 Pi CLI 输入整体进展问题，不提供逐项 `workId`。
2. router 调 `router_list` 取得全部工作及状态。
3. 对 completed 项调 `router_collect` 读取结果；running 项得到 pending；failed 项得到失败原因。
4. router 在一条答复中汇总全部工作，区分 running、completed、failed，并标明 mock 数据。

上下文路径：`router_queryContext` 取出带 `recordId`/`sessionId` 的合成记录 → 放入 `router_dispatch.context` → `router_inspect` 回读来源。

推送路径：worker 状态变化 → 后端触发 `subscribe` 监听器 → extension 合并/去重事件 → 以 `router_work_event` 消息唤醒 router → router 调 `router_collect` 取结果并汇总。用户不需要再追问。

## 五项能力

| 模型工具 | 后端方法 | 输入 | 成功 data | 语义 |
| --- | --- | --- | --- | --- |
| `router_dispatch` | `dispatch` | `task`；可选 `context` | `WorkSummary` | 创建可跟踪工作；模型不能指定 worker 或 workspace |
| `router_list` | `list` | 空对象 | `WorkSummary[]` | 返回实例内全部工作，含 completed/failed；空集为 `[]` |
| `router_inspect` | `inspect` | `workId` | `WorkDetail` | 查看输入、关联与状态；不收取结果 |
| `router_collect` | `collect` | `workId` | `CollectResult` | 只读收取；不消费、不改状态、不合并代码 |
| `router_queryContext` | `queryContext` | `query`；可选 `sessionId` | `ContextRecord[]` | 文本子串查询；可精确筛选来源 session；无匹配为 `[]` |

工具名使用 `router_` 前缀，后端方法保留 D-1 的原始命名。详细启动方式见[运行与验收](router-harness-operations.md#启动)。

## 状态推送

后端可选实现 `subscribe(listener)`，在 work 从 `running` 转为 `completed`/`failed` 时同步调用监听器。返回值是取消订阅函数，重复取消安全；不支持推送的后端省略该方法，`router_list`/`router_collect` 仍是按需路径。

`WorkEvent` 只带定位信息：

| 字段 | 约束 | 用途 |
| --- | --- | --- |
| `eventId` | 后端唯一的非空 string | router 去重；同一事件重放不会重复唤醒 |
| `workId` | 非空 string | 后续 `router_collect` 的入参 |
| `status` | `completed` / `failed` | 区分完成与失败 |
| `workerId`、`sessionId` | 非空 string | 标明来源 |
| `occurredAt` | ISO 8601 string | 事件时间 |

事件**不包含**结果或失败正文：结果只从 `router_collect` 读取，避免通知与工具结果出现两份事实。

extension 侧行为：

- `session_start` 时订阅，`session_shutdown` 时取消订阅并丢弃待发送事件；session 结束后到达的事件不再唤醒模型。
- 同一 `eventId` 只处理一次；200ms 窗口内的事件合并为一条 `router_work_event` 消息。
- 消息用 `pi.sendMessage({ triggerTurn: true, deliverAs: "followUp" })` 注入。router 空闲时立即开始新 run；正在运行时排到当前 run 之后。
- 提示词要求模型对消息中的每个 `workId` 调用 `router_collect`，并用一条答复汇总；事件字段视为数据，不当作已收取的结果或用户新指令。
- 通知发送失败只影响提醒，不回传 worker、不改变工作状态；丢失的通知可由下一次 `router_list` 发现。

## 上下文水线

router 默认把 compact 水线设为当前模型上下文窗口的 50%（`ROUTER_COMPACT_AT_PERCENT`）。每个 run 完全 settled 后检查 `ctx.getContextUsage()`，`tokens` 达到窗口的 50% 时调用 `ctx.compact()` 压缩。

- 用窗口百分比而不是固定 `reserveTokens`：模型窗口随所选模型变化，绝对 token 数会失准。
- `compaction.enabled=false`、aborted run、`tokens=null`（刚压缩完尚无新回复）时跳过；同一压缩在途不重复触发。
- 压缩失败通过 UI 警告报告，不改变工具权限、工作状态或 mock 数据。
- 检查点在 run 结束后的空闲点，run 内上下文仍可能超过水线；Pi 自身的 threshold/overflow 压缩继续兜底。
- 压缩沿用 Pi 的 `keepRecentTokens` 与 `modelOverrides` 设置。

## 后端契约

每次调用返回统一的 `Outcome<T>`：

- 成功：`ok=true`、`mode`、`data`。
- 失败：`ok=false`、`mode`、`error={code,message}`。
- `code` 仅 `INVALID_ARGUMENT`、`NOT_FOUND`、`BACKEND_ERROR`；message 不包含密钥、堆栈或内部认证信息。
- mock 文本加“模拟结果，未执行真实工作”；工具 details 保存同一 Outcome；错误设置 Pi `isError=true`。
- 后端抛错转 `BACKEND_ERROR`，不改写成空清单或模拟成功。

核心类型：

| 类型 | 约束 |
| --- | --- |
| `WorkSummary` | `workId`、`task`、`workerId`、`sessionId`、`workspaceId` 为 string；`status` 为 running/completed/failed |
| `WorkDetail` | 包含 `WorkSummary`、`context`、`worker`；不含完成结果 |
| `WorkerDescriptor` | `workspace={workspaceId,isolation}`；`capabilities={profile,tools,skills}`；mock 的 `isolation=simulated` |
| `ContextRecord` | `recordId`、`sessionId`、`text` 非空 string；是内容与来源标识，不是可执行引用 |
| `CollectResult` | completed → `{status,workId,result}`；running → `{status:pending,workId}`；failed → `{status:failed,workId,error.message}` |
| `WorkEvent` | `eventId`、`workId`、`status`（completed/failed）、`workerId`、`sessionId`、`occurredAt`；不含结果正文 |
| `subscribe` | 可选后端方法；只在 running 之后推送；返回取消订阅函数；异常不改变工作状态 |

`task`、`workId`、`query`、`sessionId` 必须 trim 后非空；schema 不接受额外字段；非法 dispatch 在写入工作表前失败。工作失败是业务状态，不是 `BACKEND_ERROR`。

## mock 数据与生命周期

- 默认两项演示工作：一项 completed、一项 running；三个跨两个 mock session 的上下文记录，其中包含“接口约束”。
- 默认 dispatch 立即返回 completed，结果是固定模拟文本，明确说明任务没有执行。
- `createMockBackend` 构造参数可指定空种子、失败工作、运行中派活结果或 `completeAfterMs`；这些控制仅供接入代码与测试，不增加模型工具参数。
- `MockRouterBackend.complete(workId, result?)` / `fail(workId, message?)` 模拟 worker 状态流转：只接受 running 工作，成功后推送对应事件；重复调用返回 `false` 且不重复推送。它们是接入代码的控制面，不是模型工具。
- 派活时已是 completed/failed 不产生事件；事件只表示 running 之后的变化。
- `queryContext` 对 text 与 query 做 trim + 小写归一后子串匹配；sessionId 精确过滤；按种子顺序返回，不排序、不分页。
- 无文件、进程或网络业务副作用；默认无计时器，running 项不会自行完成。配置 `completeAfterMs` 后，running 种子与 running 派活会在该延迟后自动完成并推送 `work_completed`；`PI_ROUTER_MOCK_COMPLETE_MS` 在默认入口启用该演示。

实例边界（A-S1）：实现上 mock 状态只属于当前 extension 实例，`workId` 带实例标识，启动提示“mock 状态已重置；跨 session 查询来自预置数据”。实现行为 **Confirmed**；规格审批 **Pending**，详见[SPEC 草案假设](router-harness-decisions.md#spec-草案假设)。

## 权限边界

受支持入口固定加载 router，关闭内置工具、MCP、Skill、提示词模板与其他扩展，只暴露五项 `router_*` 工具。

- `session_start` 与 `before_agent_start` 将 active/selected 收紧到五项白名单；状态推送只创建自定义消息，不增加工具。
- `tool_call` 拒绝白名单外调用；其他工具发起的嵌套调用同样被拒绝。
- 白名单不含 codemode、tool_search、MCP、Bash、文件读写或通用转发入口。
- 模型不能通过派活输入让 mock 创建进程、打开路径或运行代码；后端由接入方在代码中选择。
- 该边界约束模型工具权限，不是宿主进程沙盒。Pi 自身加载配置、会话存储和用户直接使用 CLI 不属于模型权限；任意新增可信 extension 仍可执行宿主代码。

## 入口

三种入口固定加载 `examples/router-agent.ts` 并透传参数：

```sh
npx --yes pi-router-harness
npx --yes --allow-git=all github:Xpectuer/pi-custom-harness
npx --yes .
```

npm 包为 `pi-router-harness@0.1.0`；GitHub 公共仓库为 `Xpectuer/pi-custom-harness`。npm 12 默认禁止 git 源，GitHub 入口必须加 `--allow-git=all`。完整启动、演示与发布信息见[运行与验收](router-harness-operations.md)。

## 兼容性

- 验收基线：Pi 1.5.1、归档 commit `815541a`、Node >= 22.19.0、TypeBox 1.3.27。
- 扩展使用宿主 TypeBox 与 coding-agent 虚拟模块；不在 `modules/pi` 中修改或提交。
- 新入口与 `examples/custom-tools.ts` 独立，不改变原示例行为或全局 Pi 设置。
- 升级 Pi 后必须重做 active/selected、执行守卫与生命周期验收。
- 用户已确认 npx 入口可在根目录新增 `package.json`；仅用于入口，无依赖、无构建脚本。旧 SPEC 文本保留为历史，见[规格偏差与解决](router-harness-decisions.md#规格与实现偏差)。

## 来源

- [Router Harness INTENT（v7）](sources/router-harness-intent-20261110.md)
- [Router Harness 讨论检查点 CP-3](sources/router-harness-discuss-20261110.md)
- [Router Harness SPEC（草案 v1）](sources/router-harness-spec-20261110.md)
- [Router Harness MVP（v6）](sources/router-harness-mvp-20261110.md)
