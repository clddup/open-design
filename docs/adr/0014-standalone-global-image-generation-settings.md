# ADR-0014：独立的应用级图片生成配置

- 状态：已接受
- 日期：2026-08-10
- 关联：ADR-0007、ADR-0008、ADR-0010、ADR-0013
- Provider Catalog：`3`
- 图片生成配置：`GlobalImageGenerationSettings 1`

## 背景

ADR-0013 已经确认图片生成不受 Conversation 模型选择影响，但首版实现仍把图片生成 API、能力声明和全局选择放进 `ModelProviderCatalog v2`。这造成了错误的产品归属：用户必须先编辑一个对话 Provider，才能配置本应独立的图片生成服务；同一份 Provider 凭据还会同时承担对话与生图职责。

应用级独立不只是 UI 分组。配置、凭据、持久化版本、IPC、Host、运行时解析和失败行为都必须与 Conversation Provider 分离，否则换一个设置入口仍然只是表面迁移。

## 决策

### 两套配置拥有不同职责

```text
ModelProviderCatalog v3
  └─ Conversation Provider / Model / reasoning / toolUse / imageInput

GlobalImageGenerationSettings v1
  └─ enabled / apiFormat / baseUrl / authMode / API Key / modelId
```

`ModelProviderCatalog v3` 只管理对话推理模型。Provider 不再包含图片生成 API，模型 capability 不再包含 `imageGeneration`，Catalog 不再包含全局生图选择。

`GlobalImageGenerationSettings v1` 是应用级单例配置，保存独立启用状态、API adapter、Base URL、鉴权方式、独立凭据和用户填写的模型 ID。设置页把它放在与“模型”并列的顶级“图片生成”页，不在 Provider 编辑器、模型行或 Conversation composer 中提供选择。

### Agent 只读取独立配置

`opendesign_generate_image` 的参数不包含 Provider、模型、Base URL 或凭据。Main-owned `ImageGenerationHost` 在每次调用时读取独立设置，只有启用且配置完整时才执行；Conversation 的 Provider、Model、reasoning effort、默认模型或凭据都不能覆盖、补全或回退生图配置。

当前 `apiFormat` 只实现 `openai-images` adapter，并用 GPT Image 2 完成首个协议验证；模型 ID 由用户配置，`gpt-image-2` 只作为设置页提示示例，不是默认值或运行时分支。以后增加其他服务时扩展版本化 `apiFormat` 联合类型、对应窄 adapter 和兼容性测试，不改变 Agent tool 参数，也不把配置重新并入 Conversation Provider。

### 凭据与跨进程边界独立

图片生成凭据使用独立的 Main-only `safeStorage` 密文槽。Renderer 只能读取 `hasApiKey`，Agent utilityProcess 不接收明文、密文或任意网络入口。保存设置通过独立、类型化且运行时校验的 IPC；Provider 保存、删除或切换默认模型不会修改图片生成设置，图片生成设置也不会修改 Provider Catalog。

`ImageGenerationHost` 独立执行请求、10 分钟超时、取消、响应大小和 base64 校验。失败返回工具失败，不得静默尝试 Conversation Provider。

### 确定性迁移

启动时先迁移旧 `ModelProviderCatalog v2` 中的 `defaultImageGenerationSelection`：只有旧选择、Provider、adapter 和模型 capability 全部有效时，才创建启用的 `GlobalImageGenerationSettings v1`，并复制该 Provider 的加密凭据到独立槽。随后 Provider Catalog 升级到 v3 并剥离所有生图字段。

没有合法旧选择时，独立生图配置保持禁用、模型 ID 为空，不因存在某个 Provider 或名为 GPT Image 的模型而自动启用。迁移完成后运行时只读取新配置；旧 v2 字段不再是事实来源。

## 验证与后续

- 设置页测试证明“模型”页不存在生图 API 或全局生图勾选，“图片生成”顶级页独立保存配置。
- API guard 测试证明 Provider Catalog v3 拒绝生图字段，独立设置不接受 Provider 选择或返回凭据。
- Host 测试证明请求只使用独立 Base URL、鉴权、凭据和用户模型 ID，不借用 Conversation Provider。
- v2 迁移测试证明旧配置和密文可转移，Provider Catalog v3 只保留对话能力。
- 真实 GPT Image 2、macOS/Windows `safeStorage`、代理 Base URL 和错误恢复仍需 Electron 实机验证。
- 其他图片生成协议、参考图编辑、多轮编辑、供应商连接测试、预算和审批策略按独立 adapter 切片加入。
