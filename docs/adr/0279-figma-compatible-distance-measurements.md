# ADR-0279：Figma-compatible 对象距离测量

## 状态

已接受。

## 背景

OpenDesign 已通过 ADR-0277、ADR-0278 完成标尺、手工参考线与普通对象移动吸附，但用户仍无法像在 Figma 中一样，在不修改文档的情况下快速检查选区与悬停对象之间的距离。距离测量属于高频画布反馈，不应产生事务、revision、undo 记录或进入 capture/export，也不能把 Leafer 对象或描边外缘变成持久设计事实。

Figma 的公开交互是在已有选区时按住 macOS `Option` 或 Windows `Alt` 并悬停另一对象；额外按住 macOS `Command` 或 Windows `Control` 可精确进入嵌套层。分离对象显示实际存在的水平或垂直边到边距离，包含关系显示四边 inset。

## 决策

1. `@opendesign/geometry-service` contract 33 增加纯 `measureRectDistances`，只接收两个有效轴对齐 bounds。分离对象返回存在的水平/垂直距离；包含关系返回非零四边 inset；数值格式最多保留两位小数。
2. Leafer 适配器使用对象 `box/inner` bounds，经完整父级 affine transform 投影到 document space。描边外缘不参与测量；多选按去除 ancestor/descendant 重复后的 top-level selection union bounds 测量。
3. 普通 `Option/Alt` 将悬停目标提升到选区上下文中的直属对象；`Command+Option` / `Control+Alt` 使用实际命中的最深可投影对象。选区本身及其后代不能成为目标。
4. 红色 `#f24822` 线与数值标签位于统一 editor sky overlay。线宽、标签字号与标签尺寸保持屏幕尺度，不进入 DesignDocument、history、保存、capture 或 export。
5. revision、Page、选区、工具、Vector/Image 编辑状态、直接变换开始、pointer leave 与窗口 blur 都清理测量。pan/zoom 只重投影已有 overlay，不产生文档写入。
6. 本切片不增加文档字段、Agent tool、IPC 或事务类型。Guide-to-object redline、Vector anchor 距离、旋转对象的定向边测量和 macOS/Windows 打包产品实机证据继续作为后续切片，不在本 ADR 中宣称完成。

## 影响

- Select 工具下已有选区时，可通过平台标准修饰键检查对象间距和容器 inset。
- 测量计算与 Leafer 投影职责分离；Geometry Service 不持有画布或文档状态。
- 画布测量不会改变 revision，也不会污染设计交付物。

## 公开语义参照

- [Figma：Measure distances between layers](https://help.figma.com/hc/en-us/articles/360039956974-Measure-distances-between-layers)
- [Figma：Add guides to the canvas or frames](https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames)
