# ADR-0189：设计工作流失败契约

## 状态

接受。

## 决策

设计工作流 guard 不再通过 `throw new Error("design_workflow.xxx: ...")` 创建协议。`designWorkflowError(code, detail, options)` 是 Main 与 Renderer 设计工作流失败的唯一构造入口：稳定 code 由一个闭合集合拥有，phase、用户呈现与是否需要 inspect 由同一 catalog 派生，错误在抛出前必须通过 `TrustedToolFailureContract`。

Agent failure details 新增独立 `design-workflow` 分支，包含 `workflowCode/phase/requiresInspection/issues/recovery`。它与 `design-transaction`、`tool-validation` 分别表达流程 guard、文档事务失败和模型参数失败，不能互相冒充。Main 直接使用 Error cause 中已验证的 `TrustedToolFailure`；Renderer bridge 保留该 cause，不再把它降级为通用执行错误。

Timeline、诊断和可恢复状态只读取稳定 failure code 与结构化 details。删除旧的 message 正则分类、Main 二次解析和按英文错误文本提取 command ID；用户可见文本仍可包含 code/detail/recovery，供模型执行恢复，但修改文案不能改变产品行为。

## 后果

- 当前生产设计工作流 guard、revision conflict、scope conflict 与 stale target 均在产生位置形成结构化失败。
- Workflow、transaction 与 validation 三类失败在 Agent Event、journal、diagnostic 和 Timeline 中保持可区分。
- 当前 catalog 只定义运行时工作流语义，不是新增流程门禁；后续增删 guard 必须改同一 owner，不能重新写字符串协议。

## 验证

- Agent Contract 覆盖 `design-workflow` details 的可执行 schema。
- 生产 Main/Renderer guard 测试覆盖当前既有 workflow catalog 的代表路径、revision/scope 失败和跨 Renderer bridge 保真。
- Timeline 与 Diagnostic 测试证明分类、折叠和呈现不依赖 message 内容。
