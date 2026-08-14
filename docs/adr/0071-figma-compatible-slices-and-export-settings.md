# ADR-0071：Figma-compatible Slice 与 Export Settings Core v1

- 状态：已接受
- 日期：2026-08-15
- 文档协议：`DesignDocument 1.28.0`
- 关联：ADR-0009、ADR-0015、ADR-0045、ADR-0070

## 背景

OpenDesign 已能临时导出当前选区，但节点不能持久保存多条交付配置，也没有 Figma 语义中的 Slice。继续在 Renderer 保存一份临时导出表会绕过文档 revision、history、Agent 与格式互操作边界。

## 决策

`DesignDocument 1.28.0` 为每个 Scene node 增加有序 `exportSettings`，并增加无子节点的正式 `slice` leaf。配置采用 Figma 公开 Plugin API 的 PNG/JPG/SVG/PDF、suffix、contentsOnly、useAbsoluteBounds、colorProfile、图片 SCALE/WIDTH/HEIGHT 约束与 SVG 选项；WEBP 明确标记为 OpenDesign 扩展。

Slice 是权威、透明、可选择和可变换的文档节点。虚线边界由 Leafer editor overlay 投影，不进入文档、history、capture 或 export。Slice 位图导出复用唯一 Leafer 导出器的 `slice` 裁切语义，不建立第二份画布或导出状态。

Human 与 Agent 都通过正式 `insert_element` / `update_properties` 事务创建 Slice、原子替换有序配置。配置执行先经过统一 capability planner；当前不能保真的 PDF、Display P3、SVG outline/crop 等组合返回明确 `unsupported`，不得静默改成 PNG、sRGB 或普通节点导出。

旧文档迁移时为每个节点补空数组。`1.28.0` 文档缺失字段时严格拒绝。Slice 与配置跟随 save/reopen、diff、undo/redo 和 Figma interop；远程 Library 与批量目录授权不属于本切片。

## 后果

导出意图成为 OpenDesign 自有的版本化设计事实，Slice 与普通节点共享唯一事务和渲染链。代价是所有节点生产边界必须提供 `exportSettings`，所有节点穷举必须认识 Slice；这些变化集中在协议、planner 和投影层，不散落为格式兼容判断。

参考：

- https://developers.figma.com/docs/plugins/api/SliceNode/
- https://developers.figma.com/docs/plugins/api/ExportSettings/
- https://developers.figma.com/docs/rest-api/file-node-types/
