# ADR-0047：持久交付账本驱动的有界 Run 自动续跑

> 2026-09-01 修订：错误终态的自动续跑已由 ADR-0238 取代。Provider、模型或工具错误只结束当前 Run，保留已提交 revision 与 Conversation 历史，并立即允许下一条用户消息创建干净 Run；自动 continuation 仅保留给正常完成但交付未完成或单 Run budget 用尽的情况。

- 状态：Accepted
- 日期：2026-08-13
- 文档协议：不变（`DesignDocument 1.11.0`）
- Agent 协议：`3.9.0`
- 关联：ADR-0006、ADR-0008、ADR-0030、ADR-0043

## 背景

一个设计请求可能已经建立 typed plan 和持久交付账本，却在所有 target verified 前因为 Provider timeout、单 Run budget 或模型错误完成声明而结束。UI 的 `N/M verified` 只能投影事实，不能保证任务继续。要求用户反复发送“继续”还会创建没有稳定恢复 provenance 的新 Run，并放大模型把已生成图片或计划误报为画布成品的风险。

本机可重放日志显示一种决定性失败：文档 revision 始终未变化，Frame 创建事务连续校验失败，`place_image` 因计划 Frame 不存在而失败；后续 Run 只 inspect 到空 Page，却仍输出“设计已完成”。模型文本是不可信数据，不能作为设计完成事实。

## 决策

### Main 拥有 Run 轮换

Main 记录每个 `run.start` 的稳定请求身份、最近一次可信 `delivery/unfinishedDelivery` 和结构化失败。Run terminal 到达时，只要账本仍有未 verified target：

- `budget`，以及 stop reason 为 `complete` 但账本未完成，都会自动创建下一 Run；错误终态不自动创建下一 Run；
- 新 Run 读取 ProjectHost 当前权威 document revision，不复用旧 revision 或 Renderer 选区；
- mutation target、Conversation、模型选择和稳定 target/Page/Frame 身份保持不变；
- 自动 prompt 只要求 inspect 当前文档与恢复首个未完成 target，不要求用户发送“继续”。

每条 continuation 记录 `parentRunId`、`rootRunId`、`attempt`、固定 `maxAttempts=3` 和原因。用户取消或错误终态不续跑；三次自动续跑耗尽进入 `needs_attention`。这是一条有界交付链，不是无限 Agent 循环。

同一 Main 生命周期内，`scheduled` 事件必须在清理父 Run 前把已经接受的完整 Plan state、delivery ledger 和已生成 raster role 绑定转移到 `nextRunId`。下一 Run 创建 Global Task 时直接持有同一 ledger，首次权威 inspection 只负责按当前 revision 对账；模型可以从首个未完成 target 继续 material transaction，不需要重新生成整份 Plan，也不能因为新 Run namespace 而丢弃 ledger 中明确保留的 stable/reserved ID。若应用进程已经重启，内存 Plan 不再存在，则仍以持久 ledger + 当前 inspection 走显式 Plan 恢复，不伪造旧内存状态。

用户取消意图在 Main 收到 `run.cancel` 时立即生效，而不等待 Agent Runtime 发布 terminal。若 continuation 已经 scheduled 但尚未完成文档读取或 Run 注册，Main 必须阻止该 Run 启动并投影 `cancelled` terminal；取消后的 Provider retry/recovered 事件不得重新显示活动状态。这样 Stop 终止的是整条当前恢复链，而不是只尝试终止一个可能已经结束的 utility-process Run。

### 持久与可见状态分离

continuation provenance 进入下一 Run 的 `run.state` journal，重启后可解释来源。`run.continuation` 是 Main 到 Renderer 的瞬时调度状态：Renderer 将 `nextRunId` 绑定到同一 Conversation，并在旧 Run terminal 与新 Run started 之间保留 Design File 资源和活动反馈。

自动 continuation prompt 在 durable timeline 中投影为可信 system work，不显示成用户消息。`N/M verified` 继续只表达账本进度；任务是否正在续跑由明确的 continuation 状态表达。模型 assistant 文本仍可展示，但系统“完成”只由 verified ledger 和 revision 证据决定。

### 完成门禁

completion guard 同时读取当前 Run 的 `delivery` 与恢复 inspection 的 `unfinishedDelivery`。只有 plan、图片生成或失败工具而没有成功 material write 时，不能宣称设计完成。宿主会要求有效 typed transaction 推进 document revision；若同 Run 门禁重试耗尽，Main 再按持久账本轮换 Run。

`unfinishedDelivery` 只是恢复上下文，不自动让后续任意用户请求继承所有旧 target 状态。新 Plan 只有在保留至少一个相同 `targetId/pageId/frameId` 的未完成 target 时才按 continuation 恢复整条 ledger；若新 Plan 只重构一个已 verified artboard，则该 target 必须重新进入 `drafted`，不能在首次材料写入前报 `delivery_already_verified`。

## 验证

- incomplete + budget 自动创建下一 Run，保留 root provenance；
- stop reason 为 complete 但 target 未 verified 仍自动续跑；
- Provider error 保留文件引用直到当前 Run terminal，随后释放运行 lease；下一条用户消息可在同一 Conversation 创建新 Run；
- cancellation、fully verified ledger 不续跑；
- 错误终态不自动发起新 Run，第四次正常交付续跑请求进入 `needs_attention`；
- continuation prompt 在 durable timeline 中是 system work，不冒充用户输入；
- 只有 inspect + plan、没有成功 material write 时 completion guard 拒绝完成；
- Agent 协议严格要求 scheduled continuation 带 `nextRunId`。
- scheduled continuation 在父 Run 清理前把 accepted Plan/ledger 转移到 `nextRunId`，下一 Run 无需重规划即可继续分配或写入；
- 显式新 Plan 只包含旧 verified target 时会重新打开 draft，而保留旧 incomplete target 时继续恢复 ledger。

## 后果与复审

该决策消除“点继续才能推进”和空画布假完成，但不会自动降低 Provider/tool/capture/review 的耗时，也不把 skeleton 变成真实设计步骤。首个可用页面时间、真实 Frame 预分配、语义事务 Timeline、checkpoint 频率和固定 delay 仍按 roadmap 的独立性能切片测量和实现。

如果后续引入跨文件 target、可编辑 continuation policy 或无限后台任务，应替代本 ADR；不得通过提高固定 3 次上限悄悄扩大执行范围。
