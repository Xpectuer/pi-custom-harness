---
tags:
  - router-harness
  - discussion
sources:
  - ../../archives/dev-router-harness-261110/DISCUSS-CHECKPOINT.md
  - ../../archives/dev-router-harness-261110/checkpoint-input.json
updated: 2026-11-10
---

# Router Harness 讨论检查点 CP-3

[索引](../README.md) · 原文：[DISCUSS-CHECKPOINT.md](../../archives/dev-router-harness-261110/DISCUSS-CHECKPOINT.md) · 主题：[架构](../router-harness.md) · [决策与边界](../router-harness-decisions.md)

## 概要

CP-3 是讨论阶段的检查点快照：已确认五项能力命名、Pi extension 入口与按需统一汇总；检查点时整份 v6 尚未批准。随后用户批准 INTENT v6，并按批准事件登记为 v7。

## 提取要点

### 检查点状态

- 检查点时记录“整份 v6 尚未批准，不能直接进入 /to-spec”；后续 INTENT v7 已批准，故该状态是历史快照 → **Open**：旧说法保留在此，新结论见 [已确认决策](../router-harness-decisions.md#已确认决策)
- 本轮讨论已结束，用户选择 `finish`；检查点本身不批准需求 → [决策与边界](../router-harness-decisions.md#已确认决策)

### 已知的已知

- 用户问一次，router 查询各项状态并汇总已完成结果 → [核心路径](../router-harness.md#核心路径)
- 用户无需逐项提供 ID、切换 session 或复制结果；本轮不要求主动通知 → [核心路径](../router-harness.md#核心路径)
- Pi extension 入口（D-3）与五项能力命名（D-1）已确认 → [启动](../router-harness-operations.md#启动)、[五项能力](../router-harness.md#五项能力)

### 已知的未知与盲区

- 具体接口字段、状态与错误语义留待规格阶段；内存 mock 仍属技术建议 → [后端契约](../router-harness.md#后端契约)
- 真实后端接入可能出现 mock 未覆盖的协作摩擦；讨论结论不能当作运行证据 → [风险](../router-harness-decisions.md#风险)

## 要点落页

| 要点组 | 落入 |
| --- | --- |
| 检查点历史状态与后续批准 | [决策与边界](../router-harness-decisions.md) |
| 目标、通知边界、协调验收 | [架构](../router-harness.md) |
| 接口待定与真实后端盲区 | [架构](../router-harness.md)、[决策](../router-harness-decisions.md) |

## 链接

- 原文：[DISCUSS-CHECKPOINT.md](../../archives/dev-router-harness-261110/DISCUSS-CHECKPOINT.md) · 快照：[checkpoint-input.json](../../archives/dev-router-harness-261110/checkpoint-input.json)
- 相邻源：[INTENT](router-harness-intent-20261110.md) · [SPEC](router-harness-spec-20261110.md) · [MVP](router-harness-mvp-20261110.md)
- 主题：[架构](../router-harness.md) · [决策与边界](../router-harness-decisions.md) · [术语表](../glossary.md)
