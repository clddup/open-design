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

当单个、未锁定、world transform 可逆且保持正向正交、行列总数不超过 512 的 Grid Frame 在 Select 工具下被选中时，既有 Grid editor sky 为每条可见行列轨道增加远端边缘命中区。正向正交包含任意旋转和非退化轴缩放；mirror、skew 与退化矩阵继续失败封闭：

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

当 Select 工具下的当前选区全部是同一个可编辑、未锁定 Grid Frame 的可见直属 flow child 时，普通 move 手势切换为 cell 语义，而不是把 Layout Service 派生的 x/y 写回文档：

- pointer move 保留 Leafer 的实时对象预览。宿主记录 anchor 初始 Frame-local 视觉中心命中 cell 与 placement 起点之间的稳定 offset，后续命中 Layout Service 已求得的最近真实 cell 后换算回同一 placement-origin 坐标域，避免 spanning/Fill anchor 轻微移动就跨格；editor sky 同时显示固定屏幕描边和轻量填充的目标 cell，高亮是 disposable overlay；
- 多选以 selection anchor 为命中基准，保持选区在 layer order 中的稳定顺序。Manual Grid 按 row/column delta 平移整组，保留 span 和横纵 alignment；目标冲突时把未选 child 确定性安置到最近空 cell，无可用空间时按最后一条 authored row 的规格增加必要行；
- row-auto-flow 不伪造 placement patch，而是重排 flow child 的 layer order。目标 cell 先映射到当前 Layout Service 解析出的真实 occupant/insertion boundary，而不是把二维 cell ordinal 错当 child ordinal，因此前置 span、空洞和非首项 anchor 仍得到稳定顺序。hidden 与 absolute child 固定在原 layer slot，也不会成为生成的 move command 目标；固定容量下混合 span 无法排下时在提交前由权威 Layout Service 预求解失败封闭，`autoTracks: rows` 继续按既有规则扩展；
- Runtime 对直接拖拽使用有界 cell 搜索。超过 65,536 个显式 cell 的 Grid 不进入同步 cell 安置，继续使用 Inspector/结构编辑路径，避免大矩阵拖拽冻结 Renderer；
- pointer up 先恢复权威 Leafer 投影，再只发送 `frameId + nodeIds + anchorNodeId + target cell + expectedRevision`。Renderer 调用唯一 `planMoveGridChildren`，Frame tracks、选中 placement、被安置 child 或 row-auto-flow layer order 组成一个事务、一个 revision 和一个 undo entry。

Escape、pointer cancel、Page/工具/选区变化、非连续 revision、component 派生选区、locked obstruction、无位移和 stale callback 均恢复权威投影且零写入。cell 高亮与拖动预览不进入 document、history、save、capture 或 export。

### 子层 Span 调整

Figma 的公开 Grid 行为要求 child 在目标轴使用 Fill container 后，通过画布 resize 把边缘吸附到 cell 边界并修改 Row/Column span。OpenDesign 复用同一个 Grid editor sky 与 Direct Transform session：

- 单选直属 flow child 且至少一个轴为 Fill 时，resize 继续使用 Leafer 的即时对象预览；宿主比较 gesture 前后边界，只在 Fill 轴上吸附 Layout Service 求得的真实 track start/end，Fixed 轴保留普通尺寸编辑；
- 目标高亮覆盖完整 prospective span，而不是只亮一个 cell。Manual Grid 可从任意边缘调整起点和终点；row-auto-flow 只接受不改变自动起点的 trailing-edge span，leading-edge 手势恢复权威投影，避免预览向左/上扩展而提交后向右/下回流；
- Manual span 与 cell move 共用同一冲突安置算法，遮挡 child 移到最近空 cell并可增加 authored row；row-auto-flow 在提交前以当前 layer order 和目标 span 调用权威 Layout Service 预求解，固定容量不足时零写入，`autoTracks: rows` 可按既有语义扩行；
- pointer up 先恢复权威 Leafer 投影，再发送 `frameId + nodeId + target placement + size + expectedRevision`。Renderer 调用 `planResizeGridChildSpan`；placement、Fixed 轴 size、被安置 child 和必要 tracks 合成一条事务、一个 revision/undo。Group/Boolean/Instance 不伪造不属于其契约的显式 size；Line 使用变换后端点边界保留 Fixed counter-axis 尺寸；两轴 Fill 且没有跨越 cell 边界时直接吸附回原 span。

Escape、pointer cancel、Page/工具/选区/revision 变化、非 Fill 轴、非法或反向 span、locked child、超大 Grid 和 stale callback 都失败封闭。resize 预览与 span 高亮仍为 session-only，不进入 document/history/save/capture/export。

### 旋转 Frame

Grid editor sky 继续使用 Frame-local 轨道、cell 与 span 几何，然后把完整 world transform 与 viewport transform 一次组合到 overlay layer；pointer 事件由 Leafer `getInnerPoint(layer)` 反解回同一 Frame-local 坐标。这样 track reorder/resize、cell move 与 Fill span 不需要维护旋转后的第二份几何，也不会把 world 坐标误写入 placement。

