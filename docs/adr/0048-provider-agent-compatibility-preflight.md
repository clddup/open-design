# ADR-0048：Provider 的 Agent 工具兼容预检与推理可见性

- 状态：已接受
- 日期：2026-08-13
- 文档协议：不变（`DesignDocument 1.11.0`）
- Provider Catalog：不变（v3）
- 关联：ADR-0020、ADR-0030、ADR-0043

## 背景

“OpenAI compatible”通常只证明某个 HTTP 路径和普通文本响应可用，不保证参数化 function/tool calling、SSE 字段语义或 Responses API 可用。旧连接测试只要求模型回复 `OK`，因此会把只能聊天、把工具调用写成普通文本的端点显示为连接成功，真正失败延迟到设计执行阶段。

部分 Chat Completions 端点还逐 token 返回 `reasoning_content`、`reasoning` 或 `reasoning_text`。固定 Pi adapter 将这些字段统一映射为 thinking event；旧 canonical adapter 又把它们当作 Provider 明确提供的 `reasoning_summary`，导致原始长推理进入 Timeline 与 journal。这既不是摘要，也不是可信设计步骤。

## 决策

Provider 连接测试改为两阶段 Main-owned preflight：先进行无工具文本握手，再要求模型调用不产生副作用的 `opendesign_connection_probe`，并精确验证工具名、stop reason 以及三个必填参数。结果严格区分：

- `compatible`：文本与参数化工具调用都成功；
- `text-only`：文本成功，但工具调用缺失、退化成文本、参数错误或工具阶段失败；
- `unreachable`：文本阶段即失败。

每阶段独立受 30 秒 abort 上限约束；凭据仍只在 Main 解密，探针不执行任何设计事务。设置页只有 `compatible` 使用成功状态，`text-only` 明确提示“文本连接正常，但 Agent 工具调用不兼容”。新增自定义 Provider 默认使用覆盖面更广的 OpenAI Chat Completions；用户仍可明确切换 Responses 或 Anthropic。

OpenAI Chat Completions 的 thinking event 视为兼容端点原始推理字段，不发布 canonical `reasoning_summary`，不进入 Agent transcript、journal 或 Timeline；最终 usage 中的 reasoning token 计数继续保留。OpenAI Responses 和 Anthropic adapter 明确产生的有界 summary 语义继续按既有路径展示和持久化。

## 结果

- GLM 类仅实现 Chat 的端点不再因默认 Responses 配置失败，原始 `reasoning_content` 不再冒充“设计思考”。
- Grok 类文本可用但参数化工具不可靠的端点会在设置阶段暴露为 `text-only`，不再显示绿色成功。
- `ModelCapabilities.toolUse` 仍是配置声明，不是持久认证；preflight 是保存后即时诊断，不替代每次运行的 schema 校验、timeout、completion guard 或失败恢复。
- 以后若 Provider 能返回可验证的 Chat reasoning summary，需要增加明确的版本化字段来源和上限，不能重新把任意 raw reasoning 当摘要。

## 验证

- Chat SSE fixture 覆盖 `reasoning_content + tool_calls`：只保留工具调用和 reasoning usage。
- Provider Host 覆盖完整参数工具成功，以及文本成功但无 tool call 的 `text-only`。
- Preload guard 拒绝 status 与 `ok` 矛盾、额外字段或非法时延的结果。
- Settings 覆盖 Chat 默认值、Agent-compatible 成功文案与 text-only 错误态。
