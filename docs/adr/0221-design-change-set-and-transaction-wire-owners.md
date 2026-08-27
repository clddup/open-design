# ADR-0221：Design Change Set 与 Transaction Wire Owners

## 状态

已接受。

## 背景

ADR-0220 已将 Editor wire 从 `@opendesign/design-contracts` 根入口迁出，但根 `index.ts` 仍同时定义 operation 之后的 diff/change set、transaction、结构化错误、revision、result 和 history。约 480 行相互关联的 wire schema 聚集在聚合入口，使文档变化事实与事务传输事实没有独立 owner，也扩大后续 DesignDocument/Operation schema 拆分的依赖面。

## 决策

1. `change-set-schema.ts` 唯一拥有 Node/Page/Component/Library source change schema 与聚合 `DesignChangeSetSchema`，并组合既有 Variable、Variant 和 Shared Style change schema。
2. `transaction-wire-schema.ts` 唯一拥有 Actor、Transaction、Design Issue/Error、Revision、Fidelity Warning、Transaction Result 与 History Entry schema。
3. 两个 owner 通过 factory 注入已经存在的权威 schema 和事务命令预算，不反向导入根 `index.ts`，也不复制 domain refinement。
4. 根入口使用具名 `ReturnType` 组合并继续导出原有 schema 对象；TypeBox `Static` 类型继续从同一 schema 派生，不降级为 `unknown`，不新增手写结构类型副本。
5. `operation-contract.ts`、`transaction-result-contract.ts` 及其 domain owner 继续只负责 parse/refinement，不重新拥有 wire 结构。

## 结果

- 根 `index.ts` 从约 2580 行降至约 2180 行。
- Change Set 与 Transaction wire owner 分别约 260 行和 180 行，均低于 500 行。
- 事务命令上限、closed-object、union 字段路径、diff 静态类型、result correlation 与 history 行为保持不变。
- DesignDocument、Node 与 Operation schema 的最终 owner 拆分仍需继续，不能把本切片描述为整个 Design Contracts 迁移完成。

## 验证

- Design Contracts、EditorRuntime、Leafer Engine 与 Desktop typecheck；
- Design Contracts、EditorRuntime 与 document diff 定向 tests；
- Desktop production build。
