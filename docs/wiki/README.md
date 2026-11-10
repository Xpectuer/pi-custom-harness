# pi-custom-harness 知识库

把上游素材编译为互链的 Markdown 页面，作为后续问答与决策的依据。raw 源只读；wiki 页面由 LLM 维护。约定见仓库根 `AGENTS.md` 与 `skill://structural-wiki`。

## 主题

- [Pi Durable harness 架构](durable-harness.md) — 定位、概念骨架、存储与执行环境、每会话 agent、多人视图
- [Durable 执行语义](durable-execution.md) — 提交先行、task 检查点、崩溃恢复、所有权树、压缩与错误规则
- [扩展、工具与 Code Mode](durable-extensions-and-tools.md) — extension/registry、system prompt sections、工具与嵌套调用、QuickJS 沙箱

## 源

- [Pi Durable 发布博客（2026-10-01）](sources/earendil-pi-durable-post.md) — 官方发布说明：动机、durability、并发、扩展与多人协作
- [pi-durable README（main 分支，2026-11-10 抓取）](sources/pi-durable-readme.md) — 规范级 API、恢复语义、存储后端与示例索引

## 概念

- [术语表](glossary.md) — harness、conversation、entry、task、submission 等术语的统一叫法

## 维护

- [知识库账本](log.md) — 入库、问答、体检的追加式时间线
