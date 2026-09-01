# ADR-0243：持续 Conversation 的附件授权边界

- 状态：Accepted
- 日期：2026-09-01
- 取代：ADR-0146 中“历史 attachmentId 不得进入后续 Run”的决策

## 背景

OpenDesign 的 Conversation 是持续 Agent 上下文，Run 只是一轮执行。此前模型上下文会恢复历史用户图片，但 Main 的 Reference Host 和 Design Plan 仍只授权当前 Run 附件；同时 Provider 只看到图片像素，看不到可供 typed tool 引用的 `attachmentId`。因此模型在下一轮能够理解旧图，却会在声明 `referenceStrategy`、放置图片或导入 SVG 时被宿主当作“另一 Run 的非法资源”拒绝。

## 决策

- 用户消息中的内容寻址附件元数据随 Conversation journal 持久保存；附件字节继续只由 Main 的 attachment store 持有。
- 新 Run 注册时，Main 从同一 Conversation 的 durable Timeline 恢复历史用户附件，与当前消息附件去重后，为该 Run 重新签发只读附件能力。Run 结束时仍回收本次能力映射。
- 同一 Conversation 的历史图片可以用于 `referenceStrategy`、图片读取/放置/编辑参考；历史 SVG 可以继续导入。另一 Conversation 的附件 ID 不获得授权。
- Provider 可见消息在图片或文档内容旁提供稳定 `attachmentId`、名称、MIME 与大小元数据，使模型能够生成合法 typed tool 输入；文件名和附件内容仍是不受信任数据。
- 已生成并进入 Design File 的图片继续优先通过稳定 `assetId` 跨 Run 操作。显式本地路径、URL、凭据和写目标不会因 Conversation 历史自动获得能力。
- 带 `runId` 的 `agent.error` 是当前 Run 的终止事实，Main 与 Renderer 必须立即释放 Conversation admission、Design File retention、Reference Host 和工具绑定；随后到达的 `run.completed` 只作幂等终态确认。Provider、工具、协议或取消失败不得要求用户新建 Conversation，也不得阻止下一条显式消息。

## 后果

Conversation 保持连续，安全边界从“同一 Run”调整为“同一 Conversation 只读附件能力 + 每 Run 重新签发”。这不会扩大 Design File 写入范围，也不会绕过 targetSet、revision、capability、approval 或文档 invariant。

## 验证

- 后续 Run 能从 durable Timeline 恢复同一 Conversation 的图片，并注册引用策略；当前消息中的问题截图可以继续默认忽略。
- Reference Host 可以在后续 Run 物化同一 Conversation 的历史图片；Run 结束仍释放授权。
- Provider 消息包含与图片相邻的稳定 `attachmentId` 元数据。
- Run 注册、仅收到 `agent.error` 时的失败释放、迟到 `run.completed` 的幂等清理和下一条显式消息回归测试继续通过。
