# ADR-0282：Figma-compatible Vector geometry 吸附

## 状态

已接受。

## 背景

OpenDesign 已有可编辑 Vector Network、单点与多点选择、跨层选择框变换、Bézier handle、Bend、Cut 和拓扑编辑，但拖动锚点仍完全自由。普通对象吸附不能直接复用：它按图层 bounds 的边与中心工作，而 Figma 的 `Snap to geometry` 只在 Vector edit mode 中将正在拖动的 Vector point 对齐到其他 Vector point。

如果在 pointer move 时扫描完整文档、把 path 最近点或普通对象 bounds 混入候选，不仅会偏离公开语义，也会让复杂文件的高频交互不可预测。

## 决策

1. `@opendesign/geometry-service` contract 36 增加后端无关的 Vector point snap resolver。输入为 document-space moving points、冻结并按轴排序的 target index、raw translation、像素网格开关与 `5 / zoom` 阈值；输出校正 translation、稳定命中和 smart-guide lines。
2. `Snap to geometry` 成为与 `Snap to objects`、`Snap to pixel grid` 并列的本地编辑器偏好，默认开启。它只作用于 Vector edit mode，不改变普通对象 move/resize。
3. 拖拽开始时仅从当前 Vector edit scope 收集可见、可逆 world transform 下的锚点。正在移动的锚点从 target index 排除；pointer move 只做排序索引近邻查询，不扫描 DesignDocument。
4. 单点/同层多点拖动和跨 Vector 多点 selection-box move 都在 document space 解析吸附，再把同一个 translation 共轭回各层 node-local network。旋转或缩放祖先不会退化为 world AABB。
5. `Control` 在 Vector 拖动期间临时关闭 geometry 与 pixel-grid 吸附。Geometry 关闭时仍可独立使用 pixel grid；`Snap to objects` 不参与 Vector point drag。
6. 红色 1px smart guide 复用 editor-sky overlay，viewport 变化保持屏幕尺度；pointer up、取消、scope/revision 变化或退出 Vector edit 立即清理。Preview 不进入 DesignDocument、history、capture/export。
7. Pointer up 继续复用现有 `onVectorEdit` 批量入口，只提交一个 Vector transaction/revision/undo。本切片不增加 Agent tool、文档字段或第二份可写状态。

## 影响

- 用户可像 Figma 一样把 Vector 锚点精确吸附到同一编辑 scope 中的其他锚点，并通过独立偏好或 `Control` 临时关闭。
- 候选在 drag begin 冻结并建立双轴索引，高频移动成本只与 moving point 数和附近命中有关。
- Path 最近点、Bézier handle 吸附、Pen 自动连接、Vector anchor 距离测量、旋转/倾斜普通对象定向 resize 与双平台打包产品实机证据仍按独立切片推进。

## 公开语义参照

- [Figma：Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
- [Figma：Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
