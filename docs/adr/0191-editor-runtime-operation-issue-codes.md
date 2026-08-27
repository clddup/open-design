# ADR-0191：EditorRuntime OperationError 领域 Issue Code

## 状态

已接受。

## 背景

ADR-0186 已要求事务失败携带结构化 `DesignIssue`，但 `OperationError` 仍允许只提供英文 message。Runtime 会把这些错误统一降级为 `design.operation.invalid`、`design.operation.not-found` 等粗粒度 code。结果是 Provider、Timeline、诊断和恢复逻辑虽然拿到了结构化 envelope，却无法区分“Page 名称未变化”“节点重复”“Style 仍被引用”“字体 Provider 尚未就绪”等真实原因。

继续在 Runtime 或 Renderer 根据 message 分类会重新建立第二事实源，也会让相同语义随文案变化漂移。

## 决策

1. `OperationError` 构造必须显式提供 `design.<domain>.<reason>` 领域 code；旧的 `(commandId, message, coarseCode, options)` 签名删除，不保留兼容 overload。
2. `OperationError` 在产生位置同时生成至少一条完整 `DesignIssue`，包含 code、commandId、path 和 message；context 只作为附加 details，不能替代领域 code。
3. 节点 Schema 展开产生的多 issue 继续保留具体字段路径，但使用同一 `design.node.schema_invalid` 领域身份。
4. Runtime 只复制 `OperationError.issues`，删除根据 coarse error code 生成 `design.operation.*` 的 fallback。`DesignError.code` 继续表达事务级 `invalid/conflict/not-found/...`，领域原因由 issue code 表达，两层职责不合并。
5. 一次迁移全部 114 个生产错误源，覆盖 Page、树与节点、Component/Variant、Asset、Style、Variable、Text/Font 和 Auto Layout；不允许新错误源退回泛化 code。
6. Renderer 到 Agent 的投影原样保留 issue code，并把 code 纳入恢复 fingerprint，避免不同根因因相同 path/message 被错误聚合。

## 结果

- 模型第一次失败即可收到稳定原因，不需要从英文文案猜测该重新 inspect、换 ID、解除引用还是等待 Provider。
- Timeline、诊断和测试可以依赖 code/path，不依赖 message 正则。
- coarse `DesignError.code` 仍决定事务是否可恢复；领域 code 只描述确定根因，不扩大权限或重试范围。
- 该切片不改变文档 schema、revision、原子事务或 undo 语义。

## 验证

- TypeScript 构造签名保证每个生产 `OperationError` 必须显式给出 `design.*` code。
- Page no-op、缺失节点、资源引用占用和节点 Schema 失败返回各自稳定领域 code。
- 全部 EditorRuntime 测试验证原子回滚、history、组件、变量、Style、Text 与几何行为未改变。
- Renderer design transaction failure 保留同一 code、commandId、nodeId 和 path，并继续通过 Agent failure Contract。

跨 Renderer/Main/Agent 的成功结果 correlation 由后续 ADR-0192 收口；完整事务 ChangeSet 不跨进程复制。
