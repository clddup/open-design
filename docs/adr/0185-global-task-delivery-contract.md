# ADR-0185：Global Task 与 Design Delivery 单一契约

状态：已接受

取代：开发期 Delivery Ledger v1/v2 读取兼容

## 背景

Global Task Projection 与 Design Delivery Ledger 的 schema、状态/revision 关系、active target、reservation 与持久化读取长期混在 `workspace-contracts/index.ts`。`isDesignDeliveryLedger` 和 `hasValidDeliveryRevisions` 只能返回布尔值，Global Task 又重复调用 Run Target guard；Workspace Store 每次读取会用 `normalizeGlobalTaskProjection` 尝试把开发期 v1/v2 ledger 即时升级，但不回写，非法记录则静默消失。产品尚未发布，不应继续维护旧开发格式或让历史兼容路径参与当前完成门禁。

## 决策

- 新增 `@opendesign/workspace-contracts/delivery`，唯一拥有 Global Task lifecycle、Delivery status/target/ledger、Global Task Projection schemas、Static 类型与 Contracts；Workspace 根入口只重导出 descriptor、access 与 delivery 三个 owner。
- Schema 只负责字段、枚举、数组预算、unknown key 与当前技术协议版本。Delivery domain refinement 集中处理 target ID、Page/root pair、全局 reserved node 唯一、root reservation、active target 与 verified 状态，以及各状态 revision 的必填、禁用和单调关系。
- Global Task Contract 在已验证结构上直接组合 Run Target Set domain refinement 与 Delivery domain refinement，保留准确 `/targetSet/...` 和 `/delivery/...` 路径，不重复维护结构判断。
- 删除 `normalizeDesignDeliveryLedger` 与 `normalizeGlobalTaskProjection` 及其 v1/v2 fixture。当前 `DESIGN_DELIVERY_LEDGER_VERSION` 仍是技术 wire/persistence 常量，不是产品版本命名；旧开发数据不再进入生产读取路径，也不建立双写或 fallback。
- Workspace Store 保存和读取 Global Task 均使用同一 Contract，并核对 SQLite `task_id/updated_at` 与 projection JSON。非法 JSON、旧 ledger 或冗余列漂移明确失败，不再静默从任务/会话状态中消失。
- 本切片不改变用户可见 target n/m 展示、不新增完成步骤，也不改变 Global Task Coordinator、continuation、performance milestone 或 Timeline 的产品语义；这些消费者只改为复用同一 Contract facade。

## 验证

Workspace Contract 测试覆盖完整 delivery 状态、allocated/draft/capture/review/refine/verified revision、active target、reservation、重复 artboard/ID、嵌套 Run Target 错误路径和旧 ledger 明确拒绝。Workspace Store 测试覆盖当前 task 保存读取与冗余列损坏可见失败；completion guard、continuation scheduler、run starter、performance 与 Timeline 定向测试证明现有消费者行为保持。Workspace/Desktop TypeScript、ESLint、Prettier 与 production build 覆盖新的 package subpath 和根导出。
