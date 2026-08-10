# ADR-0016：原始会话历史与模型上下文投影分离

- 状态：已接受
- 日期：2026-08-10
- 关联：ADR-0006、ADR-0007、ADR-0012、ADR-0015
- Context checkpoint：`2`

## 背景

Conversation journal 会持续保存用户消息、Agent 消息、tool call/result、附件引用和设计 revision。若每次 run 都把完整 journal 原样重放给模型，长会话、文档附件、画布截图和设计检查结果最终一定超过模型上下文窗口。图片还可能因 data URI 或重复多模态引用造成非线性膨胀。

直接删除最旧消息会损坏用户可见历史和审计；按任意消息边界截断可能把 tool call 与 result 拆开；把聊天当作文档事实又会与 `DesignDocument`、revision 和唯一 `EditorRuntime` 冲突。

## 决策

### 两份用途不同的状态

原始 Conversation journal 永久保持追加式事实，不因上下文预算删除或改写。模型输入是从 journal 派生的可丢弃投影，可以压缩，但不能反向覆盖历史、设计文档或工具审计。

`context.compacted` 记录累计 checkpoint：当前版本使用 `fromSequence=1` 和单调增加的 `toSequence`。新的 checkpoint 取代更早 checkpoint 的模型投影范围，但所有原始事件继续保留，Timeline 仍能显示原消息。

### 确定性压缩与分账预算

Agent Runtime 在网络请求前把上下文分为两类：固定协议开销（system prompt、tool schema 与请求封装）和可压缩 Conversation 投影（当前消息、历史、tool result 与附件引用）。固定协议不得冒充用户历史，也不得触发无意义的 journal compaction；只有 Conversation 投影超过预算时，才在完整 run 边界压缩旧事件，不拆分 tool call/result。

Main 根据可信 Model Profile 解析所选模型的 `contextWindow` 与 `maxOutputTokens`，拒绝 Renderer 自行提供这些字段，再以 `AgentRequest 3.4` 的 `modelContext` 元数据注入 utility process。Agent Runtime 为最大输出和请求波动保留空间，并分别估算 ASCII、CJK、其他 Unicode、图片引用和文档引用的输入 token。当前估算是跨 Provider 的保守启发式，不宣称等价于任一模型 tokenizer。

模型可见的设计工具 Schema 与可信运行时校验 Schema 分离：前者是无 `$ref/$defs`、跨 adapter 的紧凑命令契约，后者继续使用完整 `DesignOperationSchema` 验证所有不可信模型输出。不得为了缩小请求而放松运行时校验。若固定协议本身无法装入所选模型，Run 返回 `model_context_incompatible`；不得错误报告为用户 Conversation 过长。

checkpoint v1 是有界 JSON，包含：近期用户请求摘录、Agent 结果摘录、附件元数据、工具调用计数、最新 DesignDocument revision/transaction 和 run 终态统计。它不包含二进制、data URI、完整工具结果或原始凭据。Agent 摘录不是执行证明，设计状态仍以重新 `inspect_document` 和 Main 执行结果为准。

若旧 journal 中已经存在超长工具字段，模型投影会先把单字段替换为显式省略标记。若累计压缩后当前输入仍超过所选模型输入预算或本地 Conversation 字符上限，Run 在 Provider I/O 前以 `context_budget_exceeded` 可见失败，保留用户消息和失败终态。

### 后续精确预算与语义压缩

后续应由 Provider adapter 根据服务端模型元数据校正用户配置的窗口，并在有可靠 tokenizer/图片计费规则时替换启发式估算；可选语义 compactor 通过窄端口生成更高质量的目标、决策和未完成事项摘要。语义 compactor 不能取得额外权限、凭据、文件或网络范围。

上游仍返回 `context_too_large` 时，未来只允许在本地重新预算和紧急压缩后自动重试一次，避免无限重试或重复收费。

## 结果

- 长会话可以继续，而不要求用户新建 Conversation 绕过历史。
- 原始历史、工具审计和设计事实不丢失；压缩只影响模型输入。
- 图片和工具结果不会因 base64 文本重复回放拖垮上下文。
- 当前估算可能比实际模型保守；服务端模型元数据探测、精确 tokenizer/image 预算和语义摘要仍是后续工作。

## 验证

- 单测构造多个超预算 run，验证生成累计 checkpoint、`toSequence` 单调增加、最近原文保留且旧全文不再进入模型请求。
- 单测证明原始 `message.user` 仍可从 Timeline 读取。
- 单测证明单次当前输入无法装入预算时不调用 Provider，并返回 `context_budget_exceeded` 终态。
- 单测证明当前 Run 的工具结果令后续轮超预算时，只保留已完成工具审计并在下一次 Provider I/O 前返回同一可见终态。
- 单测证明当前轮和恢复旧 journal 时都会省略超长工具字段。
- 完整生产 system prompt 与七个工具的回归证明短消息能进入 Provider；`apply_transaction` 模型 Schema 受尺寸门禁约束，而完整运行时 Schema 继续拒绝非法命令。
- 单测证明 Main 只从所选 Model Profile 注入预算，并区分 `model_context_incompatible` 与 `context_budget_exceeded`。
- 无窗口真实 Provider 烟测证明两轮请求都带 checkpoint 且不含 data URI，原始 1.6M 字符工具结果仍留在 journal，第二轮模型正常完成。
