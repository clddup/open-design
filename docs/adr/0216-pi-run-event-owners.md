# ADR-0216：Pi Run Event 消息与工具事件 Owner

## 状态

已接受。

## 背景

Pi Tool Adapter 已按 ADR-0215 拆分，但 `pi-run-event-adapter.ts` 仍超过 800 行，同时维护 Run start/end、assistant/user/tool-result message、delta、completion guard、continuation、tool journal、approval、design revision 与 terminal failure。该文件既是 Pi ephemeral event 的入口，又直接拥有所有 durable/public projection，职责变化容易破坏消息顺序或让工具终态重复写入。

## 决策

1. `PiRunMessageController` 唯一拥有 user/assistant/tool-result message active state、delta、assistant timeline blocks、generated-token/turn budget、completion guard、trusted continuation 与 pending completion interruption。
2. `PiRunToolEventBridge` 唯一拥有 tool start/progress/end、approval request/resolution、tool journal、design revision、失败消息边界和 acknowledge 顺序。
3. `PiRunEventAdapter` 只负责 Pi event dispatch、Run start/end、context/model/tool terminal failure 合并，以及组合 Message Controller、Tool Event Bridge 与 Tool Adapter。
4. journal append 与公开 Agent Event publish 仍由 Adapter 提供窄 callback；两个 owner 不取得 Session Store 路径、Main 能力或第二份 durable transcript。
5. completion guard 继续只在无 tool call 的正常 assistant stop 后运行；拒绝次数、trusted continuation、provisional clear、turn/token budget 与 terminal precedence 保持不变。
6. 不增删工具、不改变 Agent Event/Journal schema，不增加版本、内容 hash、源码数量或事件数量门禁。

## 结果

- `pi-run-event-adapter.ts` 从 838 行降至约 394 行；Message Controller 约 395 行，Tool Event Bridge 约 192 行。
- Pi message 与 tool 生命周期分别只有一个 active-state owner；Adapter 不再直接重复处理 tool terminal/approval 或 completion continuation。
- 公开 Agent Event 顺序、durable journal、revision、取消、completion guard 与 terminal failure 行为不变。

## 验证

- Agent Runtime 与 Desktop typecheck；
- Agent Runtime 全部 tests；
- Desktop production context budget 与 Pi production tool adapter tests；
- Desktop production build 与 Renderer bundle 模块数。
