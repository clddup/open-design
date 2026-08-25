# ADR-0158：Figma-compatible Grid 画布直接编辑

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

首次单击顶部或左侧编号标签只建立可辨识轨道选择；再次单击已选标签，在点击位置附近打开紧凑 DOM 输入。这样单选轨道也能直接接收 Delete/Backspace，而不把按键焦点提前送入数值字段：

- 可选择 Fixed、Fill 或 Hug；Fixed 编辑 `px`，Fill 编辑正数 `fr`，Hug 不伪造数值；
- 从 Fill/Hug 切换到 Fixed 时，以 Layout Service 当前求得的真实像素尺寸作为初值；从其他类型切到 Fill 时以 `1fr` 作为明确初值；
- Enter 提交，Escape 或焦点离开取消；输入被 Runtime 拒绝时保持打开供用户修正；
- 输入位置限制在 Canvas host 内，且输入本身不进入 document、history、save、capture 或 export。

标签点击和抓手拖动继续共用同一命中对象：达到 3px 阈值后只执行重排，不弹出输入；未达到阈值时首次点击选择、再次点击编辑。这样不会为了增加就地编辑和删除而破坏既有轨道重排手势。

### 多轨道选择

轨道选择是 Canvas session state，不进入 DesignDocument：

- `Command`（macOS）/`Ctrl`（Windows）单击追加或切换轨道；`Shift` 从最近 anchor 连续选择范围；
- 同一时间只保留一个 Frame、一个 axis、一个 document revision 的轨道选择；切换 Frame、Page、工具或 revision 时清除，避免无稳定 track ID 时把选择错误套到重排后的其他轨道；
- 已选轨道使用完整不透明度与额外描边，不能只靠颜色表达；modifier 单击只改变选择，不弹输入；随后普通单击任一已选标签打开共享输入；
- 类型或数值不一致时输入显示 Mixed，不伪造共同值。用户选择 Fixed/Fill/Hug 并输入值后，`planSetGridTracks` 在一个 Auto Layout patch 中修改全部已选轨道，只产生一个 revision/undo；
- 拖动已选标签时，既有 `planReorderGridTracks(fromIndices)` 重排完整选择；跨 span closure 和 row-auto-flow layer order 仍只由 Runtime 处理。直接拖动轨道边缘继续明确选择并缩放单条轨道，多选尺寸通过标签字段设置，与 Figma 的公开说明一致。

### 删除轨道

选中一条或多条显式轨道后，macOS/Windows 的 `Delete` 或 `Backspace` 进入同一个 `planDeleteGridTracks`；Inspector 的逐轨道删除按钮也复用该 planner，不再通过任意替换 rows/columns 数组建立第二套语义：

- 至少保留一条行轨道和一条列轨道；`autoTracks: rows` 产生的自动行继续参与网格投影，但不显示会稳定失败的独立标签、缩放、重排或删除控件；
- 完全位于被删轨道中的 flow child 连同其 subtree 通过正式 reference-aware 删除 planner 移除；Component/Variant、锁定层和事务预算继续使用既有失败封闭语义，不能绕过引用清理。删除 Component Main 时，外部 Instance 的 detach root 保留 Instance 自己的 parent-level layout metadata，不继承 Main 在原 Grid 中的 placement；
- 横跨被删与保留轨道的 child 保留，并按剩余原始 cell 收缩 span、移动到最近仍存在的轨道；未相交 child 的 placement 按删除后的索引平移；absolute child 不占 Grid cell，因此不随轨道删除；
- Frame tracks、surviving placement、引用清理和内容删除组成一条事务，只产生一个 revision/undo。Canvas 请求携带 selection 建立时的 exact revision；成功 revision 后 session-only 轨道选择自然失效，stale、非法索引、删除全部轨道或失败事务均为零写入。

### 子层 Cell 拖拽

当 Select 工具下的当前选区全部是同一个轴对齐、未锁定 Grid Frame 的可见直属 flow child 时，普通 move 手势切换为 cell 语义，而不是把 Layout Service 派生的 x/y 写回文档：

