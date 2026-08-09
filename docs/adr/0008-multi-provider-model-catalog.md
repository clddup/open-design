# ADR-0008：多 Provider Catalog、协议 Adapter 与会话模型选择

- 状态：已接受
- 日期：2026-08-09
- 取代：ADR-0007 中“当前单一 OpenAI-compatible Chat Completions 设置模型”的产品决策；ADR-0007 的 Main 凭据边界继续有效

## 背景

单个 `openai-compatible` 字符串无法表达 Responses、Chat Completions 与 Anthropic Messages 的请求结构、流事件、工具调用、鉴权和推理参数差异。让 Main 用隐藏的全局模型覆盖 Agent 请求，也无法支持成熟 Agent 必需的多 Provider、多模型和会话级选择。

仓库已固定依赖 MIT 许可的 `@earendil-works/pi-ai` 0.84.1。继续手写一个非流式 Chat adapter 会重复实现成熟协议代码，并让现有依赖失去意义。

## 决策

1. 引入版本化 `ModelProviderCatalog v1`。Provider profile 使用稳定 `providerId`，包含名称、启用状态、API 格式、鉴权方式、Base URL、模型列表和脱敏凭据状态。
2. 首期支持三个明确且不可静默互换的 API 格式：
   - `openai-responses` → `/responses`
   - `openai-chat-completions` → `/chat/completions`
   - `anthropic-messages` → `/v1/messages`
3. `@earendil-works/pi-ai` 提供低层流式协议 adapter 和跨 Provider 消息转换；OpenDesign 继续拥有 canonical model events、Agent loop、持久化、权限与设计事务。
4. API Key 按 `providerId` 分别使用 `safeStorage` 加密。Catalog 只持久化 `hasApiKey: false` 的脱敏 profile；读取时由 Main 合成实际布尔状态。删除 Provider 同时删除其凭据。
5. `AgentRequest` 升级到 3.0。`run.start` 必须携带 `ModelSelection`，Main 只执行被选中且已启用、存在并支持 tool use 的模型，不再替换为隐藏全局默认值。
6. Run journal 保存模型选择；Provider 响应身份随 assistant message 保存，使后续切换 Provider 时可以转换历史消息、tool call 和 reasoning summary。
7. 设置页使用 OpenDesign 自有桌面视觉，提供 Provider 列表与详情、API 格式、鉴权、模型能力和独立连接测试。Agent composer 直接选择 `Provider/Model` 和模型支持的推理档位。
8. 全局 Catalog、项目索引、Conversation、Global Task 和偏好保存在 `~/.opendesign/workspace.sqlite`；Project 设计正文继续位于用户绑定目录。旧 `app.getPath("userData")/workspace.sqlite` 在新库不存在时复制迁移，原库保留。

## 失败语义

- Provider 被禁用、模型不存在、模型不支持 tool use 或 reasoning 档位不匹配时，在发起网络请求前失败。
- API 格式决定唯一 adapter；一种协议失败不会自动改用另一协议。
- 取消继续由 Main 的 `AbortController` 关联 model bridge `requestId`；Provider 流解析失败映射为 canonical `attempt.failed`。
- Catalog 或跨进程对象包含额外属性、凭据、非法 URL、重复 Provider/Model ID 或超限内容时，在边界处拒绝。

## 结果

OpenDesign 获得可扩展的成熟模型接入基线，同时维持 Renderer/Agent 无凭据、Main 托管网络、模型输出不授权设计写入的既有边界。新增协议不需要改变画布事实状态，但新增模型能力或鉴权类型仍需扩展 Catalog 版本、迁移和负面测试。当前 `AgentRequest 3.2` 在本决策基础上继续加入安全附件元数据，不改变 Provider Catalog 与 Main 凭据边界。
