# ADR-0017：可信模型 Token 预算优先于本地字符保底

- 状态：已接受
- 日期：2026-08-10
- 关联：ADR-0016

## 背景

ADR-0016 同时使用可信 Model Profile 的输入 token 预算和固定 Conversation 字符上限。两种估算并列为硬门禁会产生矛盾：请求可以低于模型输入预算，却因为字符数超过固定阈值而在 Provider I/O 前被拒绝。该问题会随语言、工具 JSON 和图片元数据比例变化，并已在 Windows 生产诊断中复现。

## 决策

当 Main 已从所选 Model Profile 注入 `contextWindow` 与 `maxOutputTokens` 时，Agent Runtime 只使用包含 system、tool schema、消息、输出预留和安全预留的 token 预算决定请求是否可发送。Runtime 在 Run 开始和每个后续 Provider turn 前执行同一预算判断，工具结果增长会先触发 Run 内模型投影压缩。`maxContextCharacters` 仅在没有可信模型窗口元数据时作为离线或兼容路径的保底门禁。

字符数仍可用于诊断和压缩启发，但不得凌驾于可信 token 预算。Token 错误按 system、tool schemas、Conversation/tool results 和请求 framing 显示估算分账；字符错误只展示实际参与拒绝决策的字符限制，避免混入一个并未生效的门禁。

同一 Run 的防失控预算与每轮输入预算分开。`maxTurns` 和 `maxToolCalls` 继续限制循环结构，`maxGeneratedTokens` 累计 Provider `usage.output`；该字段已经包含 reasoning token，因此不再重复相加。每轮重复发送的 input/context 由上述 context window、compaction 和单轮门禁负责，不能在每次工具往返时再次累计进 Run 生成预算。否则一个始终低于模型窗口的合法长设计任务也会仅因重复上下文在 `reviewed → refined → verified` 途中稳定停止。

## 结果

- 低于模型输入预算的长请求不会被固定 `240000` 字符阈值误杀。
- 超过 token 预算的请求仍会在 Provider I/O 前压缩或明确失败。
- 诊断可以区分固定协议膨胀和 Conversation/tool result 膨胀，不再只显示一个无法定位来源的总数。
- 未提供 Model Profile 窗口的测试、离线和兼容路径仍受字符保底保护。
- 多轮设计只按实际生成量消耗 Run 生成预算；重复的有界 input 不再导致交付账本未完成时提前 `stopReason=budget`。

## 验证

- 单测以远低于测试字符上限、但低于可信 token 预算的请求证明 Provider 会被调用。
- 既有测试继续证明无模型窗口时字符保底会阻止超限请求。
- 单测证明可信 token 预算错误包含固定协议和 Conversation 分账，并证明第八个 Provider turn 可以在压缩后继续。
- Completion guard 集成测试使用两轮各 `180000` input token 的有界上下文，证明它们不会重复消耗 `maxGeneratedTokens`，而超出实际 output 上限仍产生 budget 终态。
