# ADR-0224：Node Appearance 与 DesignNode Schema Owners

## 状态

已接受。

## 背景

Component/Library/DesignDocument 已由 ADR-0223 迁出，但 `@opendesign/design-contracts` 根入口仍直接拥有 Shape、Text、Image、Vector 的全部属性结构和十五类 DesignNode union。约 700 行节点语义混在聚合入口中，使外观、文字、矢量拓扑和节点公共字段无法独立演进，也使任何节点类型调整都扩大到整个包入口。

## 决策

1. `shape-schema.ts` 唯一拥有通用 Shape properties、Mask、Frame/基础几何、Line/Arrow、Polygon/Star 与 Boolean appearance schema。
2. `text-node-schema.ts` 唯一拥有 paragraph/character runs、字体/排版/描边共享属性与六个 text resize/truncation 分支。
3. `image-node-schema.ts` 唯一拥有 Stretch/Fit/Fill/Crop placement 与 Image properties。
4. `vector-schema.ts` 唯一拥有稳定 geometry ID、vertex/segment/path/region/network 及 Path Data/Vector Network appearance。
5. `node-schema.ts` 唯一拥有 Node Kind、公共 Node fields、Slot/Slice 和十五类 DesignNode union。
6. 各 owner 只注入已有权威 schema，不反向导入根 `index.ts`；根入口保持原导出与显式 DesignNode tuple 类型。Runtime schema、TypeBox Static、operation/Document composition 和 domain refinement 继续共享同一对象。

## 结果

- 根 `index.ts` 从约 1630 行降至约 1030 行。
- 五个新 owner 分别约 158、227、56、136 和 238 行，均低于 500 行。
- Text optional stroke fields、六种 resize/truncation 组合、Vector topology、Component Instance、Layout/Variable/Style references 与 union discriminant 保持不变。
- 根入口仍包含公共类型、guard/migration facade 和 schema composition；这些边界需要后续继续收口。

## 验证

- Design Contracts、Text/Geometry/Component/Import-Export Service、EditorRuntime、Leafer Engine 与 Desktop typecheck；
- Design Contracts、EditorRuntime、Auto Layout、Rich Text、Vector、Image 与 Component 定向 tests；
- Desktop production build。
