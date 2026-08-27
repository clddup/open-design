# ADR-0192：跨进程 TrustedToolResult 单一契约

## 状态

已接受。

## 背景

`DesignTransactionResultContract` 已拥有 EditorRuntime 的完整成功/失败结构、ChangeSet 和 correlation，但实际生产链并不会把该对象原样发送给 Main。Renderer 执行事务后，只向 Main/Agent 返回有界 content、observed revision 与 design revision evidence。复制完整 ChangeSet 会扩大 IPC、Agent journal 和模型上下文，也会泄漏模型不需要的文档细节。

现场审计同时确认当前仓库没有 MCP host/server。为了“让 MCP 复用”而提前增加无调用者 adapter，会重新制造已删除的空架构门面。

真实问题是 `TrustedToolResultSchema` 与 `isTrustedToolResult()` 分别维护结构和手写 domain 判断；Renderer bridge 又依赖该判断。revision 前进、rebase 顺序、observed correlation 和 content 预算没有统一的结构化 issue。

## 决策

1. `@opendesign/agent-contracts` 增加唯一 `TrustedToolResultContract`，直接组合现有 Schema，并以一个 refinement 负责 content 可序列化预算、design revision 前进、rebase 顺序和 observed/design revision correlation。
2. `isTrustedToolResult()` 只代理 Contract parse，删除并行的 `Value.Check + jsonSizeWithin + revision if` 判断。
3. `designRevision` 是写入事实；`observedRevision` 在存在时必须与 committed revision 相同。当前 Renderer 的每个设计写生产者都显式返回 observed revision；历史只读或已持久事件不因冗余 observed 字段缺失而失效。
4. Renderer prepared image/edit/export content 可能包含受控 bytes，先由 prepared-material Contract 验证，再把 content 当作已验证 opaque payload 组合同一 TrustedToolResult revision 规则；不把 Desktop 私有类型反向依赖进 Agent Contracts。
5. 完整 `DesignTransactionResult`、ChangeSet 和 Runtime history 留在 Renderer。Main/Agent 只接收完成任务所需的 bounded projection。
6. 当前不创建 MCP compatibility package。未来 MCP Client/Server 必须经 Main Tool Runtime、resource handle、capability、approval、revision 和相同 Design Transaction/Trusted Result Contract 接入。

## 结果

- Renderer、Preload/Main IPC、Agent Runtime 和持久 Tool Event 对成功结果使用一个结构与 domain owner。
- 损坏 revision 返回稳定 `code/path/expected/actual/recovery`，不再只得到布尔 false。
- 当前设计写统一携带 exact observed revision，Autosave 和 continuation 不必猜测提交结果。
- 不扩大 IPC payload，不复制 ChangeSet，不增加无生产调用者的 MCP 门面。

## 验证

- revision 未前进、非法 rebase、observed mismatch、超预算和循环 content 分别返回稳定 issue。
- Renderer bridge 拒绝损坏结果，同时继续接受经过 prepared-material Contract 验证的受控 opaque content。
- 当前 Renderer 生产写结果均同时包含 `observedRevision` 与 `designRevision`，并在同一 revision 上通过 Contract。
- Agent Runtime、Tool Event 与 Renderer Host 的现有成功/失败路径继续通过。
