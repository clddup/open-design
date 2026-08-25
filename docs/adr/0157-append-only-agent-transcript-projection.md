# ADR-0157：Agent 对话采用追加式事实与原位置过程折叠

- 状态：Accepted
- 日期：2026-08-25
- 扩展：ADR-0020、ADR-0090、ADR-0094

## 背景

OpenDesign 的 Conversation journal 已是 append-only，但此前 Session/Renderer 投影破坏了用户看到的时间顺序：同一 `run:<id>` 从 started 更新为 terminal 时保留开始 sequence，使结束错误回到消息顶部覆盖原位置；`session.history` 快照直接替换 Renderer 列表，较短快照可能让刚出现的消息消失；Run 内全部 reasoning 被搬到首个 reasoning 位置；同一终态根因又可同时显示为 `tool.failed` 和 `run.error`。

这不是视觉样式问题，而是 Transcript 事实模型错误。Codex、Cline、OpenHands 与 OpenCode 的公开实现都把用户/Assistant 消息、reasoning、tool block 和终态作为有稳定身份的事件或消息 part；流式更新只固化同一个尾部 block，过程折叠只影响展示，不改变历史顺序。

## 决策

### 事实与顺序

- Journal 继续是唯一 durable Conversation 事实，按 session sequence 追加。
- 用户消息和已完成 Assistant message 一旦出现，不得被后续状态替换、跨位置合并或重新排序。
- Run lifecycle 可以共享稳定 `runId`，但 terminal timeline item 使用 terminal journal event 的 sequence/updatedAt；结束结果按真实结束位置出现，不回写开始位置。
- Renderer 接收 `session.history` 时按稳定 `itemId`、`updatedAt` 与 sequence 单调合并。较旧或较短快照不能删除当前已知消息；较新的同身份 lifecycle/tool 状态可以前进。
- Live event 只更新其稳定 message/tool/run identity。Durable 完成项覆盖对应 live item，但不能覆盖无关消息或整份 Transcript。

### 原位置过程展示

- reasoning 保持在产生它的 Assistant message 附近，默认折叠；不再按整个 Run 聚合到首个位置。
- 只有相邻的非错误 tool activity 可以在展示层折叠。运行中默认展开，完成后默认收起；展开后保留每个工具项。
- 真实 semantic design step/revision、用户/Assistant 正文、审批与 terminal result 都不进入跨位置工具分组。
- 同一 Run、同一结构化 `failure code + message` 的 terminal `tool.failed` 与 `run.error` 只呈现一个终态；可恢复失败保留一个原位置 recovery record，不通过解析本地化文案去重。
- 活动 Run 状态是 Transcript 外的瞬时 status region；终态由 Transcript 中的单一结果承担，不能同时保留第二张重复终态状态卡。

## 后果

- 历史回读、流式切换和 Run 结束不会再让用户看到消息消失、前移或复制。
- 折叠降低长工具链噪声，但不删除事件，也不改变模型上下文、journal、诊断和审计。
- 现有预发布数据无需迁移；SessionStore 每次从原始 journal 重建 timeline 时会采用 terminal sequence。
- 若未来加入分页/远端同步，删除或截断必须成为显式 tombstone/range 协议，不能重新使用“整份快照覆盖本地列表”。

## 验证

- 使用生产 Run `run_1787645964248_1` 的事件形状覆盖 recoverable Plan failure、Assistant 修正正文、terminal tool failure 与 terminal Run failure。
- SessionStore 测试证明 terminal lifecycle 采用终态 sequence。
- Renderer 测试证明较短历史快照不删除新消息、终态更新可前进、正文/reasoning/tool/terminal 保持原始顺序、同一根因只显示一次。
- 组件测试证明连续工具默认折叠、可展开、运行中展开、错误不被藏入完成组。

## 参考

- [Codex TUI history cells](https://github.com/openai/codex/blob/main/codex-rs/tui/src/history_cell/messages.rs)
- [Codex TUI transcript consolidation events](https://github.com/openai/codex/blob/main/codex-rs/tui/src/app_event.rs)
- [Cline Webview message/tool block protocol](https://github.com/cline/cline/blob/main/apps/examples/vscode/src/webview-protocol.ts)
- [OpenHands EventStream architecture](https://github.com/OpenHands/OpenHands)
