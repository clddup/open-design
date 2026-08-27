# ADR-0188：设计失败 Issue 投影契约

## 状态

接受。

## 决策

EditorRuntime 的 `DesignError.issues` 是设计事务失败的权威结构。文档结构校验、文档 invariant 与 OperationError 转换必须保留可用的 `code/path/message/expected/actual/recovery`，不得在 Runtime 内提前降级为纯文本。

Renderer 将 `DesignIssue` 投影到 Agent failure event 时只通过 `AgentToolFailureIssueContract` 接受字段。`code/commandId/nodeId/path/message/recovery` 直接保留；`expected/actual` 仅在 canonical Agent schema 可表达时进入事件，无法表达的嵌套 JSON 值明确省略，不生成非法 Agent Event。节点路径到命令的归因由独立 `design-error-projection` owner 负责，不再埋在设计工具总执行文件中。

Timeline 对 `design-transaction` 使用结构化 issue 的稳定 code、字段路径、命令、节点和 recovery 展示根因，并按稳定事务错误 code 判断可恢复状态；不得再从事务 message 文案分类。其他尚未迁移的 workflow failure 字符串分类仍属于后续切片，本决策不冒充完整错误链已经收敛。

## 后果

- Runtime → Renderer → Agent Event → Journal → Timeline 不再丢失设计事务 issue code 与可表达的期望/实际值。
- `AgentToolFailureIssueSchema` 与 `AgentToolFailureIssueContract` 是失败事件字段范围的唯一事实源，不新增平行手写结构判断。
- 事务根因的文案调整不再改变 Timeline 的 routine/recovery 分类。

## 验证

- 投影测试覆盖命令/节点归因、稳定 code、scalar expected/actual、recovery，以及嵌套 JSON 的明确省略。
- 真实负数 stroke 文档失败覆盖 Runtime 到 Renderer 的结构化 issue。
- Timeline 测试证明事务展示与可恢复分类只依赖结构化 details 和稳定 code。
