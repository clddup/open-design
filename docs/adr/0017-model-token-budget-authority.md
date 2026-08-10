# ADR-0017：可信模型 Token 预算优先于本地字符保底

- 状态：已接受
- 日期：2026-08-10
- 关联：ADR-0016

## 背景

ADR-0016 同时使用可信 Model Profile 的输入 token 预算和固定 Conversation 字符上限。两种估算并列为硬门禁会产生矛盾：请求可以低于模型输入预算，却因为字符数超过固定阈值而在 Provider I/O 前被拒绝。该问题会随语言、工具 JSON 和图片元数据比例变化，并已在 Windows 生产诊断中复现。

## 决策

当 Main 已从所选 Model Profile 注入 `contextWindow` 与 `maxOutputTokens` 时，Agent Runtime 只使用包含 system、tool schema、消息、输出预留和安全预留的 token 预算决定请求是否可发送。`maxContextCharacters` 仅在没有可信模型窗口元数据时作为离线或兼容路径的保底门禁。

字符数仍可用于诊断和压缩启发，但不得凌驾于可信 token 预算。错误消息只展示实际参与拒绝决策的预算，避免提示一个并未生效的字符限制。

## 结果

- 低于模型输入预算的长请求不会被固定 `240000` 字符阈值误杀。
- 超过 token 预算的请求仍会在 Provider I/O 前压缩或明确失败。
- 未提供 Model Profile 窗口的测试、离线和兼容路径仍受字符保底保护。

## 验证

- 单测以远低于测试字符上限、但低于可信 token 预算的请求证明 Provider 会被调用。
- 既有测试继续证明无模型窗口时字符保底会阻止超限请求。
