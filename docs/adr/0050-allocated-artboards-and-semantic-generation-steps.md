# ADR-0050：真实画板分配、首目标优先与语义生成步骤

- 状态：已接受
- 日期：2026-08-13
- 文档协议：不变（`DesignDocument 1.11.0`）
- Workspace 交付账本：`DesignDeliveryLedger v2`
- Agent 协议：不变（3.8）
- 取代：ADR-0018 的 `pending → drafted` 初始状态、ADR-0028 的机械 progressive batch、ADR-0049 中尚未实现的真实根分配
- 关联：ADR-0018、ADR-0028、ADR-0047、ADR-0049

## 背景

用户以“多久看到第一个真实可用页面”判断生成体验。旧链路在 Plan 后仍等待模型提交同时包含 Frame、Region 和材料内容的大事务；多 target 可以在一笔事务中同时起草，固定 1/3 条命令的 progressive batch 又把命令数量伪装成设计过程。紫色 skeleton 已在 ADR-0049 撤销，但没有真实根分配时，Plan 到首个 revision 之间仍然没有可信画布变化，图片放置也可能先于 Frame 创建而失败。

专业设计平台把 Frame 作为真实的设计容器，而不是等待动画。Figma 的 Frame 同样承载图层、布局、约束和原型；Section 负责更高层组织。OpenDesign 因此先强化自有 Frame、事务、revision 和恢复语义，不复制第三方私有状态，也不以 Section 或 Auto Layout 尚未完成为由继续保留假骨架。

## 决策

### Plan 接受后原子分配真实根

Main 验证当前 `DesignPlan v4`（以及历史兼容 v3）后，立即为所有 `artboard.mode=create` target 编译 Page-root Frame insert，并通过现有 Renderer tool host、Preload、唯一 `EditorRuntime` 和 autosave 链执行一次内部原子事务。分配事务只创建稳定 Frame，不创建 Region 或垃圾 Group；全部 Frame 一次成功、一个 revision、一个 undo entry，任一命令失败则 ledger 保持 pending。v4 的组件策略与最终验证由 ADR-0062 定义，不改变本 ADR 的根分配事务。

Plan 工具结果携带这次 `designRevision`，Agent 下一轮从新 revision 继续。模型若仍重复提交同 ID Frame，Main 只删除冗余 Frame insert并保留真实子层命令；只有重复 Frame 而无材料内容时返回明确恢复错误。

### Ledger v2 的 allocated 状态

交付状态改为：

```text
pending → allocated → drafted → captured → reviewed → refined → verified
```

`allocatedRevision` 证明真实 Frame 已进入权威文档。allocated 不代表首稿，不能 capture/review/verified，也不计入 `N/M verified`；首次真实材料写入才进入 drafted。持久 v1 ledger 在读取时显式升级为 v2：drafted 及后续状态以历史 `draftRevision` 补足 allocation evidence，不能把任意旧 JSON 当当前协议。

### 首目标优先

材料写入只允许当前 `activeTargetId`。多 target 可以一起分配根，但必须先完成第一个 target 的材料写入、capture、review、refinement 和 verification，才能写下一个 target。图片、SVG、层级、排列、向量、组件和普通 apply 共用该门禁；分配事务不是材料写入，不受该限制。

全部 verified 后继续修改必须先 amendment，使受影响目标回到 drafted 并重新走审查链，不能静默修改仍显示已完成的目标。

### 语义步骤驱动真实 revision

`opendesign_apply_transaction` 增加可选 `steps[{stepId,label,commandIds}]`。所有 command ID 必须按原顺序、恰好一次覆盖 commands。Renderer 按语义步骤寻找合法前缀并提交真实 revision；若一个步骤单独不满足文档 invariant，只能与后续完整步骤合并，不能拆开语义步骤。没有 steps 的旧 Provider 整笔一次提交，不再按固定 1/3 条命令拆分。

每次 `runtime.apply` 成功后，Renderer 才通过受限 progress bridge 上送 `label + revision`。Agent Runtime 使用原有 tool progress journal/live 顺序；Timeline 为每个已提交 revision 建立独立步骤项，终态 `committedSteps` 可在刷新后重建并与 live ID 去重。cursor/reveal 继续消费同一真实 revision；没有提前播放。

### 并发、恢复与撤销

- 分配事务本身是一个可整体撤销的 history entry；后续目标材料事务保留各自撤销/恢复边界，不建立跨整个 Run 的巨型 undo。
- 同 plan 或续跑从最新 inspection 重新验证 Frame。只平移且仍是 Page root、轴对齐、尺寸一致时继续；resize、rotate、reparent、delete/undo 或错 Page 返回 `allocated_artboard_invalid` 并要求 inspect/amend。
- 分配后基于旧 revision 的纯 insert 可复用既有 planned rebase guard；覆盖写、结构漂移和跨 target 写仍冲突关闭。
- semantic stage 取消或失败继续回滚同一 history group；已完成的独立工具事务保留，并可从下一工具/Run 恢复。

## 结果

- `T0` 成为真实可测里程碑：全部 Frame 根进入文档的时间，不再是 `null` 或 skeleton 时间。
- 多页面任务在 Plan 后立即出现真实可编辑画板，并优先完成首个页面。
- “设计步骤”只对应已提交 revision，刷新后仍可重建，不是 Provider 文本或动画。
- 图片放置可以直接进入已分配 Frame，不再要求模型先正确创建 Frame。
- Provider 串行往返仍是实测主要瓶颈；本决策减少 Plan 后空等和机械 apply 等待，不声称整体速度、审美或跨平台产品 smoke 已完成。
- Section、Auto Layout、constraints、组件变体、变量、原型与多人协作能力继续按 capability/roadmap 依赖推进，不属于本切片。

## 验证

- 12 个 Frame 的内部 atomic apply：一次 revision、一次 undo，undo 后全部根消失。
- Plan handler：一次 Renderer 调用分配全部 target，并把 allocation、ledger 与 design revision 返回 Agent；失败不推进 ledger。
- Ledger v1→v2 迁移与所有 revision 顺序 invariant。
- allocated capture 不进入 review，首次材料写进入 drafted；第二 target 在第一 target verified 前拒绝。
- semantic steps 产生逐步 revision、实时 progress、durable Timeline 去重；取消回滚已提交步骤。
- 分配 Frame 仅平移可恢复，resize/delete 拒绝；planned insert rebase 继续验证真实 Page/Frame/尺寸/祖先链。
- 离屏 capture 的真实子阶段进入 progress bridge；JPEG export 30 秒硬超时清理临时 surface。stale node 越界与 material Plan amendment 冲突要求先 inspect，恢复信息明确保留稳定 target/Page/Frame/region ID，并阻止原样输入重试。
