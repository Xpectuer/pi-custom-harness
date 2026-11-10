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
