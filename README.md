# pi-router-harness

Pi extension 的七工具任务入口。默认 mock；显式选择 backend 后，以本地 SQLite 保存任务，只读监控 `Xpectuer/pi-custom-harness` 的新正式 Release。

## 本地使用

前置：Pi 1.5.1、Node.js >=22.19.0。模型认证使用 `pi auth login <provider>`，不向发布读取器传递凭证。

```sh
# 合成演示，无网络执行
npx --yes .

# 真实读取，首次完整读取只建立基线
npx --yes . --router-mode backend

# 指定私有数据目录与原 Pi 会话；关闭后用相同参数恢复
npx --yes . --router-mode backend \
  --router-data-dir "$HOME/.pi/router-harness" --session-id <session-id>
```

需要代理时显式加 `--router-https-proxy http://127.0.0.1:7890`。默认不继承宿主代理；代理地址不支持凭证。

要求模型：“用稳定 requestId 监控本项目的新正式 Release；无变化继续等待”。保存第一次返回的 `taskId`；重试创建必须复用原 `requestId`。

## 行为

- 七工具：`router_dispatch`、`router_list`、`router_inspect`、`router_collect`、`router_queryContext`、`router_cancel`、`router_sendInput`。
- Task 身份跨检查与重启不变；每次检查有独立 Run。执行结束不等于验收通过。
- 首次读取全部发布 ID 为基线；仅之后新出现的正式 Release 可交付。草稿、预发布和旧版本不触发成功。
- Pi 关闭后暂停监控。恢复同库与原会话后继续；通知首次投递加三次重试，未知发送结果先核对持久记录。
- 默认数据目录 `~/.pi/router-harness/`；同目录只允许一个后端。模型不能指定目录、授权、凭证或可执行脚本。
- 读取器为 `isolation=host`，不是 OS 沙箱；仅匿名 GET 固定 GitHub releases API，不执行 shell，不访问发布 assets。
- 达到模型上下文窗口的50%后，在 Pi 的 `agent_settled` 时尝试 compact；沿用 Pi 的 compaction 配置。

## 文档

- [架构与接口](docs/wiki/router-harness.md)
- [运行与验收](docs/wiki/router-harness-operations.md)
- [后端接入](docs/wiki/router-harness-workspace-integration.md)
- [决策与边界](docs/wiki/router-harness-decisions.md)

## 分发

已发布 npm `pi-router-harness@0.2.0` 对应原有演示；当前工作树功能尚未发布。体验当前实现请使用本地入口。未执行发布或部署。
