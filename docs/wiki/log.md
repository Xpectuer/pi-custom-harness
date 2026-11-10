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
