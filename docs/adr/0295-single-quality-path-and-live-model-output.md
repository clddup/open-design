# ADR-0295：单一质量路径与实时模型输出

- 状态：Accepted
- 日期：2026-09-03
- 取代：ADR-0127 对新建设计 reasoning 强制降为 `minimal/low` 的决定，以及 ADR-0238 对 reasoning summary 整块缓存后再发布的决定
- 保留：ADR-0238 的空 block 暂存、工具参数原子发布、有界重连和失败后持续 Conversation 语义

## 背景

快速/精细模式把用户不应理解的内部编排暴露成产品选择，而且快速模式仍可能得到低质量首稿。删除选择器后，运行时若继续替用户降低 reasoning，用户在 Composer 中选择的模型配置仍不是真实请求配置。

Provider 流还把所有非文本 delta 一并缓存。工具参数必须完整后才能执行，但 Provider 明确返回的 `reasoning_summary` 是可展示的 Assistant 内容，不是工具参数。将它缓存到整个 block 完成，会造成模型已经持续输出、界面却数分钟只有宿主状态的假卡死。

## 决策

### 只有一条正常质量执行路径

`AgentRequest`、Renderer、Agent Runtime 和系统提示不再包含 generation mode。Composer 只保留 Provider、Model 与模型支持的 reasoning effort；Runtime 原样使用用户选择，不按新建或编辑任务强制降档。

所有正常 Agent Run 使用 interactive Provider watchdog。该 watchdog 约束无首响应和流中断，不改变 reasoning effort，也不以低质量首稿换速度。独立视觉 Critic 等宿主任务可以继续使用自己的有界 profile。

### Provider 内容按原顺序实时投影

Main 仍暂存空 `block.started`。出现第一个非空 delta 后：

- Assistant text 立即发布；
- Provider 明确提供的 `reasoning_summary` 立即发布，并在 Conversation 中默认折叠；
- tool call 的 start、参数 delta 和 completed 仍在参数完整后原子发布，半截参数不得进入 Agent 执行层。

一旦 text 或 reasoning summary 已经发布，当前 Provider turn 就形成用户可见语义，不再透明重放。失败时保留已到达内容，只结束当前 Run。

系统提示要求模型在第一个工具调用前给出简短、与请求相关的 Assistant text，但宿主不得伪造固定确认话术。Provider 未返回 reasoning summary 时，OpenDesign 不推断或展示隐藏思维链，只展示真实 Assistant text 与可信 Plan/tool 状态。

## 验证

- Agent 请求不接受或发送 generation mode；
- 用户选择 `medium/high` 等 reasoning effort 时，Provider 请求保持该值；
- reasoning summary 的首个非空 delta 在 Provider attempt 完成前到达 Renderer；
- reasoning summary 保持默认折叠，并与 Assistant text 按原 block 顺序显示；
- 未完成 tool call 仍不会提前发布或执行；
- 已发布内容后的 Provider 失败不重放当前 turn，下一条消息仍可继续同一 Conversation。
