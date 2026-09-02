# ADR-0291：Figma-compatible Pen 角度约束

- 状态：Accepted
- 日期：2026-09-03

## 背景

OpenDesign 的顶层 Pen 与 Vector Edit Pen 已能创建节点、拖拽镜像 Bézier 手柄并继续路径，但按住 `Shift` 时仍逐字采用原始指针坐标。绘制图标、Logo 和界面图形时，用户因此无法稳定得到水平、垂直和对角线段，也无法让新建手柄保持规则方向。

Figma 的公开 Pen 工作流把 `Shift` 作为直线绘制约束；其 Line 创建同样采用 45° 方向约束。OpenDesign 采用同一可预期心智，并让顶层创建与既有 Vector 编辑共享实现。

公开参考：

- <https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks>
- <https://help.figma.com/hc/en-us/articles/33990671683607-Create-a-social-media-post-using-Figma-Draw>

## 决策

1. 增加 Leafer 内部纯函数 `constrainPointToOctant(origin, point)`，保持指针距离不变，并把方向约束到最近的 45° 增量。
2. 顶层 Pen 在 `Shift` 按下时约束：
   - 相对上一节点放置的新节点；
   - 相对当前节点拖出的 mirrored handle；
   - rubber-band 与最终提交使用同一坐标。
3. Vector Edit Pen 在 `Shift` 按下时同样约束：
   - 从选中节点续画的新节点；
   - 独立 contour 的第二节点；
   - 新增、插入节点和 contour 起点的 click-drag handle。
4. 点击既有 vertex 或现有 segment 时，稳定命中几何优先于角度约束；不会为了满足 45° 而偏离用户明确命中的节点或路径。
5. 该能力只影响 session preview 和最终送入既有事务的坐标，不增加文档字段、Agent tool、可写状态或 Geometry Service 公共契约版本。

## 失败与生命周期

- 未按 `Shift` 时保持现有自由角度行为。
- Page、document、scope、tool、只读状态、取消及 callback/stale 拒绝继续沿既有 Pen 生命周期清理或恢复。
- 非有限或退化结果仍由现有 Network 校验失败关闭。

## 验证

- 纯函数覆盖最近八分圆方向、距离保持与重合点。
- Leafer 集成覆盖顶层 Pen 节点/手柄约束，以及 Vector Edit Pen 续画节点/手柄约束。
- 既有 Line 45°、Pen 创建、Vector Edit Pen 插点/续画/独立 contour 测试保持通过。

## 后续

- 顶层 Pen 直接创作多 contour/branch Vector Network。
- path-nearest-point 与 Bézier handle 的吸附和测量。
- macOS/Windows 打包产品的真实指针与键盘组合验证。
