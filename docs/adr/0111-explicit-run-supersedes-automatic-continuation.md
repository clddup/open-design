# ADR-0111：显式用户 Run 取代自动续跑链

- 状态：Accepted
- 日期：2026-08-20
- Agent protocol：不变
- Session journal：不变
- 文档协议：不变
- 关联：ADR-0094、ADR-0095、ADR-0102、ADR-0103

## 背景

一条真实设计会话出现自动 continuation 排队后，用户又发送显式消息。运行时按 Conversation session lock 串行执行两者，但 Main 没有取消旧自动链：显式 Run 执行期间旧 continuation 保持 queued；显式 Run 超时后又创建下一条 continuation，旧 continuation 随后开始。持久任务最终同时出现一个 running 和一个 queued，旧意图继续修改同一画布，造成 active target 错乱、重复 Plan、冲突和 Composer 长时间锁定。

同一实测中 Renderer 的 28 次工作累计约 9.2 秒，而 24 次 provider attempt 累计约 56.6 分钟；首个 Plan 约 243 秒，首个 material revision 约 285 秒。主要耗时是模型往返和无 revision 的错误恢复，不是画布提交或人为 stage delay。

## 决策

- Conversation 仍保持单 Run 串行执行，避免同一会话上下文并发写入。
- 同一 Conversation 已有显式 Run 时，第二条显式消息必须在 Main admission 立即拒绝，不能利用 utility-process session lock 静默排队。Renderer 以 Main-owned Global Task 作为活动状态兜底，不展示未被 Main 接受的 optimistic user message；真正的用户可见排队发送仍须独立建模。
- Renderer 发起的显式用户 `run.start` 在注册前，取消同 Conversation 中 active 或 queued 的所有 automatic continuation；取消意图沿 parent→latest child 链传播。
- 自动 continuation 不取代显式用户消息，也不能在新消息之后恢复旧 prompt。已提交 revision 和 unfinished delivery ledger 保留，新显式 Run 可通过 inspection 决定是否继续。
- 无可信 revision 进展时，单工具连续 invalid input 从四次收紧为两次，跨工具 recoverable failure 从八次收紧为四次；达到阈值进入明确 terminal failure，不再继续 provider 空转。
- Provider first-response、idle 和 total timeout 本次不改。实测根因是错误恢复与排队语义，不能用更短固定 timeout 掩盖健康的长模型请求。

## 后果

- 用户新消息具有明确优先级，旧自动恢复不会在后台追上来覆盖画布。
- session lock 继续保证 journal 顺序，但不再被当作产品级队列策略。
- Renderer 本地活动状态短暂丢失时，Main 仍阻止第二个显式 Run；拒绝后输入内容保留，假用户消息移除，原 Run 的 Stop 状态由 Global Task 恢复。
- 模型协议能力差时更早停止并保留有效 revision；用户看到明确 partial/error 终态，而不是几十分钟重复报错。
- 后续若支持真正的“排队发送”，必须作为用户可见队列显式建模，不能复用 automatic continuation。

## 验证

- scheduler 对显式 Run 返回并取消同 Conversation automatic run IDs，其他 Conversation 不受影响；
- scheduler/Main admission 拒绝同 Conversation 的第二个显式 Run，旧 Run terminal 后同一消息可正常启动；
- queued continuation 在进入 Provider 前可取消，active continuation 收到 `run.cancel`；
- 两次同工具 invalid input 与四次跨工具无 revision failure 触发 terminal circuit；可信 revision 后 circuit 清零；
- 固定 benchmark 记录 provider attempts、T0/T1/T2、run terminal 与 preserved revision。
