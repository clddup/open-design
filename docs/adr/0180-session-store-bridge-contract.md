# ADR-0180：Session Store Bridge 单一契约

状态：已接受

## 背景

Agent `utilityProcess` 通过 Main-owned Session Store bridge 执行 append/read/readTimeline/project，但 request/response、Journal Event、Projection、数组预算与 request identity 长期由 `session-store-bridge.ts` 的 `record/exactKeys/Set/boundedArray` 手写遍历共同维护。Durable Event 与 Timeline 已在 `@opendesign/agent-contracts` 有 canonical executable schema，桥层继续复制 event type 和字段规则会形成第二事实源，也只能返回布尔失败。

## 决策

- `session-store-bridge-schemas.ts` 唯一拥有 request/response envelope、operation、Projection 与 malformed-message identity 的 executable wire shape；Durable Event 与 Timeline 直接组合 `@opendesign/agent-contracts` canonical schemas。
- `session-store-bridge-domain.ts` 只处理 schema 不能表达的 JSON 字节预算、可解析事件时间与 compacted range 顺序，不复制字段、枚举或 exact-key 判断。
- `session-store-bridge.ts` 只组合 Request/Response/Identity Contract，并保留现有布尔 guard、request ID 与 operation extractor 作为稳定 adapter。
- Main 在向 Agent 发送 handler response 前执行同一 Response Contract；Agent 收到 response 时继续通过同一 Contract 验证。真实 Session Store、路径所有权、取消、超时、request correlation 与 IPC message type 不变，不增加兼容双写。

## 验证

Session Store bridge、Agent-side proxy、Main host/binding 与 AgentHost 定向测试覆盖 append/read、canonical event payload、未知字段、JSON 预算、timestamp、Projection range、identity recovery、取消与 request correlation。Desktop TypeScript、ESLint 与 Prettier 覆盖整个切片。
