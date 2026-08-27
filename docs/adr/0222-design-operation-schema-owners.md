# ADR-0222：Design Operation Schema Owners

## 状态

已接受。

## 背景

Change Set 与 Transaction wire 已由 ADR-0221 迁出，但 `@opendesign/design-contracts` 根入口仍直接定义全部 Node/Text、Asset、Component、Library 与 Page command schema，以及总 `DesignOperation` union。约 400 行命令结构使文档节点编辑、资源生命周期和聚合 union 没有独立 owner，也让后续拆分 DesignDocument/Node schema 时必须修改同一聚合文件。

## 决策

1. `node-operation-schema.ts` 唯一拥有 insert/update/move/delete/replace、text reflow/range style/internal commit 与 Node operation union。
2. `resource-operation-schema.ts` 唯一拥有 Asset/Image Derivation、Component/Library Source 与 Page lifecycle commands。
3. `operation-schema.ts` 只把 Node operation 与既有 Resource、Variable、Style、Variant、Page commands 组合为总 operation union。
4. 三个 owner 通过 factory 注入权威 Node、Layout、Appearance、Text、Resource 和预算 schema，不反向导入根 `index.ts`，不复制 operation domain refinement。
5. 根入口继续导出原有 schema 名称；两个大型 union 保留显式 TypeBox tuple 类型，所有 command `Static` 类型仍从同一 schema 派生。

## 结果

- 根 `index.ts` 从约 2180 行降至约 1850 行。
- Node、Resource 与聚合 owner 分别约 290、250 和 12 行，均低于 500 行。
- command discriminant、closed-object、文字范围、事务命令预算、Page 节点预算和 nested Node 字段路径保持不变。
- Node/appearance、Document/resource 与公共类型/guard 的最终 owner 拆分仍需继续。

## 验证

- Design Contracts、EditorRuntime、Leafer Engine 与 Desktop typecheck；
- Design Contracts、EditorRuntime、document diff、Library source 与 Style operation 定向 tests；
- Desktop production build。
