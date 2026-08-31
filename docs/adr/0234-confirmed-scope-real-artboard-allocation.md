# ADR-0234：确认完整交付范围时一次分配全部真实画板

- 状态：Accepted
- 日期：2026-08-31
- DesignDocument：不变
- 关联：ADR-0050、ADR-0148、ADR-0151、ADR-0160、ADR-0230

## 背景

长任务已经把完整 Delivery Scope 与滚动 executable Plan 分开，避免 12–24 个 target 的详细几何一次进入 Provider 上下文。但确认 Scope 后仍要等待模型生成首个 target 的 first-slice，用户在这段时间只能看到对话和计划，没有任何真实画布变化。

ADR-0050 已证明 `allocated` Frame 能作为真实、可编辑、可撤销的 T0；它原先由完整 executable Plan 一次分配全部 roots。滚动 Plan 改为一次只包含当前 target 后，其他确认 target 已不在当前 Plan 中，原有分配时机无法再实现“先看到整套真实画板”。

## 决策

### Scope 明确画板尺寸

每个确认 target 同时声明其真实 `width/height`。它仍只表达交付范围和画板规格，不包含 Region、图层、组件或视觉几何。

### 用户确认后立即原子分配

`opendesign_review_delivery_scope` 经用户一次确认后，由 Main 根据当前 inspection 和 Run 节点命名空间计算全部 Frame 的稳定 ID 与不重叠网格位置，并通过既有 Renderer、唯一 EditorRuntime、history 与 autosave 链执行一次 atomic transaction：

- 全部 roots 位于当前 Page，不因 target 数量创建 Document Page；
- 全部 roots 一次成功、一个 revision、一个 undo entry；
- 任一写入失败时不记录 confirmed Scope 或 allocation ledger；
- Frame 是真实文档内容，不是 skeleton、overlay 或 reveal 动画；
- 空 Frame 只进入 `allocated`，不能被当作 drafted、captured 或 verified。

因此 scope review 是明确的 `design_write` 审批，而不再是只读确认。拒绝仍保持零写入并终止当前 Run。

### 滚动 Plan 使用宿主拥有的现有画板

Main 在 `deliveryStage.nextTarget.artboard` 返回 `pageId/frameId/position/size/allocatedRevision`。后续 first-slice 或普通 Plan 即使提交了猜测值，也由 Main 绑定到该稳定 existing Frame；模型不得重复创建、重命名或移动 root。

当前 target 完成并验证后才推进下一滚动 Plan。其他已分配空 Frame 不构成跨 target 材料写入许可，也不增加逐 target 人为 delay、capture 或 Critic。

### 生命周期与恢复

Scope、allocation map 和当前 Plan 在自动 continuation 时一起转移；完成、取消、中断或 needs-attention 清理对应 Run 内存状态。持久 Global Task 在 Plan 尚未建立时保存 allocated ledger，使 T0 可观测；Plan 建立后继续使用现有滚动 delivery state。

## 取代与澄清

- 取代 ADR-0050 中“必须等 executable Plan 接受后才分配全部 create roots”的时机；原子事务、`allocated` 语义、整体撤销与真实 revision 要求保留。
- 扩展 ADR-0148：用户确认的动作现在同时接受交付范围并创建确认卡中列出的真实空画板，不授予 Page、文件、网络或其他 capability。
- 保留 ADR-0160：完整 Scope 与当前滚动 Plan 仍是不同事实；预分配 Frame 不等于提前生成全部 target 的详细 Plan 或材料内容。

## 验证

- 12 个 target 在现有 Page roots 右侧生成使用 Run prefix 的不重叠 Frame；Renderer 只收到一次 atomic apply。
- allocation 成功后 ledger 全部为 `allocated`，completion guard 先要求建立 `deliveryStage.nextTarget` 的 executable Plan，而不是把空 Frame 当作可直接完成的草稿。
- next target 暴露稳定 host-owned artboard，first-slice 复用该 Frame，不重复插入 root。
- scope approval 的风险为 `design_write`，拒绝零写入；成功后一次 undo 可删除全部预分配 roots。
- 自动 continuation 转移 Scope 与 allocations；所有终态清理对应内存状态。
