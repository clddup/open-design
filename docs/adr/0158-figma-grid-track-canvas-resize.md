# ADR-0158：Figma-compatible Grid 画布轨道尺寸编辑

- 状态：Accepted
- 日期：2026-08-25
- DesignDocument：不变（`1.47.0`）
- Layout Service：不变（contract `11`）
- 扩展：ADR-0091、ADR-0092、ADR-0093、ADR-0156

## 背景

OpenDesign 已能通过 Inspector 编辑 Grid 的 Fixed、Fill 与 Hug 轨道，也能在画布上按权威求解几何重排行列，但调整轨道尺寸仍需要离开画布。Figma 的 Grid Auto Layout 既允许拖动行或列的边缘，也允许单击轨道标签就地修改尺寸类型和数值；无论轨道原先是 Fixed、Fill 还是 Hug，手动拖动都会把该轨道改为对应像素值的 Fixed 轨道。

轨道缩放不能直接改 child 坐标，也不能在 pointer move 时持续写入文档。轨道与所有受影响 child 的最终几何仍必须由 Layout Service 和唯一 EditorRuntime 从 Grid 语义重新求解。

## 决策

### 画布交互

当单个、未锁定、轴对齐且行列总数不超过 512 的 Grid Frame 在 Select 工具下被选中时，既有 Grid editor sky 为每条可见行列轨道增加远端边缘命中区：

- 列使用 `col-resize`，行使用 `row-resize`；
- 命中宽度保持固定屏幕尺寸，不随 zoom 变细；
- 拖动时只显示当前目标边缘和 `px` 数值预览；
- 3 个屏幕像素以内按标签单击处理并打开输入，不直接产生写入；
- 轨道抓手、命中区、预览线和标签均为 disposable overlay，不进入 document、history、save、capture 或 export。

本切片复用 Layout Service 已求得的真实轨道起点和尺寸。拖动值按 Frame-local 1 px 取整，并遵守 `GridTrack` 当前的 `0...1_000_000` 像素契约。

### 标签输入

单击顶部或左侧编号标签，在点击位置附近打开紧凑 DOM 输入：

- 可选择 Fixed、Fill 或 Hug；Fixed 编辑 `px`，Fill 编辑正数 `fr`，Hug 不伪造数值；
- 从 Fill/Hug 切换到 Fixed 时，以 Layout Service 当前求得的真实像素尺寸作为初值；从其他类型切到 Fill 时以 `1fr` 作为明确初值；
- Enter 提交，Escape 或焦点离开取消；输入被 Runtime 拒绝时保持打开供用户修正；
- 输入位置限制在 Canvas host 内，且输入本身不进入 document、history、save、capture 或 export。

标签点击和抓手拖动继续共用同一命中对象：达到 3px 阈值后只执行重排，不弹出输入；未达到阈值才打开输入。这样不会为了增加就地编辑而破坏既有轨道重排手势。

### 事务语义

pointer up 只发送：

```ts
{
  frameId,
  expectedRevision,
  axis,
  index,
  value,
}
```

Renderer 必须先匹配 exact revision，再调用统一的 `planSetGridTrack`；`planResizeGridTrack` 只是把拖动结果收敛为 Fixed track 后复用该入口。planner 只替换 `rows[index]` 或 `columns[index]` 的一条正式 `GridTrack`，随后由唯一 `EditorRuntime.apply` 在同一事务内完成 Grid reflow。一次拖动或一次 Enter 只产生一个 revision 和一个 undo entry，不传递 Leafer 对象或派生 child 几何。

Fixed、Fill、Hug 都遵循同一行为；用户通过手动边缘缩放明确选择固定像素尺寸。Escape、pointer cancel、无位移、选区/工具切换、document/revision 变化以及过期回调均为零写入。Runtime 拒绝时保留当前权威文档，并通过既有编辑错误区反馈。

### 未纳入本切片

多轨道选择、范围选择、删除轨道、child cell 拖拽/交换、span 拉伸、旋转 Grid 控件和超大 Grid viewport virtualization 继续作为独立完整切片。Grid row/column gap 仍只使用 Inspector，不借轨道边缘手势增加未由 Figma 公共行为支持的画布控件。

## 后果

- 用户可以在画布上直接调整 Grid 行高和列宽，也能精确切换 Fixed/Fill/Hug，而不必往返 Inspector。
- child 几何、自动行、Hug/Fill 求解、history、undo/redo 和保存重开继续共享现有 Runtime 事实，没有第二份布局状态。
- 预览不触发模型、截图、审查或 React 文档重算，不增加 Agent 首屏等待时间。
- exact revision 防止长拖动覆盖用户或 Agent 的并发修改。

## 验证

- EditorRuntime 测试覆盖 Fixed、Fill、Hug 的统一设置、拖动到 Fixed、行列索引、非法值、no-op、一次 revision、undo/redo。
- Leafer adapter 测试覆盖行/列边缘、标签单击请求、Fixed/Fill/Hug 原始语义、真实 resolved size、固定屏幕命中尺寸、zoom、3px 阈值、Escape、pointer cancel 与 stale revision。
- Renderer 输入与 controller 测试覆盖 Fixed/Fill/Hug、Enter、Escape、拒绝后保留、exact revision、一次事务/undo 和过期请求零写入。

## 参考

- [Figma Learn：Use the grid auto layout flow](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow)
- [Figma Plugin API：GridTrackSize](https://developers.figma.com/docs/plugins/api/GridTrackSize/)
