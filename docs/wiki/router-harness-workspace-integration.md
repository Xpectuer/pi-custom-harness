---
tags: [router-harness, integration]
updated: 2026-11-17
---

# Router Harness 后端接入

[索引](README.md) · [架构](router-harness.md) · [运行](router-harness-operations.md)

## 接入入口

`registerRouter(pi, backend)` 是唯一工具注册入口。实现 [RouterBackend](../../examples/router/backend.ts) 的七项协调方法及可信会话/通知方法，不另建平行协调 API。

内置真实后端已通过同一入口接入；启动命令：

```sh
npx --yes . --router-mode backend \
  --router-data-dir "$HOME/.pi/router-harness" --session-id <session-id>
```

可信配置由包装器转成 `PI_ROUTER_MODE`、`PI_ROUTER_DATA_DIR`。模型不能设置这些字段。默认 mock；真实模式打开失败直接报错，不回退。

## 身份、授权与原文

- ownerScope 来自可信后端配置，ownerSessionId 来自 Pi 会话。
- `dispatch` 先提交幂等任务，再异步启动检查；不要等待外部发布出现才返回。
- requestId 由调用方在第一次调用前保存；同范围内重试复用，不能每次使用新 toolCallId。
- contextRefs 只含 referenceId/sourceVersion。`registerContextSource` 是可信源注册入口，不注册为工具；撤销访问或修改版本后，旧引用不能继续取内容。
- 新目标或输入不扩大 readScopes/writeRoots/sendScopes。每次外部动作都独立核权。
- 不继承 `process.env`；固定读取器默认 env={}，不接收 GitHub token。
- 确需代理时，可信配置显式传 `env={HTTPS_PROXY: "http://127.0.0.1:7890"}`。不自动发现宿主代理，不接受带凭证的地址。

## 接收适配层

`bindSession` 只改变新任务和当前投递的会话绑定，不迁移旧任务目标。

| 方法 | 可信调用语义 |
| --- | --- |
| subscribe | 唤醒检查持久待投递箱，返回取消订阅函数 |
| pendingNotices | 查询原会话的 pending、未决和耗尽事实 |
| beginDelivery | 在线目标匹配且还有预算时创建独立 Attempt |
| settleDelivery | 实际失败计一次；未知不计次；已确认记录才送达 |
| reconcileDelivery | 用原会话持久 eventId/attemptId 收据补记 delivered |
| close | 停止计时器与在途 GET，释放数据目录所有权 |

会话切换前停止旧发送；不能将上一会话的待通知发送到新会话。恢复先核对旧 Attempt，再发送 pending。持久记录缺失不等于已发送失败。

## 扩展执行器的条件

当前执行器只支持本项目正式 Release 监控；不创建 workspace 或通用 Pi 子进程。

新增执行器必须提供自己的真实隔离和动作检查，不能把 worktree 当沙箱。Task/Run、goalVersion、取消、授权撤销、未知效果与验收契约都必须保留。工具说明必须与 backend.mode 的实际副作用一致。

受支持启动器、active/selected 白名单和 tool_call 守卫必须同步；不能通过增加一个转发工具绕开边界。

## 验证

依次验证同键重试、取消前后动作审计、旧目标晚返回、越权拒绝、可信原文、分页和接收预算。使用真实 Pi 会话验证通知落记录；内存发送器和 void 返回不能替代持久送达证据。具体执行记录见任务目录的 MVP.md。
