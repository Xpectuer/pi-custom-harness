---
tags:
  - router-harness
  - integration
  - workspace
sources:
  - ../../examples/router/backend.ts
  - ../../examples/router-agent.ts
  - ../../bin/pi-router-harness.mjs
updated: 2026-11-10
---

# Router Harness Workspace 接入

[索引](README.md) · 相关：[Router Harness](router-harness.md) · [运行与验收](router-harness-operations.md) · [决策与边界](router-harness-decisions.md)

## 定位

接入的真实含义是：实现 `RouterBackend`，再把它注入 `registerRouter`。router 的五项工具、工具守卫和提示词保持不变。

workspace 在契约中只有 `workspaceId` 与 `isolation` 两个字段，不是目录路径。模型不能传目录、凭证或 workspace 选择参数；一个后端实例就是数据可见范围。

当前仓库只带进程内 mock，没有真实 workspace adapter。真实 worker 的进程、目录分配、隔离与结果收集都由接入方后端负责。

## 后端契约

`examples/router/backend.ts` 定义 `RouterBackend`。所有方法返回统一的 `Outcome<T>`：

- 成功：`{ ok: true, mode: "backend", data }`。
- 失败：`{ ok: false, mode: "backend", error: { code, message } }`。
- `code` 只能是 `INVALID_ARGUMENT`、`NOT_FOUND`、`BACKEND_ERROR`。

| 方法 | 输入 | 成功 data | 职责 |
| --- | --- | --- | --- |
| `dispatch` | `task`，可选 `context` | `WorkSummary` | 创建可跟踪工作；不能指定 worker 或 workspace |
| `list` | 无 | `WorkSummary[]` | 返回实例内全部工作；空集为 `[]` |
| `inspect` | `workId` | `WorkDetail` | 返回输入、关联与状态；不含结果正文 |
| `collect` | `workId` | `CollectResult` | 只读收取；completed、pending 或 failed |
| `queryContext` | `query`，可选 `sessionId` | `ContextRecord[]` | 文本子串查询；无匹配为 `[]` |
| `subscribe` | `listener` | 取消订阅函数 | 可选；只在 running 之后推送状态变化 |

`WorkSummary` 包含 `workId`、`task`、`workerId`、`sessionId`、`workspaceId`、`status`。`WorkDetail` 额外包含 `context` 与 `worker`。`WorkerDescriptor` 包含 `workspace={workspaceId,isolation}` 与 `capabilities={profile,tools,skills}`。

`examples/router-agent.ts` 的 `registerRouter(pi, backend)` 是唯一注入点。默认导出只用于 mock 演示。

## 接线

新建自己的 extension 入口，导入 `registerRouter`，注入真实后端。下面的入口与后端文件是接入示例，仓库当前未提供：

```ts
// examples/workspace-agent.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRouter } from "./router-agent.ts";
import { createWorkspaceBackend } from "./router/workspace-backend.ts";

export default function (pi: ExtensionAPI): void {
  const root = process.env.ROUTER_WORKSPACE_ROOT;
  if (!root) throw new Error("缺少 ROUTER_WORKSPACE_ROOT");
  registerRouter(
    pi,
    createWorkspaceBackend({
      workspaceRoot: root,
      piBin: process.env.PI_BIN ?? "pi",
    }),
  );
}
```

启动时保持与受支持入口相同的白名单：

```sh
ROUTER_WORKSPACE_ROOT=/path/to/repo \
pi --no-extensions -e ./examples/workspace-agent.ts \
  --no-builtin-tools --no-mcp --no-skills --no-prompt-templates \
  --tools router_dispatch,router_list,router_inspect,router_collect,router_queryContext
```

`--no-builtin-tools` 只限制 router。worker 是独立的 Pi 进程，它的工具由 worker 启动参数决定。

`bin/pi-router-harness.mjs` 写死加载 `examples/router-agent.ts`，因此 npx 入口始终使用 mock。真实后端接入使用上面的直接 `pi` 命令，或由接入方另建包装器。

