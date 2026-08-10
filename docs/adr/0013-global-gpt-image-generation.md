# ADR-0013：全局 GPT Image 2 配置与 Agent 生图工具

- 状态：已接受
- 日期：2026-08-10
- 关联：ADR-0007、ADR-0008、ADR-0010、ADR-0012
- Provider Catalog：`2`

## 背景

海报、品牌物料和复杂视觉设计经常需要原创位图素材。Conversation 的推理模型负责理解需求、规划结构和调用工具，不应同时充当隐式图片生成模型；否则切换会话模型会改变生图行为、成本和输出能力，也无法单独管理专业生图模型。

OpenAI 官方把单次 prompt 生图的直接入口定义为 Image API，并允许显式选择 `gpt-image-2`；生成端点是 `/v1/images/generations`，结果通过 `data[0].b64_json` 返回。当前实现据此只验收 GPT Image 2，不把尚未测试的模型描述为支持。[GPT Image 2 模型说明](https://developers.openai.com/api/docs/models/gpt-image-2)、[Image generation 指南](https://developers.openai.com/api/docs/guides/image-generation)。

## 决策

### 生图模型是应用全局配置

`ModelProviderCatalog v2` 在现有 Conversation 默认模型之外增加独立的 `defaultImageGenerationSelection`。两者没有覆盖或推导关系：

```text
Conversation ModelSelection ──► 对话推理 / tool calling

Global ImageGenerationSelection ──► configured image adapter / model
```

图片生成选择不进入 Project、Conversation journal 或 `AgentRequest.run.start`，也不能从当前会话模型推导。切换 Conversation 的 Provider、Model 或 reasoning effort 不会改变全局生图选择。旧 v1 Catalog 确定性迁移到 v2，所有旧模型增加 `imageGeneration: false`，不自动选择任何生图模型。

### 当前 adapter 以 GPT Image 2 验证，但模型 ID 可配置

Provider 显式配置图片生成 API format；当前可用 adapter 是 `openai-images`。用户可在该 Provider 下为任意模型 ID 声明 `imageGeneration` 能力，并从所有已启用 Provider 中选择一个全局默认。Main 使用该 Provider 的 Base URL、鉴权方式和 Main-only 凭据调用 `${baseUrl}/images/generations`，请求中的 model 完全来自 Catalog。当前请求支持 prompt、有资源上限的通用 size、`low | medium | high | auto` quality，以及 `png | jpeg | webp` output format；具体模型不接受的组合由 Provider 返回结构化失败，tool schema 不按模型名分支。

Main 对 HTTP、JSON、标准 base64、响应大小、解码后图片大小、超时和取消做边界校验。Provider 不可用、未配置受支持 adapter、凭据缺失或未配置全局选择时明确失败；不得回退到 Conversation 模型或发送未声明请求。使用同一 `openai-images` 协议的后续模型只改配置；不同协议通过新的窄 adapter 和兼容性测试加入，不改变 Agent 工具参数。

### Agent 通过 typed tool 生图

内置 Agent 注册 `opendesign_generate_image`。输入不包含 Provider/Model 字段，因此模型不能覆盖全局配置。成功结果先经现有 `AgentAttachmentHost.importImageBytes()` 写入内容寻址存储，再登记到当前 Run 的引用集合，返回安全 attachment metadata 和多模态引用；凭据和 base64 不进入 utilityProcess 或 Renderer。

生图本身不修改 DesignDocument。Agent 必须调用 `opendesign_place_image`，由 Main 把 attachment 转为 `DesignAsset + image node`，通过唯一 `EditorRuntime.apply(DesignTransaction)` 原子写入。放置被视为实质设计写入，继续执行“capture → refinement → capture”完成门禁，并可用一次 undo 同时撤销 asset 与节点。

## 验证与后续

- Catalog v1→v2 迁移证明不会静默启用图片生成。
- 设置页证明全局选择文案和 IPC 与 Conversation 选择分离。
- adapter 测试证明请求固定使用全局配置的 model ID 和 `/images/generations`，不存在模型名分支，且 tool input 不接受模型覆盖。
- 生成 attachment 只授权给当前 Run，放置继续复用现有 asset/image 事务。
- 真实 API 成本、输出视觉质量和 macOS/Windows Electron 完整流程仍需实机验证。
- 多轮图片编辑、参考图编辑、其他生图模型、每次调用的数据预览/审批与预算策略属于后续独立切片。
