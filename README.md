# pi-router-harness

Pi Router Agent 的一键启动入口：固定加载 `examples/router-agent.ts`，只暴露五项 `router_*` 协调工具，并使用进程内 mock 后端。

## 文档

- [Workspace 接入 router agent](docs/wiki/router-harness-workspace-integration.md) — 实现 `RouterBackend`、把 workspace 映射到 worker、状态推送与验收清单
- [Router Harness 架构](docs/wiki/router-harness.md) — 五项工具、后端契约、权限边界与 mock 生命周期
- [Router Harness 运行与验收](docs/wiki/router-harness-operations.md) — 启动命令、演示路径、验收证据与排障

## 使用

直接从 GitHub（npm 12 默认禁止 git 源，需显式允许）：

```sh
npx --yes --allow-git=all github:Xpectuer/pi-custom-harness
```

npm：

```sh
npx --yes pi-router-harness
```

本地仓库：

```sh
npx --yes .
```

其余参数原样传给 Pi，例如：

```sh
npx --yes . --mode json --no-session "汇总当前全部工作的进展与已完成结果"
```

## 前置

- Pi CLI 已安装且在 `PATH` 中；可用 `PI_BIN=/path/to/pi` 指定可执行文件。
- 真实模型需要有效的 Pi 凭证：运行 `pi auth login <provider>`；凭证保存在 Pi 凭证存储，不随 Git 提交。
- Node.js >= 22.19.0。

## worker 状态推送

后端可选实现 `RouterBackend.subscribe(listener)`：worker 从 running 变为 completed/failed 时推送 `WorkEvent`（只含 `workId`、状态与关联标识，不含结果）。router extension 会合并同一批事件、按 `eventId` 去重，再用 `router_work_event` 消息唤醒模型；模型随后调用 `router_collect` 取结果。不支持推送的后端可省略 `subscribe`，`router_list` / `router_collect` 仍可用。

mock 用 `complete(workId)` / `fail(workId)` 模拟状态流转；演示入口可让 running 工作自动完成：

```sh
PI_ROUTER_MOCK_COMPLETE_MS=3000 npx --yes .
```

## 上下文水线

router 默认在每次 run 结束后检查上下文：达到当前模型窗口的 50% 就触发 compact（`ROUTER_COMPACT_AT_PERCENT`）。`compaction.enabled=false`、aborted run 或用量未知时跳过。

## 边界

- 默认后端是 mock：所有派活、worker 描述与结果均为模拟，不代表真实执行或沙盒隔离。
- 启动时固定禁用内置工具、MCP、Skill、提示词模板与其他扩展；参数里的 `--tools` 等覆盖项仍会追加传给 Pi。
