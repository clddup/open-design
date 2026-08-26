# ADR-0160：完整 Delivery Scope 与滚动 executable Plan 分离

## 状态

已接受。

## 背景

ADR-0148 将用户确认的完整 Delivery Scope 直接绑定到单份 executable Plan。该方案能阻止模型少报交付目标，但把两种不同生命周期的事实混在了一起：

- Delivery Scope 是完整用户目标与最终验收范围；
- executable Plan 是当前 Provider 上下文内可执行、可提交 revision 的阶段。

长 PRD 可能包含 24 个 target 和 97 条 required content。完整 Scope 在自己的 schema 中合法，但单份 Plan 的 `briefFidelity` 只接受有界内容。Main 又把完整 Scope 展平写回 Plan，导致 Provider 可见契约、Runtime 校验和 Host 绑定互相冲突。模型无法在“不丢目标”和“不超过单次预算”之间生成合法输入，最终在零 revision 状态反复失败。

## 决策

完整 Delivery Scope 与 executable Plan 分开持有：

1. 用户确认的 Scope 保留全部 target、稳定 ID、objective、required content、exclusions 与 assumptions，不使用单次 Plan 预算校验其全局总量。
2. 对已确认的多目标 Scope，当前 executable Plan 只包含第一个尚未规划的确认 target。当前阶段未验证前，Plan amendment 必须保留该阶段目标。
3. 当前阶段验证后，Main 返回有界 `deliveryStage.nextTarget`，模型为下一个确认 target 建立下一份 Plan。不得跳过、换序、重命名或重复已完成 target。
4. `DesignWorkflowState` 保留既有 target 的稳定 Page/Frame/region 身份、delivery 状态和 revision；切换阶段只替换当前 Plan，不删除历史目标状态。
5. completion guard 把 delivery ledger 视为确认 Scope 的有序前缀。当前前缀全部验证但 Scope 尚有剩余时，要求建立下一阶段 Plan；只有完整 Scope 全部验证后才允许总任务完成。
6. 自动 continuation 同时携带 Plan、ledger、Scope 与有界 stage context。当前阶段已验证但 Scope 尚有未规划 target 时，仍属于未完成任务。
7. 对话时间线显示结构化当前 Plan、目标、实现步骤和真实 delivery 状态。历史阶段保留并折叠；真实 `DesignTransaction` semantic steps 继续按 committed revision 展示。

## 结果

- 首个 Provider 请求不再需要生成完整产品套件的详细几何 Plan。
- 完整 PRD 不会因为 required content 总量超过单次执行预算而在写画布前失败。
- 用户能看到当前真实计划，阶段完成后继续下一 Plan，而不是只看到内部工具状态。
- Scope 仍是最终完成事实源；滚动 Plan 不允许通过阶段化缩小交付范围。
- Plan amendment、跨 Run 恢复和 completion guard 必须同时维护“当前阶段”与“完整 Scope”语义，不能只查看当前 Plan target 数量。

## 验证

- 24 target、97 required content 的 Scope 可通过统一契约。
- 首份 Plan 只绑定 target 1 的 required content，ledger 为确认 Scope 的有序前缀。
- 当前阶段未完成时拒绝跳到 target 2。
- target 1 验证后可注册 target 2，同时保留 target 1 的稳定 ID 与 verified revision。
- completion guard 和自动 continuation 都把剩余未规划 Scope 视为未完成。
- Timeline 从真实 Plan tool result 投影可折叠 Plan，不从模型 prose 猜测计划。
