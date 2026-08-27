# ADR-0223：Component、Library 与 DesignDocument Schema Owners

## 状态

已接受。

## 背景

Operation schema 已由 ADR-0222 迁出，但 `@opendesign/design-contracts` 根入口仍直接定义 Component/Instance、Page/Asset/Image Derivation、跨文件 Library Source/Snapshot 以及完整 DesignDocument。它们分别属于组件语义、文档资源、Library 发布来源和持久文档 wire，却共同占用聚合入口并阻碍 Node schema 的后续拆分。

## 决策

1. `component-schema.ts` 唯一拥有 Component Override Patch、Override、Instance Properties 与 Component Definition schema。
2. `document-resource-schema.ts` 唯一拥有 Page、Asset、Image Asset Derivation operation/preset/record schema。
3. `library-schema.ts` 唯一拥有 Library Release identity、Component/Variant/Style/Variable source 与 release snapshot schema。
4. `design-document-schema.ts` 唯一组合 document identity、Page/Node、Component/Library、Style/Variable、Asset/Derivation 与 extensions，形成完整 `DesignDocumentSchema`。
5. 四个 owner 通过 factory 注入既有权威 schema，不反向导入根 `index.ts`；根入口保持原导出，TypeBox Static 类型从同一 schema 派生。Document migration、domain Contract 与 EditorRuntime invariant owner 不改变职责。

## 结果

- 根 `index.ts` 从约 1850 行降至约 1630 行。
- 四个新 owner 分别约 95、106、158 和 90 行，均低于 500 行。
- Component/Library source identity、Variable document fields、Asset derivation、document closed-object 与迁移行为保持不变。
- Node/shape/text/vector appearance schema 与根类型/guard 的最终拆分仍需继续。

## 验证

- Design Contracts、Component/Library/Variable Service、EditorRuntime、Leafer Engine 与 Desktop typecheck；
- Design Contracts、Document、Library Source、Component Property 与 Variant 定向 tests；
- Desktop production build。
