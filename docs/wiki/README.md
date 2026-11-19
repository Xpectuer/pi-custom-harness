# pi-custom-harness 知识库

把上游素材与任务归档编译为互链的 Markdown 页面，作为后续问答与决策的依据。raw 源只读；wiki 页面由 LLM 维护。约定见仓库根 `AGENTS.md` 与 `skill://structural-wiki`。

## 主题

- [Pi Durable harness 架构](durable-harness.md) — 定位、概念骨架、存储与执行环境、每会话 agent、多人视图
- [Durable 执行语义](durable-execution.md) — 提交先行、task 检查点、崩溃恢复、所有权树、压缩与错误规则
- [扩展、工具与 Code Mode](durable-extensions-and-tools.md) — extension/registry、system prompt sections、工具与嵌套调用、QuickJS 沙箱
- [Router Harness](router-harness.md) — 七工具、Task/Run、授权、SQLite、发布基线与持久通知
- [Router Harness 运行与验收](router-harness-operations.md) — 本地 mock/backend 启动、恢复、取消与排障
- [Router Harness 决策与边界](router-harness-decisions.md) — 固定读取器、有限重试、持久收据与风险
- [Router Harness 后端接入](router-harness-workspace-integration.md) — 同一 RouterBackend 注入、可信原文与接收控制面

## 源

- [Pi Durable 发布博客（2026-10-01）](sources/earendil-pi-durable-post.md) — 官方发布说明：动机、durability、并发、扩展与多人协作
- [pi-durable README（main 分支，2026-11-10 抓取）](sources/pi-durable-readme.md) — 规范级 API、恢复语义、存储后端与示例索引
- [Router Harness INTENT（v7）](sources/router-harness-intent-20261110.md) — 目标、R-1 至 R-7、D-1 至 D-4 与授权记录
- [Router Harness 讨论检查点 CP-3](sources/router-harness-discuss-20261110.md) — 讨论快照、已知/未知与 finish 选择
- [Router Harness SPEC（草案 v1）](sources/router-harness-spec-20261110.md) — 接口、AC-1 至 AC-11、权限与风险
- [Router Harness MVP（v6）](sources/router-harness-mvp-20261110.md) — 实现、双 npx 入口、真实验收与限制

原始任务归档：[docs/archives/dev-router-harness-261110](../archives/dev-router-harness-261110/README.md)

## 概念

- [术语表](glossary.md) — Pi Durable 与 Router Harness 术语的统一叫法

## 维护

- [知识库账本](log.md) — 入库、问答、体检的追加式时间线
