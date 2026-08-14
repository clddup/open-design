# ADR-0072：以真实 revision 为进度的有界恢复与组件质量分层

- 状态：已接受
- 日期：2026-08-15
- Agent 协议：不变（3.8）
- 文档协议：不变（`DesignDocument 1.28.0`）
- 取代：ADR-0062 中“组件策略偏差阻塞 verified”的部分决定
- 关联：ADR-0018、ADR-0049、ADR-0050、ADR-0052、ADR-0062

## 背景

本机生产 journal 的 `run_1786733759123_1` 提供了完整反例：一个 6-target UI 任务在约 46 分钟内产生 585 个事件、159 次工具请求、102 次工具失败和 20 条设计 revision。失败中包含 67 次 `invalid_tool_input`；模型还在最终 capture 时逐个收到 Component Main、Instance 或 ordinary semantic root 偏差，修复一个节点、重新 inspection/capture 后才得到下一个问题。Run 最终耗尽预算，自动续跑再运行约 8 分钟仍只推进到第二个 target。性能诊断记录 `T_plan=126.5s / T1=298.2s / T2 unavailable`；160 次 Provider 请求累计约 2,295 秒，Renderer 96 次调用累计约 150 秒，其中一次 capture stall 占约 90 秒。首画面与总时长都首先受串行 Provider/tool 往返支配，不能只继续缩短 Renderer delay。

这些失败没有持续产生新的可见设计。Timeline 虽然不断更新，画布却长时间停留在同一视觉状态。根因不是单一 Provider 延迟，而是宿主把以下不同语义放进同一阻塞恢复链：

- 文档与交付正确性：稳定 Frame/region、revision、祖先链、布局越界；
- 可维护性质量：模型声明的组件候选是否已经落实为 Main/Instance；
- 工具协议兼容：Provider 是否能稳定生成某个复杂 action union 的合法输入。

精确输入 fingerprint 只能阻止原样重放，不能阻止模型用 67 组不同错误字段探索同一 schema。Renderer timeout circuit 也只覆盖画布阶段停滞，不能覆盖 Provider/tool 恢复无进展。

## 决策

### 正确性门禁与可维护性质量分层

最终 delivery verification 继续阻塞以下错误：

- 目标 Frame、Page、region 或材料内容缺失；
- inspection/capture revision 不一致；
- 确定性布局报告存在 error；
- 目标身份、祖先链或写作用域不成立。

`DesignPlan v4 componentStrategy` 继续由模型判断 component/ordinary 候选，实际 Component/Instance 仍通过唯一 EditorRuntime 和 Component Service 写入。但是计划声明与最终 Component Main、linked Instance、ordinary Frame/Group 之间的偏差改为有界 `componentStrategy` 质量报告：一次检查全部 occurrence，返回 `checkedOccurrenceCount / issueCount / issues / blocking:false`。报告最多投影 64 条具体 issue，`issueCount` 保留完整数量。

组件偏差不再抛出逐节点 `component_strategy_incomplete`，不回退 ledger，也不阻止一个已经通过结构、布局、capture 和 review 的真实设计进入 `verified`。这不把“组件已实现”伪装成事实；capture 结果明确携带偏差，Agent prompt 要求在正常 draft/refinement 中优先落实组件，而不是在最终 capture 后启动串行元数据修复。

### 恢复进度以可信 revision 衡量

Agent Runtime 在现有 exact-input/fingerprint 抑制之外增加 Run-scoped progress circuit：

- 同一工具连续 4 次 `invalid_tool_input`，期间没有成功设计 revision，终止 Run 为 `tool_protocol_no_progress`；
- 任意工具累计 8 次可恢复失败，期间没有成功设计 revision，终止 Run 为 `design_recovery_no_progress`；
- 成功 inspection 可以解除 inspection-required 门禁，但不算用户可见设计进度，也不重置跨工具失败总量；
- 任一可信 `designRevision` 前进后清零计数；成功工具调用会清除该工具的连续 schema 失败计数；
- 用户取消、既有 terminal failure 和不可恢复失败保持原语义，不被重新分类。

两个新终态均为 `retryable:false / recoverable:false / runTerminal:true`。Agent 必须停止当前模型循环，保留已经提交的 revision；Main continuation 不得把同一无进展恢复自动续跑成后台长任务。

### 首个真实内容优先于巨大整页输入

现有 Pi tools 已固定为 sequential execution，且每个成功工具会在同一 assistant turn 内推进后续工具使用的可信 revision。System prompt 因此明确允许两组不依赖未知返回 ID 的有序调用共用一次 Provider 回合：

- `define_design_plan →` 当前 target 的首个 `apply_transaction`；
- 已读取 capture 图像后的 `record_visual_review →` 对应该 review 的 refinement transaction。

跨 approval、inspection、capture 图像读取、失败前置或必须消费上一结果字段的调用不得盲目合并。

首个 material apply 应优先提交一个最小但有意义的真实 region/vertical slice，随后再用独立真实事务补齐 target。一个巨大 apply 内的 semantic steps 只能在完整 tool input 到达后逐 revision 展示，不能缩短 Provider 仍在生成整页 JSON 时的 `T1`；因此不得把整页巨大 payload 冒充“渐进生成”。此项是调度与提示契约，不声称已经实现流式半事务解析。

### 时间线继续只投影真实设计步骤

ADR-0049/0050 和当前 Timeline 的规则不变：设计步骤来自成功提交的 semantic revision。后面仍有工具调用的中间 assistant prose 不冒充完成结果；组件元数据 revision 只显示组件定义更新。进度 circuit 的 terminal failure 是可信产品状态，不包装成模型完成文案。

## 后果

- 最基本设计不会因组件元数据不完整而在最终阶段停留数十轮；用户优先得到可见、可编辑、可保存的交付。
- 支持组件工具的模型仍可在正常生成中创建真实 Main/Instance，偏差报告为后续质量提升提供确定性证据。
- 不支持复杂工具契约的 Provider 会在 4 次同工具 schema 失败内明确停止，而不是显示几十条设计思考；这不会把 text-compatible Provider 误报成 Agent-compatible。
- 支持单回合多 tool call 的 Provider 可以减少 Plan→draft 和 review→refinement 的空等；只会单次调用的 Provider 仍保持正确但不会获得该项延迟收益。
- `verified` 表示结构、布局、视觉审查和 revision 链通过，不再隐含“所有模型计划的组件建议均已落实”。组件质量必须读取同一 capture 的 `componentStrategy` 报告。
- 后续若要把组件完整性重新提升为阻塞项，必须先提供原子批量 materialization 或同等的宿主执行能力，并用 1/4/12-target 实机样本证明不会恢复为串行模型修复。

## 验证

- Component Main、Instance 和 ordinary root 的多项偏差一次返回，`blocking:false`，结构正确的 target 仍可 verified；
- 完整组件策略返回零 issue；
- 同工具四组不同非法输入不会执行第 5 轮，并以 `tool_protocol_no_progress` 收口；
- 八个跨工具可恢复失败且无 revision 以 `design_recovery_no_progress` 收口；
- inspection 不重置无进展总量，真实 revision 会重置；
- 同一 assistant turn 的两次 sequential design tool execution 分别接收 revision `12` 与 `13`，并提交 revision `13` 与 `14`；
- 既有 layout/structure/revision 错误继续阻塞，已提交 revision 不回滚。
