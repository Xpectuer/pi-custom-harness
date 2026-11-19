---
tags: [router-harness, decisions, scope]
updated: 2026-11-17
---

# Router Harness 决策与边界

[索引](README.md) · [架构](router-harness.md) · [运行](router-harness-operations.md)

## 采用的边界

| 决定 | 理由 |
| --- | --- |
| 复用 Pi extension 与七项协调工具 | 保留 CLI、工具守卫及 registerRouter 注入点 |
| Task 与 Run 独立 | 等待、恢复及一次检查失败不改变委托身份 |
| SQLite 本地状态层 | 事务表达幂等、动作准入、任务与待通知同提交 |
| 后端随 Pi 暂停 | 不引入守护进程或部署；恢复同库和原会话继续 |
| 固定 GitHub Release 读取器 | 只读授权可由代码边界执行，不依赖提示词约束任意 shell |
| 首次全部 ID 建基线 | 排除已存在版本，不依赖 tag 排序或本地时钟 |
| 四次实际失败后耗尽 | 对应首次投递加三次重试；离线、重启不补充预算 |
| 持久会话收据确认 | Pi 消息 API 的 void 返回和内存去重不能证明送达 |
| 发送未知先核对 | 避免崩溃后盲目重发；没有失败证据不扣预算 |
| 可信上下文引用 | 模型预览不能替代原文或成为授权 |

## 风险与处理

- GitHub 限流或断网：保存基线与失败 Run，退避后继续检查。
- 验收窗口没有新正式 Release：继续等待；AC-20 不能拿合成发布代替。
- 在途 GET 取消：停止新准入，保留可能已被 GitHub 接收的动作事实。
- 原会话不可读或发送结果未知：保留 reconciliation_required，详情显示阻碍。
- 通知耗尽：保留 failureCount/lastError，恢复时直接显示错误，不重新发送原 Notice。
- 数据目录争用：拒绝第二持有者；不删锁文件、不无锁降级。
- host 读取器：不是 OS 沙箱；未来通用执行器需重新设计隔离。

## 范围外

任意 shell、通用 worker 池、复杂 workflow、多 Agent 平台、向量记忆、外部消息渠道、离线持续服务、发布创建、文件产物执行与部署。

历史演示记录位于 [归档](../archives/dev-router-harness-261110/README.md)。当前接口和运行事实以源码与运行文档为准。
