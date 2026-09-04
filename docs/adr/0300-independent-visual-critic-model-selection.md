# ADR-0300：独立视觉 Critic 模型选择

- 状态：Accepted
- 日期：2026-09-04
- DesignDocument：不变
- 关联：ADR-0117、ADR-0127、ADR-0181

## 背景

ADR-0117 已将视觉 Critic 隔离为无作者上下文的 stateless Provider 请求，但仍复用作者 Run 的模型。请求隔离可以避免作者会话污染，却不能避免同一模型对自身生成偏好的系统性自我认同，也无法让用户把生成速度与视觉判断能力分别配置。

Critic 配置不应复制 Provider、API Key 或连接设置，也不能让 Renderer 决定最终调用身份。失效配置若继续残留，会把一次正常 capture 变成不可恢复的模型选择错误。

## 决策

`ModelProviderCatalog` 可选保存一项 `visualCriticSelection`：

- 选择只能指向已启用且同时支持 image input 与 Agent tool use 的现有模型；未配置时回退当前 Run 的作者模型。
- 设置页只展示符合能力要求的模型，并提供“跟随当前会话模型”；不复制 Provider 和凭据，不新增另一套连接配置。
- Renderer 只能通过类型化 IPC 保存选择。Main 在 exact-revision capture 开始独立 Critic 前解析选择，实际凭据继续只由 `ModelProviderHost` 获取。
- Provider 被删除、禁用、移除目标模型、撤销图片或工具能力、或移除所选 reasoning effort 时，Catalog 规范化必须清除失效选择，不建立兼容悬挂引用。
- Catalog、保存请求、Main IPC 和 Preload 使用同一可执行结构契约；能力和引用关系只在 Provider configuration domain refinement 中定义。

## 后果

- 作者模型与视觉审核模型可以独立选择，Critic 的 scorecard、账本、截图和失败语义保持不变。
- 未配置独立模型的现有用户行为不变；配置失效时安全回退作者模型，不阻塞后续 Conversation Run。
- 本决策只改善审核独立性，不宣称已经提升作者首稿质量，也不替代固定样张人工盲评。

## 验证

- 独立选择真实进入 Critic request，未配置时回退作者模型。
- 无图片能力或无工具能力的模型不能保存为 Critic。
- Provider 删除或能力变化清除失效选择。
- IPC/Preload 拒绝非法结构，Renderer 永远拿不到 API Key。
- Critic 失败仍只终结当前 capture/Run，不污染下一条 Conversation 消息。
