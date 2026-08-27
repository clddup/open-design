# ADR-0219：EditorRuntime 文档规范化与 Invariant Owner

## 状态

已接受。

## 背景

DesignDocument 的首个单一 Contract 已由 ADR-0186 完成，但 `editor-runtime/document.ts` 仍接近 1000 行，同时负责当前文档 parse/migration/freeze、完整运行时 invariant、图片派生 DAG、空文档与欢迎文档构造。Contract 与 Runtime guard 的职责虽已定义，代码 owner 仍过度聚合。

## 决策

1. `document.ts` 只拥有当前文档 normalize、`DocumentValidationError`、deep freeze/fingerprint 和内置文档构造。
2. `document-invariants.ts` 唯一组合 Page/Node/Component/Variant/Style/Variable/Library/Vector/Layout 的跨服务完整文档 invariant。
3. `image-asset-derivation-invariants.ts` 单独拥有 derivation order、资产引用、输入/结果关系与 DAG 无环校验。
4. `document-map-utils.ts` 只提供 own-property 与 JSON Pointer token 基础工具，避免 invariant owner 重复实现。
5. `validateDocumentInvariants` 继续从原 `document.ts` 公共路径导出；不保留第二份实现、不改变 migration、错误 issue、文档冻结或 Runtime parse 次数。

## 结果

- 原 959 行文件拆为约 367/480/109/14 行的 owner，均低于 500 行。
- Schema/Contract 仍负责结构与无上下文 domain；EditorRuntime 仍负责引用、树、组件、资源和跨服务 invariant。
- 该切片为后续拆分 Design Contracts schema owner 与 EditorRuntime transaction execution 保留单向依赖边界。

## 验证

- EditorRuntime 与 Desktop typecheck；
- Document、Component Property、Variant 与 Runtime 定向 tests；
- Desktop production build。
