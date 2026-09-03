# ADR-0296：Vector path 最近点吸附

## 状态

已接受并实现。

## 背景

OpenDesign 已支持 Vector anchor 与可见 Bézier handle 的 point-to-point geometry 吸附，但拖动点或 handle 到 line/cubic 中段时仍没有几何吸附。Figma 的公开说明确认 Vector edit mode 中存在 `Snap to geometry`，并允许用 `Control` 临时关闭；公开文档没有把 path 最近点行为定义为独立契约，因此本切片是沿用同一直接编辑心智的专业扩展，不冒充 Figma 明示行为。

公开行为参考：

- <https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions>
- <https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>

## 决策

1. 继续复用 `Snap to geometry`、`VectorGeometrySnapController`、`5 / zoom` 阈值和既有 Vector 单事务提交，不增加偏好、工具栏入口、Agent tool 或文档字段。
2. Drag begin 冻结当前 Vector edit scope 的真实 line/cubic。每条曲线先以完整 world affine transform 投影到 document space，再求欧氏最近点；不得在非均匀缩放、旋转或倾斜层的 node-local space 求最近点后再变换。
3. 优先级固定为 point-to-point geometry → path 最近点 → pixel grid。Path 命中是同一曲线上的二维校正，不拆成两条来自不同目标的轴向吸附。
4. 拖动 anchor 时排除与任一 moving anchor 直接相连的 segment；拖动 handle 时排除该 handle 所属 segment，避免冻结的自身路径产生黏附。同一 Vector 的其他非 incident path 与 edit scope 中其他 Vector path 仍可作为目标。
5. 多点移动按所有 moving point 与冻结 path 的最短确定性匹配整体应用一个 translation；候选按距离、moving point ID、path target ID 与参数排序。
6. Path 命中只显示 exact point ring。Overlay 保持 session-only，`Control`、取消、pointer up、scope/revision 变化和退出编辑沿用既有清理生命周期，不进入文档、history、capture 或 export。
7. 最近点算法由 Geometry Service 的共享 directed-curve primitive 提供，Pen 插点/Cut hit 与 snapping 不再各自维护 line/cubic 最近点实现。本切片不升级公开 Geometry contract 编号。

## 验证

- Geometry：line/cubic 最近点、point/path/pixel 优先级、incident target 排除和二维 point marker。
- Controller：非均匀缩放、旋转/倾斜后的 document-space path、同层非 incident path、handle 到 path、`Control`、zoom 阈值和 session 清理。
- Leafer Adapter：pointer move 只更新预览与 ring，pointer up 通过既有 `onVectorEdit` 只提交一次并清理 overlay。

## 非目标

- Path 或 Bézier handle 距离测量。
- Pen hover 插点行为、普通对象 path snapping 或持久 geometry index。
- macOS/Windows 打包产品实机证据与大型文档 snapping 性能基线。
