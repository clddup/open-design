# ADR-0285：Figma-compatible 混合仿射多选 resize 吸附

## 状态

已接受。

## 背景

ADR-0280 已支持轴对齐对象与多选的 bounds resize 吸附，ADR-0284 又为单个旋转或倾斜对象增加完整 affine-basis resolver。但宿主仍要求多选中的每个对象都轴对齐，只要选区包含旋转、倾斜或位于仿射父级下的对象，整个 resize snap session 就会退出。

Leafer 2.2.9 的多选实现并不为不同方向的对象伪造共同旋转坐标系。`editor/simulate.ts` 将所有选中对象的 `getBounds("box", "page")` 合并为一个轴对齐 `SimulateElement`，`beforeScale` 的 direction、origin 与 scale 都基于这个真实 selection box。Figma 的公开交互同样以包围多个对象的 selection bounding box 提供批量 resize。

## 决策

1. 两个及以上 top-level 选中对象始终使用 document-space 轴对齐 selection box。边界由每个对象的完整 world transform 后 bounds 合并得出；对象可以具有不同 rotation、skew、轴缩放或 parent，不构造虚假的共同 oriented frame。
2. 单个轴对齐对象继续使用 ADR-0280 的 bounds resolver；单个非轴对齐普通对象继续使用 ADR-0284 的 oriented resolver。单个 Line endpoint 与 Grid Fill span 仍由专用路径处理，多选中的 Line 只作为整体 selection box 的一个成员参与批量缩放。
3. 多选复用既有对象、Page guide、当前可表示的轴对齐 Frame-local guide、pixel grid、`5 / zoom` 阈值与八向 handle。Shift 比例锁定、Option/Alt 中心 resize、`Control` 临时关闭对象/guide以及 viewport/revision refresh 不新增分支语义。
4. Leafer 在 `beforeScale` 写入前获得校正比例，并负责把 selection-box world transform 应用到各对象；DirectTransform 在 pointer up 从当前投影读取各自 parent-local 结果，只生成一个 DesignTransaction、revision 与 undo。
5. 本切片复用 Geometry Service contract 38，不增加文档字段、Agent tool、偏好项、contract 版本或重复校验入口。Smart guide 仍是 editor-sky disposable overlay，不进入文档、history、capture 或 export。

## 影响

- 不同 rotation/skew、嵌套层级或 parent 的普通对象可按真实多选框命中对象、Page/Frame guide 与 pixel grid。
- Shift、Option/Alt、左右 `Control`、连续 revision 与取消保持单对象/轴对齐多选的一致行为，pointer up 仍只提交一次。
- 旋转 Frame-local guide、Vector path/Bezier handle 吸附、大型文档 snapping 性能基线及 macOS/Windows 打包产品实机证据仍待后续。

## 公开语义参照

- [Figma：Select layers and objects](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects)
- [Figma：Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
