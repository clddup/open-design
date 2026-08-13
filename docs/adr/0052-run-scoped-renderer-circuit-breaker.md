# ADR-0052：Run 级 Renderer 设计工具熔断

- 状态：已接受
- 日期：2026-08-13
- 文档协议：不变（`DesignDocument 1.12.0`）
- Agent 协议：不变（3.8）
- 关联：ADR-0030、ADR-0047、ADR-0049、ADR-0050

## 背景

Renderer 设计工具已经用首响应、活动空闲和总时限区分画布故障与 Provider timeout，但单次 `renderer_idle_timeout` 仍被视为可恢复。实机异常 Run 显示，当 apply/capture 持续无法报告进度时，Agent 会反复执行“工具超时 → inspect → 模型恢复 → 下一次 apply/capture”，每次最多等待 90 秒。已经提交的 revision 会保留并继续推进，但用户长时间只看到空画板、停滞错误和恢复 cursor。

该现象不能通过缩短单次 timeout 或提示模型少重试可靠解决。Main 必须根据可信 Renderer 生命周期终止同一故障循环，同时保留已经成功提交的设计事实。

## 决策

### 只统计连续的真实画布阶段停滞

`RendererDesignToolHost` 按 `runId` 维护短生命周期 circuit。只有已进入 `applying` 或 `capturing` 阶段的 Renderer timeout 计数；首响应前失败、普通 inspect 和其他非画布阶段不计数。

一次成功的 apply/capture 清零该 Run 的连续计数。成功 inspect 不能掩盖持续 capture/apply 故障。不同 Run 相互隔离；Run 结束和应用关闭时删除状态。

### 第二次连续停滞终止当前 Run

第一次仍返回原有可恢复 `renderer_idle_timeout`。同一 Run 第二次连续停滞打开 circuit，并返回：

```text
code: renderer_circuit_open
retryable: false
recoverable: false
runTerminal: true
```

打开后，该 Run 的后续 Renderer 设计工具在发送 IPC 前立即拒绝。`runTerminal` 只存在于 Main 与 Agent Runtime 的受信工具失败契约；它不进入模型可写参数，也不扩展持久 `tool.failed` schema。

Agent Runtime 在记录本次 `tool.failed` 后停止模型循环，发布不可重试的 `agent.error`，并以 `stopReason: error` 完成 Run。completion guard 不再要求模型续写。交付账本仍未完成时，Main continuation scheduler 进入 `needs-attention / non-retryable-error`，不得自动创建替代 Run。

### 保留已提交设计并给出可信恢复说明

熔断不回滚此前成功的事务，不修改文档、history、ledger 或 revision，也不把 allocated/drafted target 冒充 verified。Timeline 的标题与详情由结构化 `renderer_circuit_open` 驱动，明确显示：

- 当前任务已停止；
- 已提交的设计 revision 均已保留；
- 重启 OpenDesign 后再尝试视觉生成。

模型文字不能覆盖该终态，也不能把任务显示为完成。

## 后果

- 相同 Renderer 故障最多再浪费一次 90 秒空闲等待，不再持续数十轮或由自动 continuation 重启循环。
- 已有可用页面和已提交步骤保持可编辑、可撤销和可保存。
- 新 Run 使用新的 circuit scope；产品文案仍建议重启，是因为本切片没有证明底层 Renderer/GPU/export 状态能在原进程内恢复。
- 本决策是止损与可信恢复，不代表 Leafer capture/apply 停滞根因已经修复，也不改变正常 Provider 串行往返造成的生成时长。底层故障定位和 1/4/12 target 性能样本继续作为独立工作。

## 验证

- 第一次 apply/capture idle timeout 保持可恢复，第二次升级为带 `runTerminal: true` 的 `renderer_circuit_open`；
- circuit 打开后不再发送 Renderer IPC，不同 Run 不受影响，`forgetRun` 后可重新执行；
- 成功 apply/capture 清零连续计数，成功 inspect 不清零；
- bridge 只接受字面量 `runTerminal: true`，拒绝 false 和额外字段；
- Agent Runtime 只发起一次 Provider turn，持久化 tool failure，发布不可重试 agent error，并以 error 终止；
- completion continuation 对未完成 ledger 返回 needs-attention，不自动续跑；
- Timeline 不显示“任务完成”，并明确已提交 revision 保留与重启恢复建议。
