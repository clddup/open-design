# ADR-0210：Design Delivery Stage 单一契约

## 状态

已接受。

## 背景

多目标任务采用“已确认完整交付范围 + 一次执行一个 target”的滚动 Plan。Main 的 `GlobalTaskCoordinator` 会把总目标数、累计已规划/已验证数量、当前 Plan 和下一 target 投影为 `deliveryStage`，供模型继续规划、Completion Guard 阻止假完成、Continuation Scheduler 判断自动续跑，以及 Renderer 展示固定计划进度。

此前只有 Main 内部 TypeScript type。Completion Guard、Continuation Scheduler 和 Timeline 分别用 `isRecord`、数字判断和字符串判断重新解释同一数据；Delivery Scope 和 Delivery Ledger 在部分 UI 路径中也被降级成只检查几个字段。一个缺少 stage、current targets 或计数关系的结果可能被某个消费者接受、被另一个消费者忽略，造成计划标题没有总进度、下一阶段不续跑或完成门禁误判。

## 决策

1. Desktop shared 层唯一拥有 `DesignDeliveryStageSchema/Contract`。Stage 是 Run 工具结果与初始 inspection 的跨 Main/Agent/Renderer 投影，不是新的持久 Workspace 实体，也不增加协议版本号。
2. Schema 负责总数、累计 planned/verified 数、current Plan、next target、目标摘要、状态枚举和字段预算；target ID 与 label 直接组合 Workspace canonical Schema。
3. Domain refinement 只处理计数顺序、current Plan 的累计 stage 范围和 target 唯一性，以及 next target 必须紧随 planned prefix、不能与 active/current target 重复。
4. Main producer 返回前解析同一 Contract，内部漂移立即失败；不再生成未经验证的进度对象。
5. Agent Completion Guard 使用 `DeliveryScopeContract`、`DesignDeliveryLedgerContract` 和 `DesignDeliveryStageContract` 读取完成证据，不再接受只有 `targetId` 的残缺 scope 或手写 `DeliveryStageProgress`。
6. Continuation Scheduler 只从合法 Stage 判断剩余 scope；Renderer Timeline 只从合法 Ledger/Stage 读取 target 状态、当前阶段与总数，不再手写 delivery status 枚举和 stage 数字 fallback。

## 结果

- 模型继续规划、自动续跑、完成门禁和用户可见计划标题消费同一进度事实。
- `plannedTargets=0 + nextTarget.stage=1` 成为合法的“范围已确认但尚未规划”状态；有 planned targets 却缺少 current Plan 会准确失败。
- 旧的残缺测试对象被替换为真实 producer 形状；没有兼容 fallback、第二份 normalizer、hash 或数量门禁。
- 本切片保证进度结构一致，不声称模型已经完成所有 target，也不替代 macOS/Windows 打包产品的真实多目标生成验收。

## 验证

- 未规划、当前 active、当前 verified + next 三种滚动阶段；
- planned/verified 计数越界、current stage 越界、重复 target、active 时提前暴露 next target 的稳定 code/path；
- Main Coordinator、initial inspection、capture/review、Completion Guard、Continuation Scheduler 与 Renderer Timeline/AgentTimeline 回归；
- Desktop typecheck 与 production build。
