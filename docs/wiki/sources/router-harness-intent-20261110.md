---
tags:
  - router-harness
  - intent
sources:
  - ../../archives/dev-router-harness-261110/INTENT.md
updated: 2026-11-10
---

# Router Harness INTENT（v7）

[索引](../README.md) · 原文：[INTENT.md](../../archives/dev-router-harness-261110/INTENT.md) · 主题：[架构](../router-harness.md) · [运行与验收](../router-harness-operations.md) · [决策与边界](../router-harness-decisions.md)

## 概要

2026-11-10 批准的 v7 需求：用 custom Pi extension 做 router，管理 workers 与跨 session 上下文，减少用户切换 session 的负担。本轮只做接口与 mock，不做真实 worker 后端；范围 R-1 至 R-7，R-8 workflow 留待后续。

## 提取要点

### 目标与范围

- 用户只需问一次整体进展，router 查询各项工作、收取已完成结果并汇总，不要求用户提供逐项 ID 或搬运结果 → [核心路径](../router-harness.md#核心路径)、[AC-1](../router-harness-operations.md#验收证据)
- router 不直接读写文件或运行 Bash；worker 保留完整 Pi 默认能力与沙盒 workspace → [权限边界](../router-harness.md#权限边界)
- 本轮只模拟 worker 契约，不把 mock 描述成真实执行或隔离 → [mock 数据与生命周期](../router-harness.md#mock-数据与生命周期)
- R-8 workflow 定义与管理仍属范围外 → [范围外](../router-harness-decisions.md#范围外)

### 决策

- D-1：五项能力命名为 `dispatch`、`list`、`inspect`、`collect`、`queryContext` → [五项能力](../router-harness.md#五项能力)
- D-2：首要防范“router 能派活但用户仍要反复追问、辨认任务与搬运结果” → [已确认决策](../router-harness-decisions.md#已确认决策)
- D-3：采用 Pi extension、复用 Pi CLI；不采用 SDK 自建入口或独立 HTTP 后端 → [启动](../router-harness-operations.md#启动)
- D-4：按需统一汇总；本轮不要求主动通知 → [核心路径](../router-harness.md#核心路径)
- Q-1、Q-2 已确认；整份需求 v7 获批，可进入规格阶段 → [已确认决策](../router-harness-decisions.md#已确认决策)

### 约束与假设

- task、worker、session 的数量关系尚未固化为规则；接口字段、查询方式与状态转换留待规格定义 → [后端契约](../router-harness.md#后端契约)
- 内存 mock 重启后丢失状态；持久化未获批准 → [A-S1](../router-harness-decisions.md#spec-草案假设)
- 独立工作目录本身不证明沙盒隔离；真实隔离不属于本轮交付 → [权限边界](../router-harness.md#权限边界)

## 要点落页

| 要点组 | 落入 |
| --- | --- |
| 目标、核心路径、五项能力 | [架构](../router-harness.md) |
| R-1 至 R-7、AC 验收 | [运行与验收](../router-harness-operations.md) |
| D-1 至 D-4、Q-1/Q-2、范围与假设 | [决策与边界](../router-harness-decisions.md) |

## 链接

- 原文：[INTENT.md](../../archives/dev-router-harness-261110/INTENT.md) · 评审视图：[INTENT.html](../../archives/dev-router-harness-261110/INTENT.html)
- 相邻源：[讨论检查点](router-harness-discuss-20261110.md) · [SPEC](router-harness-spec-20261110.md) · [MVP](router-harness-mvp-20261110.md)
- 主题：[架构](../router-harness.md) · [运行与验收](../router-harness-operations.md) · [决策与边界](../router-harness-decisions.md) · [术语表](../glossary.md)
