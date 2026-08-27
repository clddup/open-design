# ADR-0211：结构化 Initial Inspection 与 Agent Request 单一契约

## 状态

已接受。

## 背景

Main 在 Run 开始前已经取得 exact-revision 的设计 inspection，但此前把有界投影再次编码为 JSON 字符串。Agent Runtime 为判断空 Page 和当前编辑意图重新 `JSON.parse + isRecord`，Completion Guard 又单独解析同一字符串读取 Delivery Stage；Main 同时手写序列化和字符预算。Agent Request 外层虽有 TypeBox Schema，`isAgentRequest()` 仍另外组合结构守卫，导致结构、领域关系和错误路径存在多个事实源。

## 决策

1. `@opendesign/agent-contracts` 唯一拥有 `AgentInitialDesignInspectionSchema/Contract`。`content` 使用结构化 `{ inspection, unfinishedDelivery?, deliveryStage? }`，不保留字符串兼容入口。
2. Initial Inspection Schema 负责结构和未知顶层字段；domain refinement 负责模型投影字符预算、inspection document 与 observed revision 关联，并组合 Delivery Ledger 与 Delivery Stage 的权威领域规则。
3. `DesignDeliveryStageSchema/Contract` 从 Desktop shared 下沉到 `@opendesign/agent-contracts`，成为 Main、Agent Runtime 与 Renderer 的跨进程 owner；Desktop 不保留 re-export 或第二份实现。
4. `AgentRequestContract` 按 `type` discriminant 选择真实 union 分支，统一输出结构化 issue。Run start domain 只组合 Initial Inspection、Selection Scope 与 Page mutation target 的跨字段关系。
5. Main producer 在发送前解析 Initial Inspection Contract；Agent Runtime 直接读取结构对象，只在拼接 Provider prompt 的最后边界序列化一次。Completion Guard 直接消费结构化 Delivery Stage。

## 结果

- Initial Inspection 不再发生 Main stringify、Runtime parse、Completion Guard parse 的重复往返，也不会因解析失败静默退回较慢工具面。
- Renderer 伪造 inspection、revision 漂移、空/超预算投影、嵌套 Delivery Stage 漂移和 Page scope 错配均返回稳定 code/path。
- Selection Scope 的 primary node 领域规则由原 owner 组合进 Agent Request，不在新 Contract 中复制。
- 本切片不新增协议版本、内容 hash、源码/fixture 数量门禁，也不声称完整 Agent 生成链的契约迁移已经完成。

## 验证

- Initial Inspection 合法结构、空投影、超预算、document revision 与嵌套 Delivery Stage 路径；
- Agent Request union 分支、Initial Inspection revision、Selection primary node 与 Page target 关联；
- Main initial-inspection producer、Run starter/coordinator、Agent Runtime 首轮工具面与 Provider context；
- Completion Guard、Continuation Scheduler、Global Coordinator 与 Renderer Timeline 回归；
- Agent Contracts、Agent Runtime、Desktop typecheck 与 Desktop production build。
