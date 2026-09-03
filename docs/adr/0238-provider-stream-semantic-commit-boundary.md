# ADR-0238：Provider 流式可见性与语义提交边界

- 状态：Accepted
- 部分取代：ADR-0295 将 Provider 明确返回的非空 reasoning summary delta 改为实时发布；工具参数仍保持完整后原子发布
- 日期：2026-08-31
- 取代：ADR-0043 的“完整 attempt 才能进入 Agent”决策，以及 ADR-0047 对错误终态自动创建 continuation Run 的决策
- 保留：ADR-0043 的 Main-owned watchdog、有界重连、取消与 retry lifecycle

## 背景

ADR-0043 通过把整个 Provider attempt 缓冲到 terminal，保证重连不会重复文字或执行半截工具。但它也让已经持续返回文本的模型在数分钟内对用户完全不可见，直接恶化首字体验。实际故障还表明，部分 Provider 会先发出空的 reasoning/tool block start，随后连接中断；把 block start 当成已发布语义会过早关闭安全重连。

OpenDesign 是持续 Conversation Agent，不是一次性请求。单个 Run 的网络失败必须有明确边界：不能重放已经展示的语义，也不能让失败 Run 污染同一 Conversation 的下一次 Run。

## 决策

### block start 不构成语义提交

Main 暂存 `block.started`。空 delta 不发布，也不计入首个内容时间。只有出现真实内容或完整 block 时，才提交对应 start：

- 非空 text delta 立即发布，并从此禁止自动重放当前 Provider turn；
- reasoning summary 在完整 block 到达后原子发布；
- tool call 的 start、参数 delta 与 completed 在工具参数完整后原子发布，半截参数永远不进入 Pi 或执行层。

因此，只打开空 reasoning/tool block 后发生的 `terminated`、提前 EOF 或其他 retryable 连接失败仍可安全进入 ADR-0043 的有界重连。

### 已发布文本不撤回、不重放

一旦非空 text delta 已进入 Pi 和 Renderer，该 attempt 就成为当前 Run 的语义事实。随后连接失败时：

- 不自动重试同一 Provider turn，避免重复文本和上下文分叉；
- 已显示的 partial assistant text 写入 Conversation journal 并保持原消息位置；
- 失败的 Provider response identity 不写入该 assistant message，也不进入下一 Run 的模型上下文；
- 当前 Run 产生结构化失败终态并释放其运行 lease。

`message.completed` 的空 block 只表示流式消息结束，不得删除此前已显示的 delta。Renderer 仅在同 message 的 durable journal item 到达后去重 live 副本，不能因为 Run 已终止就先删除消息。

### Conversation 与 Run 生命周期分离

Conversation 持久保存用户消息、用户附件元数据、真实 assistant 内容、工具历史和已提交设计 revision。Run 只是一轮执行尝试。`error / cancelled / terminated` 只结束当前 Run；同一 Conversation 的下一条用户消息创建新的 Run，从 durable journal 和当前 Design File revision 恢复，不复用失败 response、半截 tool call 或旧 activeRun 锁。同一 Conversation 的历史用户附件由 Main 在新 Run 重新签发只读能力，不要求用户重新上传，也不扩展 Design File 写目标；详见 ADR-0243。Provider 层的有界重连已经处理可安全重放的连接故障；一旦整个 Run 进入错误终态，Main 不再自动创建 continuation Run，避免连续失败长期占用 Composer。正常完成但交付未完成或单 Run budget 用尽时，ADR-0047 的有界自动 continuation 仍保留。

## 验证

- 空 reasoning/tool start 后连接中断可以透明重连，失败 attempt 不发布半截 block；
- 非空 text delta 继续实时可见，随后失败时不重放同一 turn；
- partial assistant text 持久化且不携带失败 `responseId`；
- 空 `message.completed` 不覆盖已有 live text；durable item 到达后只去重副本；
- 同一 Conversation 的下一 Run 可以正常启动，并读取前序用户消息、partial assistant 内容和当前设计状态；
- 错误 terminal 不自动排队下一 Run，也不保留 Conversation busy lease；
- 用户取消、不可重试失败和三类 watchdog timeout 继续遵循既有终态语义。

## 后果与复审

该决策优先保证真实首字反馈、工具原子性和连续 Conversation。代价是文本已经公开后发生连接中断时，当前 Run 不能透明重放；恢复通过下一 Run 完成，而不是撤回用户已经看到的内容。

如果 Provider 未来提供可验证的 server-side cursor/resume，可以单独评估从最后确认位置继续文本流。不得用客户端字符串拼接或猜测 token 边界实现重放。
