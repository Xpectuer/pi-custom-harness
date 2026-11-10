# pi-router-harness

Pi Router Agent 的一键启动入口：固定加载 `examples/router-agent.ts`，只暴露五项 `router_*` 协调工具，并使用进程内 mock 后端。

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
- 真实模型需要有效的 Pi 凭证，使用 `pi auth login <provider>` 配置。
- Node.js >= 22.19.0。

## 边界

- 默认后端是 mock：所有派活、worker 描述与结果均为模拟，不代表真实执行或沙盒隔离。
- 启动时固定禁用内置工具、MCP、Skill、提示词模板与其他扩展；参数里的 `--tools` 等覆盖项仍会追加传给 Pi。