## Workspace 模型

### 三种分配方式

| 方式 | 做法 | 隔离能力 |
| --- | --- | --- |
| 共享目录 | 所有 worker 使用同一个 `cwd`，同类任务串行 | 无；任务之间会互相影响 |
| 每工作 worktree | `git worktree add` 创建独立目录，作为 worker 的 `cwd` | 文件隔离；进程与凭证未隔离 |
| 容器或 microVM | 只挂载目标 workspace，凭证按需注入 | 可作为 `isolation="sandboxed"` 的依据 |

`cwd` 决定 Pi 的项目资源发现、上下文文件、session 分组和内置工具路径。worker 的 `AGENTS.md`、`.pi/settings.json`、Skill 与提示词模板都从 workspace 解析。

### 隔离字段的缺口

`WorkerDescriptor.workspace.isolation` 目前只能是 `simulated` 或 `sandboxed`（`examples/router/backend.ts:45`）。

真实但未隔离的 worker 没有合法值。接入方必须二选一：

- 扩展联合类型，加入 `"host"`，并同步更新消费方与文档。
- 强制真实 worker 走容器或 microVM，再声明 `"sandboxed"`。

不要用 `"sandboxed"` 描述共享目录或普通 worktree。

### 凭证与信任

- worker 使用 Pi 凭证存储中的凭证；不要把 key、token 或 `.env` 内容放进 task、context 或结果。
- 项目本地 `.pi/` 资源默认受信任门槛限制。需要时用 `-a` 信任，或 `-na` 忽略。
- 避免在 workspace 的 `.pi/settings.json` 中再次配置 router extension，防止 worker 递归加载 router。

## 后端实现

### dispatch

`dispatch` 必须立即返回 `running`，不能等待 worker 结束。否则 router 会一直阻塞，状态推送也失去意义。

推荐流程：

1. 校验 `task` 与 `context`（`ContextRecord` 的三个字段必须非空），空白或结构非法返回 `INVALID_ARGUMENT`。
2. 生成 `workId`、`workerId`、`sessionId`、`workspaceId`。
3. 选择或创建 workspace，把 `workspaceId` 映射到真实路径，路径只留在后端内部。
4. 把 task 与 context 格式化为 worker prompt。context 中的 `recordId` 与 `sessionId` 原样保留。
5. 启动独立 Pi 进程，`cwd` 指向 workspace。
6. 返回 `WorkSummary`，状态为 `running`。
7. 在子进程退出时更新状态并推送事件。

启动 worker 的最小命令：

```ts
import { spawn } from "node:child_process";

const child = spawn(
  piBin,
  ["-p", "--session-id", sessionId, "--", prompt],
  {
    cwd: workspaceRoot,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  },
);
```

- `-p` 让 worker 跑到结束并输出最终答复。
- `--session-id` 让 `WorkSummary.sessionId` 与 Pi session ID 一致，便于 `queryContext` 回查。不需要回查时可用 `--no-session`，此时 `queryContext` 改用自建索引。
- `--` 防止 prompt 被当作选项。
- `shell: false` 避免 task 文本进入 shell 解释。
- 用数组传参，不要拼接命令字符串。

需要结构化事件时，用 `--mode json` 替代 `-p`；读取 JSONL 中的 `message_end` 或 `agent_settled`，再提取最终 assistant 文本。无论哪种模式，都要同时收集 stderr，设置超时，并限制 stdout/stderr 的最大长度。

### list、inspect、collect

- 用同一张作业表保存摘要、context、worker 描述、结果与失败原因。
- `list` 返回全部工作的摘要，包括 completed 与 failed。
- `inspect` 返回 `WorkDetail`，不返回完成结果。
- `collect` 只读：completed 重复调用返回相同结果；running 返回 `{ status: "pending" }`；failed 返回失败原因；未知 `workId` 返回 `NOT_FOUND`。
- worker 非零退出或超时属于业务失败，写入 `failed`，不要返回 `BACKEND_ERROR`。
- 后端抛出的异常由 `registerRouter` 统一转为 `BACKEND_ERROR`。

