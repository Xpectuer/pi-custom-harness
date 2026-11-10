# Pi 安装检查与自定义工具集调研

日期：2026-11-10

## 1. 安装现状

| 项 | 值 |
|---|---|
| CLI 版本 | `pi --version` → `1.5.1` |
| npm 包 | `@earendil-works/pi-coding-agent@1.5.1` |
| 入口 | `~/.local/bin/pi` → `~/.pi/agent/bin/pi`（launcher） |
| 实际可执行 | `~/.pi/agent/install/releases/1.5.1/node_modules/.bin/pi` → `dist/bundle/cli.js` |
| 安装方式 | pi.dev 管理式安装（`managed-install.json`，layout `releases-v1`），用 `pi update` 更新 |
| Node 运行时 | PATH 中 `node v26.3.1`（Homebrew）；launcher 优先的 `~/.local/share/pi-node/current/bin/node` 不存在。要求 `>=22.19.0`，满足 |
| 磁盘占用 | 当前 `1.5.1` 152M；旧版 `1.1.0` 159M 仍保留 |
| 配置目录 | `~/.pi/agent/`：`settings.json`、`auth.json`、`models-store.json`、`sessions/` |
| 默认模型 | `deepseek` / `deepseek-v4-pro` |

认证实测：

- `auth.json` 只有 `deepseek` 的 API key。
- `pi auth check --provider deepseek --json` 返回 `{"status":"ready"}`，但真实请求返回
  `401 Authentication Fails ... api key ****1277 is invalid`。
- 即：`auth check` 只验证凭证存在/可解析，不验证服务端有效性；当前 key 已失效。

注意：bun 全局还装了 `@oh-my-pi/pi-coding-agent@17.4.0`（`omp`），与本次的 `pi` 是不同产品，不要混淆。

## 2. 结论

**可以。** Pi 原生支持“去掉默认工具，只保留指定自定义工具”，且有多层入口：

| 层级 | 做法 | 效果 |
|---|---|---|
| CLI 开关 | `--no-builtin-tools` (`-nbt`) | 关闭默认内置工具，保留 extension/custom 工具 |
| CLI 白名单 | `--tools name1,name2` (`-t`) | 只启用列出的工具（精确 allowlist） |
| CLI 黑名单 | `--exclude-tools` (`-xt`) / `--no-mcp` | 排除指定工具 / 全部 MCP 工具 |
| 全禁 | `--no-tools` (`-nt`) | 内置、extension、custom、MCP 全部禁用 |
| 持久配置 | `settings.json` 的 `defaultTools` + `extensions` | 每个会话生效 |
| SDK | `createAgentSession({ noTools: "builtin", customTools })` | 自建 harness |

自定义工具通过 extension 的 `pi.registerTool()` 注册；注册为 `direct` exposure 时默认激活。

## 3. 实测证据

测试 extension 注册一个 `custom_ping` 工具，并在 `before_agent_start` 记录
`pi.getActiveTools()`、`systemPromptOptions.selectedTools`（即发给模型的工具声明）。

| 场景 | active | selected |
|---|---|---|
| 默认 + extension | `read`, `bash`, `edit`, `write`, `custom_ping` | 同左 |
| `--no-builtin-tools` + extension | `custom_ping` | `custom_ping` |
| `--tools custom_ping` + extension | `custom_ping` | `custom_ping` |
| 项目 `.pi/settings.json` `{"defaultTools": []}` + `.pi/extensions/` 自动发现 | `custom_ping` | `custom_ping` |

系统提示同步验证：`--no-builtin-tools` 下 `<tools>` 段只有一行：

```
<tools>
- custom_ping: Ping the harness and return an acknowledgment

Additional tools may be available.
</tools>
```

（“Additional tools may be available.” 是固定文案，不代表仍有其他工具。）

## 4. 推荐用法

### 4.1 一次性运行

最小自定义工具集：

```sh
pi -e ./examples/custom-tools.ts --no-builtin-tools --no-mcp
```

精确白名单（即便加载了其他 extension，也只暴露列出的工具）：

```sh
pi -e ./examples/custom-tools.ts --tools custom_ping --no-mcp
```

### 4.2 项目内固化

```json
// .pi/settings.json
{
  "defaultTools": ["custom_ping"],
  "extensions": ["../examples/custom-tools.ts"]
}
```

- `defaultTools` 用 plain name 时是完整替换选择；`[]` 表示关闭全部内置工具但保留 extension 工具。
- 项目 settings 里的相对路径从项目 `.pi/` 目录解析。
- 也可以省略 `extensions`，把文件放到 `.pi/extensions/` 自动发现；项目本地资源需要项目 trust（交互确认或 `--approve`）。

### 4.3 自建 harness（SDK）

```ts
const { session } = await createAgentSession({
  noTools: "builtin",          // 关闭默认内置工具，保留 customTools
  customTools: [myToolDefinition],
  sessionManager: SessionManager.inMemory(),
});
```

SDK 还支持 `tools`（allowlist，空数组连 MCP 一起禁）、`excludeTools`。

## 5. 坑与边界

1. **MCP 默认是 `codemode` exposure**：连接后 Pi 会自动激活 `codemode`，即使 `-nbt`。要绝对隔离，加 `--no-mcp`（或禁用 `builtin:mcp`）。
2. **`--tools` 不自动过滤 MCP**：非空且不含 `mcp__` 条目时，MCP 工具仍保留给 `codemode`/`tool_search`；只有空列表才连 MCP 一起禁用。严格按照“只留我的工具”时用 `--no-mcp` 或 `--exclude-tools 'mcp__*'`。
3. **`defaultTools: []` 只禁内置**，不禁 extension/custom/MCP。
4. **`pi.getAllTools()` 会列出未激活的内置工具**，不能用来判断“模型看到什么”；看 `getActiveTools()` 或 `systemPromptOptions.selectedTools`。
5. **项目 `.pi/extensions` 需要 trust**；`-e` 显式路径不依赖项目 trust。
6. **`--no-extensions` 会禁用内置扩展（含 MCP/codemode）**，但显式 `-e` 的 extension 仍加载，适合完全自控的启动方式。
7. **同名工具可覆盖内置工具**：extension 注册 `read`/`bash` 等会直接替换内置实现，这是定制内置工具的正式入口。

## 6. 待解决

DeepSeek API key 服务端返回 401，当前无法完成真实模型调用。工具集选择逻辑本身已在 `before_agent_start` 阶段完整验证，不依赖模型请求成功。需要重新配置：

```sh
pi auth login deepseek --api-key
```

## 7. 证据来源

- `~/.pi/agent/install/releases/1.5.1/node_modules/@earendil-works/pi-coding-agent/docs/{cli,settings,extensions,mcp,sdk}.md`
- `dist/core/sdk.d.ts`、`dist/core/agent-session.d.ts`
- 本地实测（2026-11-10）：`pi -p --no-session --offline ...` + `before_agent_start` 探针
