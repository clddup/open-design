# ADR-0313：已满足的布局操作不使编辑批次失败

- 状态：Accepted
- 日期：2026-09-06
- 关联：ADR-0302、ADR-0306、ADR-0312

## 决策

统一 Edit Design 中，布局 planner 已明确返回 `no-op` 表示请求已满足时，记录该 entry 的 `changed:false` 并继续后续操作，不把它升级成参数或设计失败。

整批只有无变化布局时，返回当前 observedRevision 和 `changed:false`，不创建 DesignTransaction revision、committedSteps 或 undo。整批仍有有效修改时，保持既有全部预览后一次提交、一次 undo。

仅识别 planner 的结构化 no-op code，不解析 message，也不自动修复任意非法输入。锁定、越界、节点缺失、无效选择、循环等错误仍导致整批失败。取消和 Main 内部 preservedFrames 的最终状态检查仍在返回或提交前执行。

## 验证

覆盖无变化单独调用、无变化步骤位于有效修改前/后、真实移动→对齐→再次相同对齐，以及无变化后出现无效步骤时不提交前缀。确认无变化不制造文档/历史变化；锁定或缺失节点仍拒绝。

本次只处理统一编辑的布局 no-op，不宣称所有专用工具的幂等语义已统一，也不改变真实 Plan 步骤的完成条件。
