---
tags: [router-harness, operations, verification]
updated: 2026-11-17
---

# Router Harness 运行与验收

[索引](README.md) · [架构](router-harness.md) · [接入](router-harness-workspace-integration.md) · [决策](router-harness-decisions.md)

## 启动

前置：Pi 1.5.1、Node >=22.19.0。当前功能未发布，使用本地工作树：

```sh
# 默认 mock
npx --yes .

# 真实匿名发布读取，数据目录默认 ~/.pi/router-harness/
npx --yes . --router-mode backend

# 固定原会话及可信目录；重启时重用这两个参数
npx --yes . --router-mode backend \
  --router-data-dir "$HOME/.pi/router-harness" --session-id <session-id>
```

本机直连曾返回 HTTP301，读取器拒绝跟随。需要代理时显式加 `--router-https-proxy http://127.0.0.1:7890`；不指定则直连。直接加载 extension 对应 `PI_ROUTER_HTTPS_PROXY`，不读取宿主 HTTPS_PROXY。代理 URL 不接受凭证。

直接加载 extension 时必须显式提供真实模式和目录：

```sh
PI_ROUTER_MODE=backend PI_ROUTER_DATA_DIR="$HOME/.pi/router-harness" \
pi --no-extensions -e ./examples/router-agent.ts \
  --no-builtin-tools --no-mcp --no-skills --no-prompt-templates \
  --tools router_dispatch,router_list,router_inspect,router_collect,router_queryContext,router_cancel,router_sendInput
```

模型凭证由 `pi auth login <provider>` 管理。发布读取器不用模型凭证或 GitHub token，不自动读取代理环境。缺配置、锁冲突或不支持库版本时真实模式报错，不回退 mock。

## 演示

| 操作 | 预期观察 |
| --- | --- |
| 委托“用稳定 requestId 监控本项目新正式 Release” | 返回 taskId；首次完整读取建立基线，Task waiting_external |
| 重发相同 requestId、task 和引用 | 返回原 taskId，不创建第二份初始工作 |
| 查询 taskId 的 inspect 与 collect | 执行历史、授权和通知可查；没有新发布时不报成功 |
| 关闭 Pi，以相同目录和原 session-id 重开 | 任务、基线与待通知事实保留 |
| 补充“继续检查本项目正式发布” | 输入 applied、goalVersion 增加，后续 Run 关联 inputId |
| 运行中取消 | 先 stop_requested，停止后显示 stopped/effects_unknown；不再准入新 GET |
| 实际出现基线外正式 Release | 四项发布证据、accepted 交付；原会话持久通知 |

mock 使用合成任务，不能证明真实发布或持久恢复。`PI_ROUTER_MOCK_COMPLETE_MS=3000 npx --yes .` 可演示合成状态完成提醒。

## 验证口径

在项目根运行 `npm test`，用临时 SQLite 和固定发布快照验证任务去重、基线恢复、草稿和预发布过滤、完成通知的重启对账。不需要 Pi 凭证、模型或网络。

当前任务的 SPEC/AC 与其他执行证据位于开发者本地 `docs/current/`。历史 [MVP](sources/router-harness-mvp-20261110.md) 的 AC 编号不适用于当前七工具契约。

重点核对：幂等响应丢失、同库重启、运行中取消、发送失败与恢复、无有效交付、四次预算耗尽、离线计数不变。真实窗口没有新发布时，AC-20 保持等待证据。

## 通知排障

| 状态或现象 | 处理 |
| --- | --- |
| pending | 恢复绑定原会话后投递；离线不计失败 |
| in_flight | 等待原会话记录；void 返回不算送达 |
| reconciliation_required | 恢复可读原会话以核对；无收据不自动重发、不扣预算 |
| exhausted | 查看 taskId/eventId/failureCount/lastError；原 Notice 不再自动发送 |
| 完成但没有正文提醒 | 通知只有定位信息；调用 router_collect |
| 关闭后没有持续监控 | 后端随 Pi 暂停，重新打开同库继续 |

## 其他失败

- `401`：修复 Pi 模型凭证，勿把密钥写入仓库或任务。
- `找不到 Pi CLI`：安装 Pi 或设置 PI_BIN，包装器退出127。
- 数据目录被占用：停止原后端后重试，不能删除 owner.sqlite 抢占。
- 发布读取失败：检查直连 GitHub 网络、限流及 Run 错误；已提交基线不清空。
- 工具集不是七项：使用上述完整入口，保留 --no-mcp 与 --no-extensions。
- 升级 Pi：重新核对 active/selected、守卫、会话切换和磁盘送达收据。
