# ADR-0220：Design Contracts Editor Wire Owner

## 状态

已接受。

## 背景

`@opendesign/design-contracts` 已拥有 DesignDocument、DesignTransaction 与 Editor wire 的权威结构，但根 `index.ts` 仍超过 2500 行。Editor state/event、selection/viewport、capability manifest 与 export artifact 聚集在根入口，既扩大修改面，也让后续继续拆分 schema owner 时容易形成对聚合入口的反向依赖。

## 决策

1. `editor-wire-schema.ts` 唯一拥有 History State、Component Selection Target、Selection、Viewport、Editor State/Event、Design Capabilities 与 Export Artifact schema。
2. 新 owner 通过 factory 注入 History Entry、Transaction Success、Design Error、Node Kind、JSON Object、Fidelity Warning 和当前 schema version，不反向导入根 `index.ts`。
3. 根入口只组合依赖并继续导出原有 schema 名称；不保留旧定义、兼容副本或第二份结构判断。
4. Editor Event 继续使用同一 discriminated union 错误展开；嵌套 transaction/error/history/fidelity schema 继续引用其权威对象。

## 结果

- 根 `index.ts` 从约 2750 行降至约 2580 行，新 owner 为约 230 行。
- 下游导入路径、Runtime 行为、capability literal 与 closed-object 规则不变。
- 该切片只收口 Editor wire，不代表 DesignDocument/Transaction 的全部 schema owner 已拆分完成。

## 验证

- Design Contracts、EditorRuntime 与 Desktop typecheck；
- Design Contracts 与 EditorRuntime 定向 tests；
- Desktop production build。
