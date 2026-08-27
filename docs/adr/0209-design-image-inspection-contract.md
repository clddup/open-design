# ADR-0209：Design Image Inspection 单一契约

## 状态

已接受。

## 背景

`inspect_document` 会向模型投影当前 Page 引用的图片、Design File 中由 Agent 生成但尚未放置的图片，以及这些图片的来源派生关系。该投影决定后续 Run 能否继续使用稳定 `assetId`，但此前资产收集、派生族展开、metadata 裁剪和截断判断全部内联在巨型 Renderer tool executor 中；Main 的 inspection Contract 只把这些字段当作不透明附加数据。

这意味着图片元数据没有独立 executable Schema，map identity、canonical operation、source/result/mask/reference 关系与生成资产可用性无法在同一边界得到准确字段路径。若未来修改投影，仍可能重新泄漏 data URI、外部 URI 或本地来源字段。

## 决策

1. Desktop shared 层唯一拥有 `DesignImageInspectionSchema/Contract`，结构只包含无源字节的 image asset metadata、有界 derivation 摘要和截断事实。
2. `sourceType`、asset size 与 derivation operation 直接组合 `@opendesign/design-contracts` 的 canonical Schema；不复制图片操作枚举。
3. Schema 拒绝 `source/value/uri/path` 等额外字段。Domain refinement 只处理 asset map identity、derivation ID 唯一、source/result/mask/reference 可解析、result 不复用为输入，以及 generated/design-file/designRole metadata 关系。
4. Renderer 将投影算法移入独立 `createScopedImageInspection()`：先收集当前 scope 的 Image node 与 image Paint，再加入最近的 Design File staged image，复用 EditorRuntime 的 image family 索引展开 source/result 族；返回的 derivation 额外携带其 mask/reference metadata，但不携带任何源内容。
5. Derivation 继续保持 64 条上限；`truncated=true` 时必须填满该预算。当前布尔事实足以表达有更多结果，不新增无消费方的 total count。
6. Design Inspection Hierarchy Contract 直接组合该 Schema，并复用同一 Contract 的 domain issues；Main 不再把图片字段视为无类型附加数据。

## 结果

- 后续 Conversation/Run 可以从同一 inspection 中读取可验证的稳定 `assetId` 与完整返回派生关系，不复用历史 attachment 权限。
- data URI、外部 URI、本地路径和扩展值不会进入模型工具结果；图片像素仍通过受控 read/capture 边界获取。
- `design-tool-execution.ts` 删除图片 inspection 的内联结构与遍历，图片投影、结构契约和 Main hierarchy 关联各有单一 owner。
- 不增加 Provider 工具、模型回合、兼容路径、hash 或仓库数量门禁。

## 验证

- 当前 scope、跨 Run staged asset 与 source/result/mask/reference family 投影；
- source payload 不进入 inspection；
- 65 条派生链返回 64 条并明确 truncated；
- asset map identity、缺失引用、非法 canonical operation 和额外 source 字段返回准确嵌套 path；
- Design Inspection Hierarchy、Renderer design-tool execution 与 Desktop typecheck/build 回归。
