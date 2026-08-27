# ADR-0197：Session Durable Event 与 Timeline 单一契约

## 状态

已接受。

## 背景

Session Store bridge 已直接组合 `@opendesign/agent-contracts` 的 Durable Event 与 Timeline Schema，但真实 JSONL/SQLite Store 仍在 `index.ts` 和 `run-state.ts` 平行维护 Journal event、附件、Selection、Mutation Target、Run failure、continuation、model selection、assistant block 与 timeline item 的类型和手写 guard。两层发生漂移时，同一条事件可能通过 Agent/bridge 却被 Store 丢弃；`non-retryable-error` continuation 已是 canonical 值，但旧 Store guard 不接受它。

严格切换到 canonical Contract 还必须保留一条已有产品语义：历史 tool failure 的可选损坏 details 或开发期超长诊断不能导致整条消息消失，超长 reasoning 也不能让 assistant message 被丢弃。

## 决策

1. `@opendesign/agent-contracts` 为 Model Selection、Run Failure、Attachment、Selection Scope、Mutation Target、Run Continuation、Durable Timeline Event 与 Session Timeline Item 分别导出 `defineContract` 入口；现有 `isXxx` 只代理 `Contract.parse()`。
2. Selection primary identity、Run failure/status、compacted sequence range 与 Timeline tool workflow failure 关系集中为 domain refinement，Agent Event history 复用同一 owner。
3. `@opendesign/session-store` 直接依赖 canonical Agent Contracts；删除 `run-state.ts`、重复事件/附件/selection/timeline 类型和约 600 行手写结构 guard。事件 payload 类型从 `DurableTimelineEvent` 分支派生。
4. Append 只接受当前 canonical event。JSONL/SQLite read 对当前事件只解析一次；`readTimeline` 不重复解析已验证 event，最终 projection 用 `SessionTimelineItemContract` 验证。
5. 持久化恢复只处理三个明确、可丢弃的开发期异常：移除非法 failure details、截断超长 tool diagnostic、把超长 assistant text/reasoning 拆成 canonical blocks。恢复后必须重新通过完整 Durable Contract；其他非法结构不被猜测修补。
6. durable assistant block compiler 移入 Session Store owner，Agent Runtime 在生成持久消息时复用它；Runtime history reader 删除第二套 details/message/block normalizer，只接受 canonical Timeline Contract。
7. 不增加协议版本、兼容双写、源码数量/hash 门禁或新的用户可见步骤。

## 结果

- Session 持久化、bridge、Agent Runtime 和 Renderer Timeline 使用同一组 canonical schemas/Contracts。
- `non-retryable-error` continuation 不再因 Store 漂移而消失。
- 非法 attachment 字段返回准确路径，不再只报 `Invalid journal event`。
- 已存在的损坏 failure details、超长诊断和超长 reasoning 只修复可丢弃部分，保留原 tool/assistant message 与时间顺序。
- Store 不再维护自己的 Agent 协议副本。

## 验证

- 八个 Contract facade 与薄 guard 的结构、字段路径和 domain refinement 测试。
- JSONL/SQLite append/read/timeline/project、并发 sequence 与中断恢复测试。
- 非法 attachment path、compacted range、Selection primary、Run failure state 和 continuation reason 测试。
- 持久化非法 details、超长 tool diagnostic 与超长 reasoning 的整条消息保留测试。
- Session Store bridge、Agent Runtime、Parent Session Store 和 Desktop typecheck/测试。
