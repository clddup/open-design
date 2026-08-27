# ADR-0208：Design Diagnostic Report 单一契约

## 状态

已接受。

## 背景

Renderer inspection 会把空 Path/Text、隐藏节点、缺失图片、非有限边界、裁剪外节点、根层碎片和真实设计特征摘要直接提供给模型。该 report 影响 Plan 与恢复，但此前只有 TypeScript interface，没有 executable Schema、计数关系或与 inspection document/revision/Page 的关联校验。

## 决策

1. `@opendesign/editor-runtime` 唯一拥有 diagnostic code 列表、Item、Feature Summary 与 Report Schema/Contract；类型从 Schema 派生。
2. Schema 负责 code/severity、ID、message、related IDs、计数、Page 列表、feature 字段、revision 和数组预算。
3. Report domain refinement 只负责 error/warning count 与 item severity 一致，以及每个 item Page 属于 report pageIds。
4. `diagnoseDesignPages()` 在返回前解析同一 Contract；内部 producer 若生成非法报告立即暴露 Runtime invariant，而不是把损坏结果发送给模型。
5. Design Inspection Hierarchy Contract 直接组合该 Report Schema，并校验 diagnostic documentId、revision 与 Page scope 精确匹配当前 inspection。
6. 变量、样式和字体 inspection 继续复用 DesignDocument/service 的权威结构；本切片不为没有第二份结构 owner 的数据机械增加 wrapper。

## 结果

- 模型读取的 diagnostics 与 Main 接受的 diagnostics 共享一个结构事实。
- count、Page、document 和 revision 漂移获得准确嵌套 path。
- 诊断算法仍负责发现问题，Contract 只负责边界结构与关系，不把视觉质量规则塞进 Schema。
- 不增加 Provider 工具、模型回合、hash 或仓库数量门禁。

## 验证

- clean 与 broken DesignDocument 生成的真实报告通过 Contract。
- count 漂移返回 `/errorCount` 或 `/warningCount`。
- item Page 漂移返回 `/items/{index}/pageId`。
- inspection diagnostic identity/revision/Page 漂移返回 `/content/diagnostics/...`。
- Coordinator 29 项与 Renderer design-tool execution 70 项回归通过。
