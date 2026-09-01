# ADR-0043：有界 Provider 重连与完整 attempt 发布

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：不变（`DesignDocument 1.10.0`）
- Agent 协议：`3.8.0`
- 关联：ADR-0007、ADR-0008、ADR-0016、ADR-0030
- 部分取代：完整 attempt 缓冲决策已由 ADR-0238 的流式语义提交边界取代；watchdog、有界重连、取消与 retry lifecycle 继续有效

## 背景

反向代理或上游可以先返回 HTTP 200，再在 SSE response body 完整结束前关闭连接。Cockpit 只按 HTTP status 记录成功时，OpenDesign 仍可能从 Node/Undici 收到 `terminated`、`Connection error`，或看到流在没有 `attempt.completed/failed` 的情况下结束。HTTP 200 因此不能证明一个模型 turn 已完整交付。

直接重放已经向 Pi 公开的半截流会带来更严重的问题：文本重复、reasoning 混合、tool call 参数拼接，以及同一个设计工具被执行两次。只把最终错误改成“可重试”也不能解决当前 Run 被瞬时网络抖动终止的问题。

## 决策

### Main 拥有重连策略

`ModelProviderHost` 在首次请求失败后最多执行 5 次重连，固定退避为 400、900、1800、3200、5000 ms。退避和各次网络请求共享原 Provider turn 的 15 分钟总时限；每次请求重新应用首响应和流空闲 watchdog。用户取消会同时结束当前 iterator 和退避等待。

只有 canonical failure 明确标记 `retryable: true`，以及流没有 terminal event 就结束，才进入重连。用户取消、上下文超限、参数/鉴权等不可重试失败和 `provider_timeout` 不自动重连。后者继续保留 `first-response / stream-idle / total` 的精确诊断，避免在 5 次重连后才告诉用户一个确定性错误。

### 完整 attempt 才能进入 Agent

Main 为每次底层 Provider request 缓冲 `attempt.started`、text、reasoning summary 和 tool call 等 canonical 事件，直到收到 terminal：

- 成功时只发布一次逻辑 `attempt.started`、该次完整语义事件和 `attempt.completed`；
- 可重试失败时丢弃该次全部语义事件并关闭 iterator；
- 5 次重连耗尽时只发布最后一次逻辑 `attempt.started` 和 `attempt.failed`，不公开任何失败 attempt 的半截语义内容；
- 失败 attempt 的半截 tool call 永远不进入 Pi、Conversation journal 或设计工具执行层。

这保持一个 Pi Provider turn 对应一组完整语义结果，不建立第二份 transcript，也不允许重连绕开 Main 的凭据、附件、timeout 或取消边界。代价是该 turn 的 token 文本要在 terminal 后才公开；画布的可见设计过程继续由已校验事务、reveal、skeleton 和 cursor 提供，而不是依赖未完成 Provider token。

### transient 状态不是错误历史

canonical gateway 增加 `attempt.retrying { retry, maxRetries, delayMs }` 与 `attempt.recovered { retriesUsed, maxRetries }`。Agent 协议 3.8 投影为 `model.retrying/model.recovered`。Timeline 以稳定的 Run-scoped ID 覆盖同一条状态，显示“正在重新连接 N/5”；恢复后折叠为 routine，不生成红色失败卡或 durable assistant 内容。

只有最终失败继续产生结构化 `AgentRunFailure`、诊断和 Run error。`provider_error/provider_request_failed` 显示“模型连接已中断”，与 `provider_timeout` 的精确超时标题分流。

## 验证

- 首次 `terminated` 后恢复，只公开成功 attempt；
- 连续 5 次重连耗尽，失败 attempt 的半截 tool block 不被重复发布；
- HTTP/SSE 流无 terminal EOF 进入同一重连链路；
- retry lifecycle 可以出现在公开 `attempt.started` 之前，Pi adapter 不把它当协议错误或 assistant content；
- model bridge 严格限制 `retry 1..5 / maxRetries 5`；
- Timeline 只保留一条最新 `N/5` 状态，恢复后清除；
- 三类 watchdog timeout、不可重试失败和取消不进入自动重连。

## 后果与复审

短暂的反代/SSE body 中断不再立即终止完整设计 Run，Cockpit 的 HTTP 200 与客户端 terminal 事实也不再被混为一谈。重连不会重复执行画布工具，但文字的 token 级首屏时间会增加。

如果未来需要保留实时 token 体验，应新增显式 provisional UI stream：允许 Renderer 展示并在 retry 时撤回，但 durable journal、Pi 语义消息和 tool execution 仍必须等待 terminal。接入服务端 cursor/resume、多候选模型 fallback、熔断或跨 Run 自动恢复时，应替代本 ADR，而不是扩大固定重连循环。
