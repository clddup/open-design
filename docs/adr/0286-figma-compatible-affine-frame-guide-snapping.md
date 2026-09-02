# ADR-0286：Figma-compatible 仿射 Frame 手工参考线吸附

## 状态

已接受。

## 背景

ADR-0277 已把 Page 与 Frame-local 手工参考线作为正式文档事实；ADR-0278、ADR-0280、ADR-0284 与 ADR-0285 又分别完成普通 move、轴向 resize、单对象仿射 resize 与混合仿射多选 resize。但现有 target builder 只把 world-space 水平或垂直参考线加入吸附索引。Frame 旋转、倾斜或经过非均匀仿射父级后，Canvas 会正确绘制斜向参考线，吸附层却直接丢弃它，视觉事实与交互事实不一致。

Figma 公开帮助将 Page/Frame ruler guides 与 Layout Guides 分开：手工参考线可属于 Frame，并随 Frame 建立局部定位关系；旋转 Frame 不显示 Layout Guides 的限制不能套用到 ruler guide。

## 决策

1. Geometry Service contract 39 增加后端无关的 directional snapping：任意直线以 document-space `start/end` 表达，索引按规范化法向分组并按法向 offset 排序。pointer move 只对各方向组做二分近邻查询，不对全部参考线做两两组合。
2. move 使用真实 selection frame。单线命中只沿法向修正；两条非平行线可联立得到二维 translation。不同方向的 Page/object 轴向 target 可作为第二约束，但只有命中本次旋转/倾斜 Frame guide 的候选才能接管既有 resolver。
3. resize 使用当前活动 handle 对 `scaleX/scaleY` 的完整 affine derivative。边、自由 corner、Shift/对象比例锁定与 Option/Alt 中心 resize 分别按实际自由度求解；不可逆 Frame、翻转、零长度 guide、非法数值与超阈值候选失败开放。
4. 轴向 Page guide、对象、pixel grid 与轴对齐 Frame guide继续使用现有排序索引和 resolver。`Control` 仍关闭对象/guide 但保留 pixel grid；viewport/revision refresh 重建定向索引，取消和 correction removal 不改变。
5. 斜向命中输出显式 segment smart guide；Leafer editor-sky overlay 按 document transform 绘制并保持屏幕 1 px，不进入文档、history、capture 或 export。pointer up 继续只形成一个既有 DirectTransform transaction、revision 与 undo。
6. 不增加文档字段、Agent tool、用户模式、独立偏好或重复 Runtime 校验入口。

## 影响

- 旋转、倾斜、非均匀缩放或嵌套仿射 Frame 内的普通图层可 move/resize 吸附到视觉上真实存在的 Frame-local 手工参考线。
- Page guide、轴向 Frame guide、对象、pixel grid、混合仿射多选、Grid span、Line endpoint 与 Vector 专用路径不改变。
- Path/Bézier handle 吸附、大型文档真实性能基线及 macOS/Windows 打包产品交互证据仍待后续。

## 公开语义参照

- [Figma：Add guides to the canvas or frames](https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames)
- [Figma：Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
