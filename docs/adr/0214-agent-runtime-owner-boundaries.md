# ADR-0214：Agent Runtime Owner 边界

## 状态

已接受。

## 背景

Agent Request/Event/Timeline 已由 ADR-0213 迁入独立契约 owner，但 `@opendesign/agent-runtime/src/index.ts` 仍超过 1100 行，同时承载 Run 类型、Runtime ports、journal→model message 投影、上下文预算与 checkpoint。Runtime 还手写了一份与 canonical `run.start` 相同的 `AgentRunRequest` 字段，并再次逐字段判断 `ResolvedModelIdentity`，形成新的漂移点。

公开设计工具目前按原子语义注册，并通过 bootstrap、host-inspected、inspected、continuation 与 expanded 阶段渐进披露。注册数量本身不等于每个 Provider turn 的可见数量；在没有调用失败率、schema token 与路由歧义证据前，把不同事务语义机械合成一个巨型 union 会降低字段定位与恢复质量。

## 决策

1. `AgentRunRequest` 直接派生自 canonical `AgentRequest` 的 `run.start` 分支，只移除跨进程 discriminant；Desktop Request Handler 在唯一边界移除 `type`，不再复制字段结构。
2. `ResolvedModelIdentityContract` 直接组合 Model Gateway canonical schema；journal→model message 投影消费该 Contract，不再维护手写 provider/model/api/reasoning 判断。
3. `run-request.ts` 拥有 Run 投影与可信 prompt；`runtime-ports.ts` 拥有 Tool/Approval/Executor/Runtime ports；`model-message-projection.ts` 拥有 journal→canonical message；`context-budget.ts`、`context-checkpoint.ts` 与 `journal-context.ts` 分别拥有预算、压缩和 journal checkpoint identity。
4. package 根 `index.ts` 只保留稳定 re-export。包内生产模块直接依赖 owner，不再通过根入口形成反向聚合依赖。
5. 本切片不增删公开设计工具，不增加版本、内容 hash、源码数量或工具数量门禁。工具合并只在真实 telemetry 证明 Provider 同时可见的 schema 成本或选择错误后进行，并必须保持原子事务、权限与准确错误路径。

## 结果

- Agent Runtime 根入口从 1116 行收缩为约 14 行；新增 owner 均低于 500 行。
- Run wire 与 Runtime 投影共享同一字段事实源；新增 Request 字段会自动进入 Runtime 类型，不再要求同步修改第二份 interface。
- 恢复历史 assistant source 使用 canonical Contract，非法 identity 不进入 Model Gateway context。
- 上下文预算、checkpoint 和 message 投影行为不变，原始 journal、Provider 可见渐进工具面与执行工具目录不变。

## 验证

- Agent Contracts、Agent Runtime 与 Desktop typecheck；
- 全部 Agent Runtime owner tests；
- Desktop Request Handler、production context budget 与 Pi production tool adapter tests；
- Desktop production build 与 Renderer bundle 模块数。