轨道标签、命中区、引导线、目标高亮和 insertion indicator 全部随 Frame 旋转；固定屏幕尺寸按旋转后两条局部轴的真实 scale 分别补偿。resize cursor 根据当前轨道变化轴的屏幕方向映射到水平、垂直或两条对角 cursor。正向正交矩阵才进入该路径；mirror 会反转标签与顺序，skew 会破坏正交轨道心智，因此二者继续明确使用 Inspector，不能以错误 overlay 冒充支持。Frame 的 transform、Grid 文档事实、事务和 history 均不因本切片变化。

### Viewport virtualization

Grid 文档与 Layout Service 继续允许每轴最多 4,096 条轨道，editor sky 不再以“行列总数超过 512”整体关闭画布能力。文档/revision 变化时仍完整求解一次权威 track/cell/span 几何；pan、zoom 和窗口尺寸变化只把当前 viewport 四角连同 64 screen-px overscan 反解到 Frame-local，使用已排序 track 的二分窗口选择可见范围，不重新调用 Layout Service。

可见轨道标签/命中区按局部轴 screen scale 保持至少 18 px 密度，引导线保持至少 2 px 密度；极宽视口仍分别按候选比例约束在最多 512 个可交互 track controls 和 1,024 个 guide tracks。低 zoom 下未投影标签的轨道不会伪装成可命中，用户 zoom/pan 到该区域后再增量创建。当前 drag track 即使移出 overscan 也临时 pin 在同一 session，Escape、pointer cancel、revision/Frame 变化后立即释放；普通 offscreen 控件会 remove/destroy，不留隐藏 Leafer 节点、监听器或第二份选择状态。

虚拟化只裁剪 editor-sky presentation resources。完整 track arrays、selection indices、reorder insertion、child placement、Inspector、save/export/capture 与事务输入不被抽样；目标 cell/span 命中仍消费完整计划。Frame 完全离开视口时 overlay layer 可保留空壳但不创建可命中节点。

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

Grid row/column gap 按 Figma 公开行为仍只使用 Inspector，不借轨道边缘手势增加未定义的画布控件。镜像/倾斜 Grid 的可读标签与轨道交互仍需独立设计，不在本切片伪装支持。

## 后果

- 用户可以在画布上直接调整或删除 Grid 行列，也能单选、追加、范围选择并统一设置 Fixed/Fill/Hug，而不必往返 Inspector。
- 用户可以直接把单个或多个 Grid flow child 拖到真实 cell；画布显示真实手势与目标预览，最终仍提交语义事务而不是派生坐标。
- Fill Grid child 可直接通过画布 resize 吸附并调整 row/column span，Fixed counter-axis 尺寸与 span 在同一次 undo 中提交。
- child 几何、自动行、Hug/Fill 求解、history、undo/redo 和保存重开继续共享现有 Runtime 事实，没有第二份布局状态。
- 预览不触发模型、截图、审查或 React 文档重算，不增加 Agent 首屏等待时间。
- exact revision 防止长拖动覆盖用户或 Agent 的并发修改。

## 验证

- EditorRuntime 测试覆盖 Fixed、Fill、Hug 的单条/批量统一设置、重复 index 归一、拖动到 Fixed、非法/空选择、no-op、一次 revision、undo/redo。
- Leafer adapter 测试覆盖行/列边缘、标签单击请求、Command/Ctrl 追加、Shift 范围、选择外观、Mixed 输入、选择集重排、真实 resolved size、zoom、3px 阈值、Escape、pointer cancel 与 stale revision。
- Renderer 输入与 controller 测试覆盖 Mixed → Fixed/Fill/Hug、批量 index、Enter、Escape、拒绝后保留、exact revision、一次事务/undo 和过期请求零写入。
- Runtime/Leafer/Renderer 测试覆盖单选与多选删除、contained child 删除、跨轨道 span 收缩、后续 placement 平移、Component Main 删除与外部 Instance detach、至少保留一条轨道、自动行无无效控件、Delete/Backspace、Inspector 复用、exact revision 和一次 undo。
- Grid child 测试覆盖 Manual 空 cell/占用 cell、多选相对位置、span/alignment、必要 row 扩展、locked obstruction、row-auto-flow resolved occupant 映射、spanning anchor 稳定 offset、hidden/absolute 固定 slot、混合 span 预求解失败、超大矩阵有界拒绝、目标 cell 高亮、Escape/pointer cancel/stale、一次 revision/undo/redo 和 save/reopen。
- Grid span 测试覆盖真实 track 边缘吸附、Fill/Fixed 混合轴、Manual obstruction 安置、row-auto 固定容量失败与自动行扩展、完整 span 高亮、leading-edge 失败封闭、变换后视觉 bounds、Line Fixed counter-axis、最终非法 target、Escape/pointer cancel/stale、一次 revision/undo 和 Fixed 轴 size 保留。
- 旋转 Grid 测试覆盖 90° world transform、Frame-local track resize/cell move/span、方向化 cursor 与 overlay affine；mirror、skew、退化矩阵继续失败封闭。
- Grid virtualization 测试覆盖 4,096 列完整权威计划、首屏/中段 pan/90° 旋转可见窗口、512 control/1,024 guide 上限、active drag pin、offscreen remove/destroy，以及 pan/zoom 不重建文档事实。

## 参考

- [Figma Learn：Use the grid auto layout flow](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow)
- [Figma Plugin API：GridTrackSize](https://developers.figma.com/docs/plugins/api/GridTrackSize/)