- pointer move 保留 Leafer 的实时对象预览，并根据 anchor child 的 Frame-local 中心点命中 Layout Service 已求得的最近真实 cell；editor sky 同时显示固定屏幕描边和轻量填充的目标 cell，高亮是 disposable overlay；
- 多选以 selection anchor 为命中基准，保持选区在 layer order 中的稳定顺序。Manual Grid 按 row/column delta 平移整组，保留 span 和横纵 alignment；目标冲突时把未选 child 确定性安置到最近空 cell，无可用空间时按最后一条 authored row 的规格增加必要行；
- row-auto-flow 不伪造 placement patch，而是重排 flow child 的 layer order。hidden 与 absolute child 固定在原 layer slot，也不会成为生成的 move command 目标；固定容量下混合 span 无法排下时在提交前由权威 Layout Service 预求解失败封闭，`autoTracks: rows` 继续按既有规则扩展；
- Runtime 对直接拖拽使用有界 cell 搜索。超过 65,536 个显式 cell 的 Grid 不进入同步 cell 安置，继续使用 Inspector/结构编辑路径，避免大矩阵拖拽冻结 Renderer；
- pointer up 先恢复权威 Leafer 投影，再只发送 `frameId + nodeIds + anchorNodeId + target cell + expectedRevision`。Renderer 调用唯一 `planMoveGridChildren`，Frame tracks、选中 placement、被安置 child 或 row-auto-flow layer order 组成一个事务、一个 revision 和一个 undo entry。

Escape、pointer cancel、Page/工具/选区变化、非连续 revision、component 派生选区、locked obstruction、无位移和 stale callback 均恢复权威投影且零写入。cell 高亮与拖动预览不进入 document、history、save、capture 或 export。

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

Renderer 必须先匹配 exact revision，再调用统一的 `planSetGridTracks`；单条 `planSetGridTrack` 与 `planResizeGridTrack` 都只是该批量入口的窄调用。planner 在一个 Auto Layout patch 中替换已选 `rows[index]` 或 `columns[index]` 的正式 `GridTrack`，随后由唯一 `EditorRuntime.apply` 在同一事务内完成 Grid reflow。一次拖动或一次 Enter 只产生一个 revision 和一个 undo entry，不传递 Leafer 对象或派生 child 几何。

Fixed、Fill、Hug 都遵循同一行为；用户通过手动边缘缩放明确选择固定像素尺寸。Escape、pointer cancel、无位移、选区/工具切换、document/revision 变化以及过期回调均为零写入。Runtime 拒绝时保留当前权威文档，并通过既有编辑错误区反馈。

### 未纳入本切片

span 拉伸、旋转 Grid 控件和超大 Grid viewport virtualization 继续作为独立完整切片。Grid row/column gap 仍只使用 Inspector，不借轨道边缘手势增加未由 Figma 公共行为支持的画布控件。

## 后果

- 用户可以在画布上直接调整或删除 Grid 行列，也能单选、追加、范围选择并统一设置 Fixed/Fill/Hug，而不必往返 Inspector。
- 用户可以直接把单个或多个 Grid flow child 拖到真实 cell；画布显示真实手势与目标预览，最终仍提交语义事务而不是派生坐标。
- child 几何、自动行、Hug/Fill 求解、history、undo/redo 和保存重开继续共享现有 Runtime 事实，没有第二份布局状态。
- 预览不触发模型、截图、审查或 React 文档重算，不增加 Agent 首屏等待时间。
- exact revision 防止长拖动覆盖用户或 Agent 的并发修改。

## 验证

- EditorRuntime 测试覆盖 Fixed、Fill、Hug 的单条/批量统一设置、重复 index 归一、拖动到 Fixed、非法/空选择、no-op、一次 revision、undo/redo。
- Leafer adapter 测试覆盖行/列边缘、标签单击请求、Command/Ctrl 追加、Shift 范围、选择外观、Mixed 输入、选择集重排、真实 resolved size、zoom、3px 阈值、Escape、pointer cancel 与 stale revision。
- Renderer 输入与 controller 测试覆盖 Mixed → Fixed/Fill/Hug、批量 index、Enter、Escape、拒绝后保留、exact revision、一次事务/undo 和过期请求零写入。
- Runtime/Leafer/Renderer 测试覆盖单选与多选删除、contained child 删除、跨轨道 span 收缩、后续 placement 平移、Component Main 删除与外部 Instance detach、至少保留一条轨道、自动行无无效控件、Delete/Backspace、Inspector 复用、exact revision 和一次 undo。
- Grid child 测试覆盖 Manual 空 cell/占用 cell、多选相对位置、span/alignment、必要 row 扩展、locked obstruction、row-auto-flow 稳定重排、hidden/absolute 固定 slot、混合 span 预求解失败、超大矩阵有界拒绝、目标 cell 高亮、Escape/stale、一次 revision/undo/redo 和 save/reopen。

## 参考

- [Figma Learn：Use the grid auto layout flow](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow)
- [Figma Plugin API：GridTrackSize](https://developers.figma.com/docs/plugins/api/GridTrackSize/)
