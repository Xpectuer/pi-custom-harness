---
tags:
  - router-harness
  - mvp
  - verification
sources:
  - ../../archives/dev-router-harness-261110/MVP.md
updated: 2026-11-10
---

# Router Harness MVP（v6）

[索引](../README.md) · 原文：[MVP.md](../../archives/dev-router-harness-261110/MVP.md) · 主题：[架构](../router-harness.md) · [运行与验收](../router-harness-operations.md) · [决策与边界](../router-harness-decisions.md)

## 概要

MVP v6 是交付与验收记录：五项 `router_*` 工具、进程内 mock 后端、双 npx 入口（npm 与 GitHub）均已可用。AC-1 至 AC-11 均有实际运行证据；其中 AC-1、AC-3、AC-7、AC-9 使用真实模型，其余为后端或扩展层冒烟。

## 提取要点

### 实现与入口

- 代码位于 `examples/router-agent.ts`、`examples/router/backend.ts`、`examples/router/mock.ts`；根 `package.json` 与 `bin/pi-router-harness.mjs` 提供 npx 入口 → [启动](../router-harness-operations.md#启动)
- npm `npx --yes pi-router-harness` 与 GitHub `npx --yes --allow-git=all github:Xpectuer/pi-custom-harness` 都固定加载同一 extension 并透传参数 → [启动](../router-harness-operations.md#启动)
- 公共仓库 `Xpectuer/pi-custom-harness` 与 npm `pi-router-harness@0.1.0` 已发布 → [发布](../router-harness-operations.md#发布)

### 验收证据

- AC-1：真实模型一次提问后调用 `router_list` 与 `router_collect`，答复含两项状态、完成结果与 mock 声明 → [验收证据](../router-harness-operations.md#验收证据)
- AC-2：RPC 两轮，active/selected 均恰为五项 → [验收证据](../router-harness-operations.md#验收证据)
- AC-3：真实模型被要求执行 Bash 时未调用工具；注入式守卫拒绝 bash/read/sentinel，执行计数为 0 → [权限边界](../router-harness.md#权限边界)
- AC-7：真实模型完成 queryContext → dispatch(context) → inspect，来源保留 → [验收证据](../router-harness-operations.md#验收证据)
- AC-9：含 `touch`/`mkdir` 的任务未产生文件或 workspace，未启动 worker → [mock 数据与生命周期](../router-harness.md#mock-数据与生命周期)
- AC-4/5/6/8/10/11 由后端与临时适配器冒烟覆盖 → [验收证据](../router-harness-operations.md#验收证据)

### 状态与限制

- Q-S1 已由用户提供并保存有效凭证后解决；SPEC 未改写，仍为草案 → **Open**：[规格与实现偏差](../router-harness-decisions.md#规格与实现偏差)
- A-S1、A-S2 仍是草案假设，待规格审查 → [SPEC 草案假设](../router-harness-decisions.md#spec-草案假设)
- 真实 worker、真实后端、持久化、主动通知、真实沙盒隔离与 R-8 workflow 均未实现 → [范围外](../router-harness-decisions.md#范围外)
- 本轮未新增永久测试套件；后续由 `/qa` 按 AC 补持久测试 → [已知限制](../router-harness-operations.md#已知限制)

## 要点落页

| 要点组 | 落入 |
| --- | --- |
| 实现、npx 入口、发布 | [运行与验收](../router-harness-operations.md) |
| AC 证据、权限、mock 行为 | [运行与验收](../router-harness-operations.md)、[架构](../router-harness.md) |
| Q-S1、A-S1/A-S2、范围与限制 | [决策与边界](../router-harness-decisions.md) |

## 链接

- 原文：[MVP.md](../../archives/dev-router-harness-261110/MVP.md) · 评审视图：[MVP.html](../../archives/dev-router-harness-261110/MVP.html)
- 相邻源：[INTENT](router-harness-intent-20261110.md) · [讨论检查点](router-harness-discuss-20261110.md) · [SPEC](router-harness-spec-20261110.md)
- 主题：[架构](../router-harness.md) · [运行与验收](../router-harness-operations.md) · [决策与边界](../router-harness-decisions.md) · [术语表](../glossary.md)
