# 知识库账本

[索引](README.md) · 追加式时间线。条目格式：`## [YYYY-MM-DD] <op> | <标题>`，可用 `grep "^## \[" log.md` 解析。

## [2026-11-10] ingest | Pi Durable 发布博客（2026-10-01）

- 源：https://earendil.com/posts/pi-durable/
- 新建：`sources/earendil-pi-durable-post.md`、`README.md`、`log.md`、`glossary.md`、`durable-harness.md`、`durable-execution.md`、`durable-extensions-and-tools.md`
- 摘要：首次建库；博客的定位、durability、并发 fork、扩展模型、所有权、compaction、多人协作要点并入三个主题页。

## [2026-11-10] ingest | pi-durable README（main 分支）

- 源：https://github.com/earendil-works/pi/blob/main/packages/durable/README.md
- 新建：`sources/pi-durable-readme.md`
- 更新：`README.md`、`durable-harness.md`、`durable-execution.md`、`durable-extensions-and-tools.md`、`glossary.md`
- 摘要：README 的 API 与语义细节并入架构、执行、扩展三页；登记与本地归档 commit `815541a14` 的一致性待验证。

## [2026-11-10] ingest | Router Harness 任务归档（INTENT / DISCUSS / SPEC / MVP）

- 源：`docs/archives/dev-router-harness-261110/{INTENT,DISCUSS-CHECKPOINT,SPEC,MVP}.md`、`checkpoint-input.json`
- 新建：`sources/router-harness-intent-20261110.md`、`sources/router-harness-discuss-20261110.md`、`sources/router-harness-spec-20261110.md`、`sources/router-harness-mvp-20261110.md`、`router-harness.md`、`router-harness-operations.md`、`router-harness-decisions.md`
- 更新：`README.md`、`glossary.md`、`log.md`
- 摘要：五项 `router_*` 能力、Outcome 契约、mock 生命周期、权限白名单、双 npx 入口与 AC-1 至 AC-11 证据并入三个主题页；A-S1/A-S2 保持 Pending，规格与实现的三个偏差标 Open。

### 批量入库报告

| 源 | 源页 | 新建/更新主题页 |
| --- | --- | --- |
| `INTENT.md`（v7） | `sources/router-harness-intent-20261110.md` | `router-harness.md`、`router-harness-decisions.md` |
| `DISCUSS-CHECKPOINT.md` / `checkpoint-input.json` | `sources/router-harness-discuss-20261110.md` | `router-harness-decisions.md` |
| `SPEC.md`（草案 v1） | `sources/router-harness-spec-20261110.md` | `router-harness.md`、`router-harness-operations.md`、`router-harness-decisions.md` |
| `MVP.md`（v6） | `sources/router-harness-mvp-20261110.md` | `router-harness-operations.md`、`router-harness-decisions.md` |

### 发现

- 矛盾（已成对标注）：SPEC 写“不在根目录增加 package.json”，交付为 npx 入口新增根 `package.json`；标 **Open**。
- 矛盾（已成对标注）：SPEC 的 Q-S1 写真实模型凭证不可用，MVP v6 记录凭证修复后 AC-1/3/7/9 通过；标 **Open**（SPEC 文本待更新）。
- 矛盾（已成对标注）：SPEC 称 AC 为待执行计划，MVP v6 提供执行记录；标 **Open**（SPEC 文本待更新）。
- 数据缺口：永久测试尚未补，下一步由 `/qa` 按 AC 建立。

## [2026-11-10] update | Router Harness 约束与凭证状态

- 根 `package.json`：用户取消“不在根目录增加”约束；根 `package.json` 仅用于 npx 入口，无依赖、无构建脚本。
- 凭证：真实模型使用开发者自己的 Pi 凭证，运行 `pi auth login <provider>`；凭证存 Pi 存储，不随 Git 提交。
- AC：SPEC v1 的“待执行计划”文本保留为历史；以 MVP v6 执行记录为准。
- 更新：`router-harness.md`、`router-harness-operations.md`、`router-harness-decisions.md`、`sources/router-harness-spec-20261110.md`、`sources/router-harness-mvp-20261110.md`、`../archives/dev-router-harness-261110/README.md`、`../../README.md`。

## [2026-11-10] update | Router worker 状态推送

- 契约：`RouterBackend.subscribe?(listener)` 推送 `WorkEvent`；事件只带 `eventId`、`workId`、状态、worker/session 与时间，结果仍由 `router_collect` 读取。
- 行为：`eventId` 去重、200ms 合并；`router_work_event` 自定义消息以 `triggerTurn` 唤醒模型；`session_start` 订阅、`session_shutdown` 清理；发送失败不影响工作状态。
- mock：新增 `complete()` / `fail()` 控制面与 `completeAfterMs`；`PI_ROUTER_MOCK_COMPLETE_MS` 在默认入口启用演示。
- 更新：`README.md`、`router-harness.md`、`router-harness-operations.md`、`router-harness-decisions.md`、`glossary.md`、仓库 `README.md`。
- 验证：`tsc --noEmit` 通过；扩展层冒烟覆盖去重/合并/生命周期/无 `subscribe` 适配器/发送异常；真实模型观察到 `router_work_event` 触发新 run 并调用 `router_collect`。
- Lint：15 页、0 断链；索引覆盖全部页面；source 页入链均 ≥6；frontmatter 完整。

## [2026-11-10] lint | Router wiki 通知更新后检查

- 范围：`docs/wiki` 15 页。
- 矛盾：1 项——`sources/router-harness-intent-20261110.md` 与 `sources/router-harness-mvp-20261110.md` 保留“本轮不要求主动通知”；已在 `router-harness-decisions.md#规格与实现偏差` 成对标注为 **Resolved**。
- 过期声明：0；孤儿页：0；缺失页：0；缺交叉引用：0；断链：0。
- 数据缺口：1 项——跨进程/跨主机送达未实现，已列入范围外与已知限制。
- 修正：`glossary.md` 将“状态推送”移到英文术语列表末尾；`README.md` 运行页摘要补状态推送证据。
