# Router Harness 任务归档

- 日期：2026-11-10
- 任务：Pi Router Agent 接口与 mock harness
- 状态：可体验，已发布
- GitHub：<https://github.com/Xpectuer/pi-custom-harness>
- npm：<https://www.npmjs.com/package/pi-router-harness>（`0.1.0`）

## 文件

| 文件 | 内容 |
| --- | --- |
| `INTENT.md` / `INTENT.html` | 需求意图与确认结论 |
| `DISCUSS-CHECKPOINT.md` / `.json` / `.html` | 讨论检查点 |
| `SPEC.md` / `SPEC.html` | 规格与验收条件（草案） |
| `MVP.md` / `MVP.html` | 实现、运行入口、验收结果与已知限制（v6） |
| `checkpoint-input.json` | 讨论输入快照 |

## 结论

- 五项 `router_*` 工具，默认进程内 mock 后端；真实模型通过 AC-1、AC-3、AC-7、AC-9。
- 双 npx 入口可用：`npx --yes pi-router-harness` 与 GitHub 入口。
- Q-S1 已由有效凭证解决；A-S1、A-S2 仍是 SPEC 草案假设，待规格审查。
