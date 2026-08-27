# ADR-0225：Design Contracts Registry 与 Facade

## 状态

已接受。

## 背景

ADR-0220～0224 已把具体 schema owner 从 `@opendesign/design-contracts/index.ts` 迁出，但根入口仍承担约 1000 行的 schema composition、公共 Static 类型、guard、migration 和 Contract facade。包内 domain/contract/migration 模块还通过类型导入反向依赖聚合入口，形成不必要的循环边界。

## 决策

1. `node-schema-registry.ts` 只组合 DesignDocument 之前的 Style、Shape、Text、Image、Vector、Component、Node、Library 与 Document schemas。
2. `transaction-schema-registry.ts` 只组合 Operation、Change Set、Transaction 与 Editor wire schemas；它单向依赖 Node registry。
3. `schema-registry.ts` 提供稳定 schema 聚合导出，不拥有第二份 schema。
4. `public-types.ts` 从 registry 的同一 TypeBox schema 派生所有公共 Static 类型和纯类型辅助关系。
5. `contract-facade.ts` 唯一组合结构 guard、Library migration、DesignDocument migration 与 Document/Operation/Transaction Contracts。
6. 根 `index.ts` 只保留稳定 re-export。domain、contract、migration 和 geometry 模块直接依赖 `public-types.ts` 或 primitives，不再反向导入 `index.ts`。

## 结果

- 根 `index.ts` 从约 1030 行降至 35 行。
- Node registry、Transaction registry、Public Types 与 Contract Facade 分别约 287、312、288 和 192 行，均低于 500 行。
- 包内生产模块对聚合入口的反向依赖归零；唯一保留的 `./index.js` 导入是公共入口回归测试。
- 公共导入路径、schema identity、Static 类型、Contract parse/refinement、migration 和 guard 行为保持不变。
- 该切片完成根入口治理，但不代表 roadmap 中所有跨进程契约与专业设计能力已经完成；大型聚合测试文件仍需按 owner 拆分。

## 验证

- Design Contracts、EditorRuntime、Text/Geometry/Component/Library/Variable/Import-Export Service、Leafer Engine 与 Desktop typecheck；
- Design Contracts、Design Quality、EditorRuntime、Document、Auto Layout、Rich Text、Vector 与 Service 定向 tests；
- Desktop production build。
