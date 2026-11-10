---
tags:
  - router-harness
  - decisions
  - scope
  - risk
sources:
  - sources/router-harness-intent-20261110.md
  - sources/router-harness-discuss-20261110.md
  - sources/router-harness-spec-20261110.md
  - sources/router-harness-mvp-20261110.md
updated: 2026-11-10
---

# Router Harness 决策与边界

[索引](README.md) · 相关：[架构](router-harness.md) · [运行与验收](router-harness-operations.md) · [术语表](glossary.md)

## 已确认决策

- D-1：五项能力采用 `dispatch`、`list`、`inspect`、`collect`、`queryContext`；工具名加 `router_` 前缀 → [五项能力](router-harness.md#五项能力)
- D-2：首要失败风险是协调负担未下降——router 能派活，但用户仍要反复追问、辨认任务与搬运结果 → [核心路径](router-harness.md#核心路径)
- D-3：采用 Pi extension、复用 Pi CLI；SDK 自建入口与独立 HTTP 后端不采用 → [启动](router-harness-operations.md#启动)
- D-4：按需统一汇总；本轮不要求主动通知或后台轮询 → [核心路径](router-harness.md#核心路径)
- Q-1、Q-2 已解决；INTENT v7 批准 R-1 至 R-7、S-1 至 S-10 与 D-1 至 D-4，R-8 仍范围外 → [INTENT 源页](sources/router-harness-intent-20261110.md)
- 2026-11-10 用户确认：npx 交付允许在根目录新增 `package.json`，仅用于入口，无依赖、无构建脚本 → [规格偏差与解决](#规格与实现偏差)

## SPEC 草案假设

| 编号 | 假设 | 状态 | 依据与影响 |
| --- | --- | --- | --- |
| A-S1 | 内存 mock 随 extension 实例重建；跨 session 数据来自预置记录；workId 带实例标识 | **Pending** | 依据仅 mock 范围与 Pi 生命周期；实现已按此运行，仍需 SPEC 审查确认 |
| A-S2 | 三模块布局（入口、接口、mock）与入口注入足以隔离后端 | **Pending** | 已用独立适配器验证可替换（AC-8）；不新增注册框架，仍需 SPEC 审查 |

## 规格与实现偏差

SPEC v1 是历史草案；以下旧说法与新决定/证据成对保留，不静默删除，也不直接改写归档原文。

| 主题 | SPEC v1 旧说法 | 交付证据与决定 | 状态 |
| --- | --- | --- | --- |
| 根 `package.json` | “不在根目录增加 package.json” | 用户于 2026-11-10 取消该约束；根 `package.json` 仅用于 npx 入口，无依赖、无构建脚本，`AGENTS.md` 已记录 | **Resolved** |
| Q-S1 真实模型凭证 | 写作时记录“真实模型凭证不可用” | 原会话在用户提供并保存有效凭证后，AC-1/3/7/9 真实模型验收通过；凭证存 Pi 存储，不随 Git 提交 | **Resolved（环境相关）** |
| AC 状态 | “所有条目均为待执行验收计划，不是通过记录” | MVP v6 已执行 AC-1 至 AC-11 并提供证据；以 MVP 记录为准 | **Resolved** |

> 凭证提醒：每位开发者需自行运行 `pi auth login <provider>`，凭证由 Pi 凭证存储管理；不要提交 key、token、`.env` 或认证配置文件。

## 风险

| 类型 | 风险 | 处理 |
| --- | --- | --- |
| 模型 | 提示词不保证模型执行完整汇总 | AC-1 核对真实工具调用与最终答复，不以纯后端测试代替 |
| 生命周期 | extension 重载丢失内存状态 | A-S1 明示重置；旧消息不能证明当前工作仍存在 |
| 权限 | 其他扩展或 codemode 可引入执行入口 | 受支持入口禁用其他扩展；核对 active/selected 与执行守卫 |
| 契约 | mock 能力描述容易被理解为真实隔离 | 所有输出标 mock；`isolation=simulated`；AC-9/AC-10 检查反例 |
| 数据 | 上下文可携带恶意指令或敏感文本 | 当前只用合成记录；提示词视其为数据；真实数据授权属于接入方责任 |

## 范围外

- R-8 workflow 定义、依赖编排与管理。
- 真实 worker 执行、模型子代理、调度池。
- 真实上下文后端、读取真实历史 session、索引服务、持久化。
- SDK 自建 CLI、HTTP 服务、Web UI。
- 主动通知、后台轮询、自动重试、超时策略、生产规模 SLA。
- 真实目录分配、容器、micro-VM、沙盒隔离证明。
- 合并代码、删除 workspace、销毁 session。

## 下一步

- 后续 SPEC 修订可同步本次决定：根 `package.json` 允许、凭证环境化、AC 以 MVP 为准；A-S1/A-S2 仍需规格审查。
- 由 `/qa` 按 AC 补持久测试；当前只有临时冒烟证据。
- 升级 Pi 后重做 active/selected、执行守卫与生命周期验收。

## 来源

- [Router Harness INTENT（v7）](sources/router-harness-intent-20261110.md)
- [Router Harness 讨论检查点 CP-3](sources/router-harness-discuss-20261110.md)
- [Router Harness SPEC（草案 v1）](sources/router-harness-spec-20261110.md)
- [Router Harness MVP（v6）](sources/router-harness-mvp-20261110.md)
