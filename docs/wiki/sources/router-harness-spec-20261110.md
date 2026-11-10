---
tags:
  - router-harness
  - spec
sources:
  - ../../archives/dev-router-harness-261110/SPEC.md
updated: 2026-11-10
---

# Router Harness SPEC（草案 v1）

[索引](../README.md) · 原文：[SPEC.md](../../archives/dev-router-harness-261110/SPEC.md) · 主题：[架构](../router-harness.md) · [运行与验收](../router-harness-operations.md) · [决策与边界](../router-harness-decisions.md)

## 概要

SPEC v1 是草案，定义 R-1 至 R-7 的接口、11 条 AC、S-1 至 S-10 场景映射与 mock 边界。文中的 AC 是“待执行验收计划”，不是通过记录；本页只编译其设计，不把草案文字当作已验证事实。

## 提取要点

### 接口与数据

- 五项能力保持 D-1 命名；工具名加 `router_` 前缀，后端方法保留原名 → [五项能力](../router-harness.md#五项能力)
- 每次调用返回 `Outcome<T>`：成功含 `ok/mode/data`，失败含 `ok/mode/error`；错误码仅 `INVALID_ARGUMENT`、`NOT_FOUND`、`BACKEND_ERROR` → [后端契约](../router-harness.md#后端契约)
- mock 文本加“模拟结果，未执行真实工作”；工具 details 保存同一 Outcome；后端异常转 `BACKEND_ERROR` → [后端契约](../router-harness.md#后端契约)
- `task`、`workId`、`query`、`sessionId` 必须 trim 后非空；schema 不接受额外字段；非法 dispatch 不写入工作表 → [后端契约](../router-harness.md#后端契约)

### 验收计划

- AC-1 至 AC-11 覆盖一次汇总、工具集、负向执行、状态不变量、上下文、适配器、mock 标识、worker 契约与边界错误 → [验收证据](../router-harness-operations.md#验收证据)
- 验证方式包括真实 Pi CLI、RPC 生命周期探针、后端冒烟、临时适配器与副作用观察 → [验收证据](../router-harness-operations.md#验收证据)
- 持久测试只覆盖消费方可见的不变量、边界和状态；入口装配用临时冒烟 → [已知限制](../router-harness-operations.md#已知限制)

### 权限与生命周期

- 受支持启动命令只加载 router，禁用内置工具、MCP、Skill、提示词模板与其他扩展 → [权限边界](../router-harness.md#权限边界)
- `session_start`、`before_agent_start` 收紧 active/selected 到五项；`tool_call` 拒绝白名单外调用，包括嵌套调用 → [权限边界](../router-harness.md#权限边界)
- 该边界是模型工具权限，不是宿主进程沙盒；真实后端自行落实上下文授权与隔离 → [权限边界](../router-harness.md#权限边界)
- A-S1（mock 状态随实例重建）与 A-S2（三模块布局与入口注入）是草案假设 → [SPEC 草案假设](../router-harness-decisions.md#spec-草案假设)

### 风险与兼容性

- 风险包括模型不保证完整汇总、扩展重载丢状态、其他扩展/codemode 引入执行入口、mock 被误读为真实隔离、上下文恶意指令 → [风险](../router-harness-decisions.md#风险)
- 验收基线为 Pi 1.5.1、归档 commit `815541a`、Node >= 22.19.0、TypeBox 1.3.27 → [兼容性](../router-harness.md#兼容性)
- 草案原文写“不在根目录增加 package.json”；交付阶段为 npx 入口新增根 `package.json`，形成偏差 → **Open**：[规格与实现偏差](../router-harness-decisions.md#规格与实现偏差)

### 待决问题

- Q-S1 在 SPEC 写作时记录“真实模型凭证不可用”；MVP v6 记录用户提供凭证后真实模型 AC 通过 → **Open**：旧说法保留，新证据见 [规格与实现偏差](../router-harness-decisions.md#规格与实现偏差)
- A-S1、A-S2 仍为草案假设，需随规格审查确认 → [SPEC 草案假设](../router-harness-decisions.md#spec-草案假设)

## 要点落页

| 要点组 | 落入 |
| --- | --- |
| 五项接口、Outcome、类型、mock | [架构](../router-harness.md) |
| AC-1 至 AC-11、验证入口、持久测试边界 | [运行与验收](../router-harness-operations.md) |
| A-S1/A-S2、Q-S1、偏差、风险 | [决策与边界](../router-harness-decisions.md) |

## 链接

- 原文：[SPEC.md](../../archives/dev-router-harness-261110/SPEC.md) · 评审视图：[SPEC.html](../../archives/dev-router-harness-261110/SPEC.html)
- 相邻源：[INTENT](router-harness-intent-20261110.md) · [讨论检查点](router-harness-discuss-20261110.md) · [MVP](router-harness-mvp-20261110.md)
- 主题：[架构](../router-harness.md) · [运行与验收](../router-harness-operations.md) · [决策与边界](../router-harness-decisions.md) · [术语表](../glossary.md)
