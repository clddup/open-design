# ADR-0007：Main 托管模型 Provider 与凭据

- 状态：已接受
- 日期：2026-08-09
- 后续：凭据与 Main 托管边界继续有效；单 Provider / Chat Completions 产品模型已由 ADR-0008 取代

## 背景

OpenDesign 的内置 Agent 需要连接用户选择的模型 Provider，但 Renderer、Agent utility process、skills 与 MCP 都不得持有原始凭据或获得未代理的网络能力。设置页还需要在不回传密钥的前提下展示配置状态、保存设置并测试连接。模型调用具有不确定延迟，必须支持取消，且 Provider 特有响应不得泄漏到 Agent Runtime 的公共契约。

## 决策

模型 Provider 的配置、凭据和网络执行由 Electron Main 托管。Renderer 只通过类型化 preload API 进行以下操作：

- 读取脱敏设置：Provider、Base URL、模型标识、`hasApiKey` 与更新时间。
- 保存经过 Main 运行时校验的设置，或明确清除已有 API Key。
- 请求 Main 使用当前配置执行一次连接测试。

当前首个 adapter 是 OpenAI-compatible Chat Completions。Base URL 只接受 HTTPS，或用于本地 Provider 的 localhost HTTP；包含 URL 用户凭据、超长字段或额外属性的输入被拒绝。API Key 使用 Electron `safeStorage` 加密后存入 Main-only `WorkspaceStore`。Renderer 不接收 API Key 或加密文本。

Agent Runtime 继续依赖可替换的 `ModelGateway` 契约。utility process 中的 `ParentModelGateway` 生成关联 `requestId`，删除不可序列化的 `AbortSignal`，并通过内部 model bridge 请求 Main。Main 校验消息的结构、数量与大小上限，在请求执行期间持有 `AbortController`，解密凭据并调用 adapter，再返回 canonical model events。取消和进程退出会中止对应 Main 请求；重复 `requestId` 不得覆盖或提前终止原请求。

模型 bridge 是内部进程协议，不是 Renderer IPC、MCP 工具或设计事务入口。它不授予 Agent 凭据、任意 URL、任意网络调用、文件系统能力或设计写权限。模型输出仍需通过 future trusted typed design tools、Capability、Approval 与 `DesignTransaction` 才能改变画布。

## 结果

### 正面结果

- API Key 不进入 Renderer、Agent 消息、Project、会话日志或提示词。
- Provider 特有协议集中在 Main adapter，Agent Runtime 只消费 canonical events。
- 设置保存、连接测试、正式模型调用与取消复用同一份 Main 配置。
- 后续 Provider 可以在不改变设计文档或 Agent 事件契约的前提下增加 adapter。

### 代价与风险

- Main 承担模型网络请求与响应解析，需要限制负载、超时、取消和错误映射，避免长请求影响应用生命周期。
- 当前只支持 OpenAI-compatible Chat Completions；不得描述为多 Provider 已完成。
- 当前 utility process 仍继承完整 `process.env`，会话 JSONL 也仍由 Agent 直接写入用户目录。这些既有问题不被本 ADR 掩盖，仍需迁移为环境 allowlist 和 Main 托管持久化。
- 完整 Working Set、Mutation Targets、Capability、Approval 与外发数据预览尚未接入模型调用链。

## 验证

- 设置与 IPC guard 测试拒绝非法 URL、额外字段和返回凭据。
- Provider Host 测试确认只持久化密文，连接测试和正式请求在 Main 添加授权头，返回结果不含密钥。
- Parent model bridge 测试覆盖 canonical events、取消、重复请求与请求 ID 复用竞态。
- Renderer 测试覆盖保存、保存并测试、清除输入、错误反馈，以及切换语言不覆盖未保存模型草稿。

## 复审条件

增加 OpenAI Responses、Anthropic Messages、Provider 插件、代理设置或远程托管执行时，复审 adapter 放置、凭据生命周期、数据披露 UI、审计和取消语义。任何方案都不得把原始凭据下放给 Renderer、Agent、skill 或 MCP。
