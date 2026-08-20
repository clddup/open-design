# ADR-0105：跨 Run 设计身份恢复与 Design File 图片暂存

- 状态：Accepted
- 日期：2026-08-20
- Workspace 交付账本：`DesignDeliveryLedger v3`
- Design Plan：`1`（版本不变）
- 文档协议：不变
- 关联：ADR-0032、ADR-0047、ADR-0050、ADR-0104

## 背景

同一 Design File 的后续消息已经可以读取当前文档 revision，但续跑仍存在两类互相矛盾的临时边界：上一 Run 的 Plan region ID 在新 Run 中既被 amendment 稳定性规则要求保留，又被新 ID namespace 规则拒绝；图片生成结果只登记在当前 Run 的 attachment map，Run 结束后即使二进制仍在内容寻址存储中，也不能作为当前 Design File 资源继续放置。

生产记录 `run_1787191394813_5` 因此先后出现 `new_node_id_namespace_required`、`plan_amendment_invalid`、逻辑 region 尚未材料化却作为图片 parent，以及模型回抄错误 attachment ID。Run 实际把有效内容推进到后续 revision，但八次无进展恢复后终止，用户得到半成品而不是可继续编辑的旧设计。

Conversation 的组织归属不能解决这个问题。可继续写的事实必须来自当前 Run target、当前 Design File revision、持久 planned identity 和文档级 asset；不能把上一次 Run 的临时权限永久化，也不能因新消息开始就丢失已经属于设计文件的资源。

## 决策

### Ledger v3 持久保存 planned identity reservation

每个 delivery target 增加必填 `reservedNodeIds`，包含 artboard Frame、Plan regions、UI quality node IDs 和 Component strategy occurrences。target root 必须属于自己的 reservation，任意两个 target 不得预留同一节点 ID。

Plan 注册、amendment、allocation 与恢复都从当前规范化 Plan 重新生成 reservation。跨 Run 的新节点只有三种合法来源：当前 inspection 已存在的节点、当前 inspection 下发的 `newNodeIdPrefix`，或 recoverable ledger 对当前 target 精确保存的 reservation。旧 Run 前缀本身不构成权限；未预留的同前缀 ID 继续拒绝。

v1/v2 ledger 迁移到 v3 时只保留能够证明的 `rootNodeId`，不猜测旧 Plan 中未持久化的 region、quality 或 component occurrence。Plan 若在多个 target 间复用任何 reservation，注册阶段直接返回 `plan_node_ambiguous`，不能等 Global Task 持久化时报笼统 projection 错误。

逻辑 region 只有在当前 inspection 中成为 artboard 后代后才能作为图片 parent。仅出现在 Plan、但尚未材料化的 region 返回 `planned_parent_not_materialized`，错误说明真实 artboard 已存在，避免继续误报“必须先创建画板”。

### 生成图片立即成为当前 Design File asset

`generate_image` 成功后，Main 继续把二进制登记为当前 Run attachment，同时通过唯一 Renderer/EditorRuntime 事务把内容寻址的 `asset_<digest>` 写入当前 Design File。该 asset 可以零引用存在于 Assets，记录生成来源、设计 role 和固有尺寸；生成本身不插入可见节点，也不推进 delivery 的 material 状态。

纯新增 `put_asset` 可以在图片生成期间发生无关用户 revision 时安全 rebase，但只能新增当前不存在的 asset ID；不能在 stale context 下覆盖已有 asset。事务仍产生 revision、history、autosave 和可撤销事实。

当前 Design File inspection 除当前 Page 已引用 assets 外，还返回有界的 generated staged asset metadata，不返回 data URI。后续 Conversation/Run 使用稳定 `assetId` 和显式尺寸调用 `place_image`；当前 Run 用户附件或生成结果仍可使用 `attachmentId`。两种来源必须二选一：临时本地路径、URL 与附件授权继续 Run-scoped，不能因暂存能力变成任意文件读取后门。

跨 Design File 仍需显式导入或后续 Library 能力；Conversation 的 `originProjectId/filedProjectId` 不授予 asset 或写权限。

### 有界修复错误与图片句柄纠错

模型提交错误 attachment ID 时，只有当前 Run、相同 role 恰好存在一个生成结果才由宿主解析到真实 ID；多个候选返回 `image_attachment_ambiguous`，role 不同继续拒绝。用户明确授权的 attachment 优先于该 fallback，不能被生成结果替换。

namespace、planned parent 与 attachment ambiguity 属于模型可恢复的内部工具状态。Timeline 不重复渲染红色产品错误，但 durable journal 保留完整失败；同一恢复链继续受 no-progress 上限约束。

## 后果

- 同一 Design File 的后续消息可以继续材料化上一 Run 已计划的稳定 region，也可以直接复用以前生成但尚未放置的图片。
- 已提交节点和图片资产继续属于唯一 DesignDocument；Run 只拥有临时来源授权和本轮生成映射。
- ledger v3 增加少量持久状态，但避免从旧前缀、Conversation 归属或模型文本猜测身份。
- 图片生成会增加一个无可见画布节点的 asset revision；它是用户可在 Assets 中看到、保存和撤销的真实文件状态，不得计作“首稿完成”。
- 本决策不解决 Provider 延迟、视觉审美或所有图层构图错误。透明 Frame 的 Leafer 增量投影必须清除为 `fill: null`；不透明 sibling 遮挡仍由 exact-revision layout quality 和视觉审查处理。

## 验证

- v1/v2→v3 迁移、root membership、target 间 reservation 唯一性与 revision invariant；
- material amendment 后 reservation 更新，跨 Run 精确预留旧 ID 可写，未预留旧 ID 仍返回 namespace 错误；
- 逻辑未材料化 parent 返回精确恢复错误；
- 错误 attachment ID 的唯一同 role 解析、多候选拒绝、role 不匹配拒绝和用户附件优先；
- stale revision 上纯新增 generated asset 保留用户编辑并成功写入，stale 覆盖已有 asset 拒绝；
- inspection 返回有界 Design File asset metadata，`place_image` 对 attachmentId/assetId 强制二选一；
- Leafer 增量同步把 Frame 从 opaque fills 改为空 fills 后真实 element surface 清为 `null`。