### queryContext

`queryContext` 的数据源由接入方决定，模型只能传查询文本与可选 `sessionId`。

两种常见做法：

- **自建索引**：读取 workspace 的文档、任务产物或数据库，返回 `ContextRecord`。
- **Pi session**：用 `SessionManager.list(workspaceRoot)` 找到 session，再用 `SessionManager.open(path).getEntries()` 读取消息条目。把文本映射为 `{ recordId, sessionId, text }`；`recordId` 建议加 session 前缀，避免跨 session 冲突。

查询按 trim + 小写后的子串匹配；`sessionId` 精确过滤；无匹配返回 `[]`。`recordId`、`sessionId`、`text` 必须是非空字符串。`ContextRecord` 是内容与来源标识，不是可执行引用。

### subscribe

worker 状态从 `running` 转为 `completed` 或 `failed` 时，调用订阅者：

```ts
listener({
  eventId: randomUUID(),
  workId,
  status,
  workerId,
  sessionId,
  occurredAt: new Date().toISOString(),
});
```

约束：

- 每个工作只推送一次最终状态。
- `eventId` 在实例内唯一，router 用它去重。
- 事件只带定位信息，不带结果或失败正文；结果由 `router_collect` 读取。
- router 在 200ms 窗口内合并事件，并用 `router_work_event` 消息唤醒模型。
- `session_shutdown` 时 router 只取消订阅，不会杀死 worker。worker 的生命周期由后端决定。
- 推送异常被 router 吞掉，不影响工作状态；丢失的提醒可由下一次 `router_list` 发现。

`subscribe` 是 router 与后端之间的进程内契约。worker 在别的进程或主机时，由后端负责把状态送回 router 进程。

## 安全边界

- router 的 `tool_call` 守卫只限制 router 进程内的工具调用。worker 的权限由 worker 启动参数决定。
- 共享目录或普通 worktree 不能防止 worker 读写宿主其他路径。不可信 workspace 必须放进容器或 microVM。
- task 与 context 可能包含提示注入。用分隔符标明它们是数据，并在 worker prompt 中要求只按任务执行；最终授权仍由后端与沙箱保证。
- 结果、错误和 stderr 要截断；不要暴露环境变量、密钥、堆栈或内部路径。
- workspace 根目录来自可信配置，不接受模型传入的路径。

## 验收

| 检查 | 期望 |
| --- | --- |
| 空工作集 | `router_list` 返回 `[]` |
| 空白 task | `INVALID_ARGUMENT`，且不新增工作 |
| 未知 workId | `NOT_FOUND` |
| running | `collect` 返回 `pending` |
| completed | 连续 collect 结果深度相等 |
| failed | 返回失败原因，不是 `BACKEND_ERROR` |
| 事件 | 去重、合并、无结果正文 |
| workspace | worker 只改目标目录；`isolation` 与实际隔离一致 |

## 已知缺口

- 仓库没有真实 workspace adapter；本文是接入契约与实现指引。
- `isolation` 只有 `simulated` 与 `sandboxed`，无法表示真实但未隔离的 worker。
- `router_dispatch` 的工具描述写死为“任务文本只作为数据记录，不执行”（`examples/router-agent.ts:156`）。真实后端执行任务后，该描述不再准确；需要按 `backend.mode` 切换描述，或接受模型收到过时说明。
- 没有 cancel、merge、delete 工具；停止 worker、合并代码、删除 workspace 都由宿主脚本负责。
- `subscribe` 是进程内契约；跨进程与跨主机送达未实现。
- 默认 npx 入口固定使用 mock，不能直接加载自定义后端。

## 来源

- [Router Backend 接口](../../examples/router/backend.ts)
- [Router Extension](../../examples/router-agent.ts)
- [npx 启动包装器](../../bin/pi-router-harness.mjs)
- [Router Harness](router-harness.md) · [运行与验收](router-harness-operations.md) · [决策与边界](router-harness-decisions.md)
