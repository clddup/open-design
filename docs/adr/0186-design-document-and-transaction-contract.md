# ADR-0186：DesignDocument 与事务契约归属

## 状态

接受。

## 决策

`@opendesign/design-contracts` 是 DesignDocument、DesignOperation、DesignTransaction 与 DesignTransactionResult 结构和无文档上下文 domain 关系的唯一 owner。

- `DesignDocumentContract` 组合当前 executable schema 与文档内 Layout Limits、Text Runs、Paragraph Runs refinement。当前 schema 的非法文档不再进入 migration 静默补字段或合并 runs；已知旧 schema 才允许显式迁移。
- `DesignOperationContract` 与 `DesignTransactionContract` 统一 operation cross-field、replacement bundle、Layout Limits 和 command ID 唯一性。`EditorRuntime` 每次 preview/apply 只 parse 一次；document ID、revision、节点存在、引用和应用后文档 invariant 仍由 Runtime guard 拥有。
- `DesignTransactionResultContract` 校验成功结果的 revision、transaction、document 与 ChangeSet correlation，以及 added/changed/removed identity 互斥。
- Runtime 产生的失败优先携带结构化 Design Issues；Renderer 直接消费 issue code/path/command/node，不再把任意 `details` 数组解释成字段错误。旧的顶层 message/path 仅作为尚未迁移错误源的过渡 fallback。
- Provider 的紧凑 Apply schema 与 canonical transaction 共享同一 command 数量上限；compiled commands 复用 operation domain owner，不在 Desktop 再维护一套 command 关系规则。

## 边界

本决策不把完整文档 invariant 移入 design-contracts。Component/Instance/Slot、Variant、Style、Variable、Vector、Asset 和树引用仍依赖各服务与 EditorRuntime，避免形成循环依赖。

DesignDocument 历史 migration 的物理拆分、所有 OperationError context 的 typed issue 化、DesignError 旧 fallback 删除以及 MCP 入口复用仍是后续切片；未完成前不得宣称整个事务错误协议已迁移完毕。

## 失败行为

结构或 domain 失败返回稳定 `code/path/message/recovery`，不产生 revision。跨进程收到 correlation 不一致的成功结果时拒绝结果并保留最后一个权威 document revision。未知或损坏持久数据继续失败关闭；明确属于开发期旧格式的派生 Global Task 状态可以一次性丢弃，但不得因此删除 Conversation、Project、设计文件或 Provider 配置。
