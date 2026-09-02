# ADR-0294：Figma-compatible Vector Bézier handle 吸附

## 状态

已接受并实现。

## 背景

OpenDesign 已有独立 `Snap to geometry` 偏好、Vector 锚点吸附、Bézier handle 拖动和跨仿射层级的 document/local 坐标转换，但拖动 handle 时仍完全自由。结果是用户可以精确对齐锚点，却不能用同一编辑心智把控制柄端点对齐到锚点或当前可见的其他控制柄。

Figma 的公开说明把 `Snap to geometry` 限定在 Vector edit mode，并规定 `Control` 可临时关闭 geometry 与 pixel-grid 吸附；Bézier handle 仍属于同一 Vector edit 直接操作，而不是独立文档工具。

公开行为参考：

- <https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions>
- <https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>

## 决策

1. Handle drag 复用现有 `VectorGeometrySnapController`、双轴 target index、`5 / zoom` 阈值、pixel-grid fallback 与红色 smart guide，不新增吸附偏好或第二套 resolver。
2. Drag begin 冻结当前 Vector edit scope 的全部锚点，以及当前选中节点实际显示的 Bézier handle 端点。未显示的 handle 不成为不可见磁性目标，正在拖动的 handle 从候选中排除。
3. Pointer move 只查询冻结索引。吸附在 document space 求解，再把校正 translation 通过当前可逆 world transform 共轭回目标 Vector 的 node-local handle offset；旋转、缩放或倾斜祖先不退化为 world AABB。
4. `Control` 临时关闭 geometry 与 pixel-grid 吸附；关闭独立 `Snap to geometry` 后仍可按既有偏好使用 pixel grid。`Snap to objects` 不参与 Vector handle drag。
5. Preview 与 smart guide 保持 session-only；pointer up、取消、scope/revision 变化或退出编辑会清理。成功手势继续通过既有 `onVectorEdit` 入口产生一次 transaction/revision/undo。
6. 本切片不增加 DesignDocument 字段、Geometry Service 公共版本、Agent tool 或新工具栏入口。Agent 继续通过现有稳定 Vector 语义编辑，不模拟指针级 handle 吸附。

## 验证

- Controller：document-space 仿射目标、锚点与可见 handle 候选、moving handle 排除、双轴命中、viewport 阈值和 `Control` 抑制沿用既有 resolver 测试。
- Leafer Adapter：拖动 mirrored handle 可吸附到可见锚点，preview 期间零提交，pointer up 只提交一次，另一侧 handle 按既有 mirroring 语义更新，smart guide 随手势清理。
- 回归：普通锚点单选/多选吸附候选保持仅锚点，不因本切片吸附到不可见 handle。

## 非目标

- 把锚点拖动改为吸附到 handle。
- path 最近点、Bézier handle 距离测量或 Pen hover 路径吸附。
- 为吸附 overlay 创建持久节点、历史记录或 Agent 专用动作。
