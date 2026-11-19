---
tags: [router-harness, architecture, pi-extension]
updated: 2026-11-17
---

# Router Harness

[索引](README.md) · [运行](router-harness-operations.md) · [接入](router-harness-workspace-integration.md) · [决策](router-harness-decisions.md)

## 任务与执行

Router 是 Pi extension，提供七项协调工具。Task 表示稳定委托；Run 表示一次检查，二者 ID 独立。`waiting_external` 表示等待发布，Run 失败仍可继续等待。`completed` 必须有当前目标版本的有效交付。

后端随 Pi 运行，不是常驻服务。`persistent.ts` 负责事务、调度和授权；`releases.ts` 负责固定匿名 HTTPS 读取；`notice.ts` 核对原 Pi 会话的持久收据；`mock.ts` 只产生合成任务。

## 七项工具

| 工具 | 输入 | 返回与约束 |
| --- | --- | --- |
| `router_dispatch` | `requestId`、`task`、可选 `contextRefs` | TaskSummary；同键同内容返回原任务，同键异内容冲突 |
| `router_list` | 状态、更新时间范围、cursor、limit | items、nextCursor；时间左闭右开，按 updatedAt/taskId 升序 |
| `router_inspect` | taskId | TaskDetail；执行、输入、取消、授权、动作及通知事实 |
| `router_collect` | taskId | taskStatus、acceptance、delivery、pending；可重复只读收取 |
| `router_queryContext` | query、可选 sessionId | 原文预览和可信引用，capability=substring |
| `router_cancel` | taskId | accepted、stopState、effects；先记录取消，再确认停止 |
| `router_sendInput` | taskId、message | 输入处理收据；应用时增加 goalVersion，旧交付标 stale |

所有调用使用 `Outcome={ok,mode,data/error}`。错误码和完整字段以 [backend.ts](../../examples/router/backend.ts) 为准。无 workId 别名或回传 `context.text` 接口。

## 发布与验收

- 只读 `https://api.github.com/repos/Xpectuer/pi-custom-harness/releases` 及同路径分页。
- 首次完整读取全部已有 ID 建立基线；失败不提交残缺基线。
- 之后过滤旧 ID、草稿与预发布。无变化时 Run completed、Task waiting_external。
- 当前有效交付含 id、tag_name、published_at、html_url、读取时间、源 API 和授权版本。
- 链接须属于本仓库 release，字段无效留下 blockers，不能仅因执行正常退出而通过验收。
- 正常检查间隔60秒，超时15秒；网络错误退避至15分钟，限流尊重服务端时间。

## 持久控制面

SQLite 使用 WAL、synchronous=FULL、外键与幂等唯一键。任务与通知同事务保存。列表在数据库中 keyset 分页，不把全部任务载入 extension。

私有目录0700、数据库0600。独立 `owner.sqlite` 的写事务持有后端所有权；第二进程被拒绝，退出后锁由 SQLite 释放。不能删除锁文件抢占。未知 schemaVersion 拒绝打开。

恢复将未结束 Run 标 interrupted；已确认安全的等待可继续。未知动作效果进入 blocked，不能盲重试。

## 通知

事件只带 taskId/runId/eventId 与目标会话，不包含交付正文。订阅只是唤醒提示，持久 Notice 是事实来源。

200ms 窗口合并显示，每条 Notice 独立记 Attempt。只有实际发送失败才增加 failureCount；第四次失败 exhausted，离线及重启不增加预算。原会话恢复时直接展示耗尽错误，不创建递归失败通知。

`sendMessage` 返回不代表送达；核对目标会话文件中的 eventId/attemptId 后才确认。崩溃或不完整文件保留 reconciliation_required，没有明确失败证据不新建尝试。

## 权限与上下文

后端绑定授权，不接收模型权限字段。每次 GET 前检查状态、目标版本、授权版本、期限与撤销事实。取消阻止后续准入，已发请求保留审计。

固定读取器运行在宿主，`isolation=host`、`profile=github-release-read`；无任意 worker、shell 或文件执行面。默认执行环境白名单为空，不读取宿主 token 或自动代理。

网络需要代理时，由可信启动配置显式提供 HTTPS_PROXY 白名单值；不跟随授权外重定向。代理不是执行者额外的读写权限。

上下文只收 referenceId/sourceVersion；后端从已注册源重取原文、检查版本及访问许可。网页和模型总结始终是数据。子串查询不宣称长期记忆。

## Pi 表面

入口关闭内置工具、MCP、其他 extension、skills 和模板。session_start/before_agent_start 设置七工具 active/selected，tool_call 拒绝其他调用。此守卫不是宿主沙箱。

达到上下文窗口50%后，在 agent_settled 时 compact；禁用 compaction、aborted 或用量未知时跳过。
