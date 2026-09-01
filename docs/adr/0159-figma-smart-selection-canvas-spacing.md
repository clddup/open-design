# ADR-0159：Figma-compatible Smart Selection 画布间距手柄

- 状态：Accepted，画布间距、完整标记手势、一维/二维重排及 duplicate/delete/resize 自动回流已实施
- 日期：2026-08-26

## 背景

OpenDesign 已有对齐、分布、明确间距和 Tidy up，但普通图层仍只能从 Inspector 或 Agent 修改间距。Figma 的 Smart Selection 会在两个及以上等距、轴向有重叠关系的图层上显示中心标记，并在 hover 后提供统一间距手柄。该交互必须直接呈现真实图层变化，同时保持 OpenDesign 的单一文档事实、事务、revision 和 undo 边界。

## 决策

`@opendesign/geometry-service` 的 `analyzeSmartSelection` 是资格、稳定排序、行列聚类和当前间距的唯一事实。它接受普通 world bounds：一维要求统一 gap；二维要求可证明的稳定 cell、row 和 column，并允许不等尺寸与稀疏网格。`setSmartSelectionSpacing` 只调整目标轴，不能把二维选区 flatten 为一条列表。一维允许零和负间距。

Leafer adapter 只投影 session-only editor sky：

- Select 工具、两个及以上可见未锁定普通图层且不属于 Auto Layout flow 时显示粉色中心标记；hover 选区后显示 gap handle；
- pointer move 使用 Geometry placement 即时移动真实 Leafer projection，并以固定屏幕尺寸显示数值；`Shift` 使用 10 px big nudge；
- overlay 按 document/revision/Page/tool/selection 缓存，pan、zoom 或无关 React render 只更新 viewport transform，不重建 handles；
- Escape、pointer cancel、工具/选区/Page/revision 变化先恢复权威 projection，零文档写入。

pointer up 先恢复 projection，再发送 `documentId + pageId + expectedRevision + nodeIds + axis + spacing`。Renderer 必须匹配 exact document、Page、revision 和当前 selection，随后调用 `planSmartSelectionSpacing`。EditorRuntime 负责 parent-local delta、Group bounds normalization 和正式校验；一次手势只应用一条事务、产生一个 revision 和一个 undo entry。callback rejection 保持已恢复状态，不在 Leafer 保存第二份结果。

中心 ring 同时承担真实的一维重排入口。单击 ring 标记单层，`Shift` 单击追加或移除标记；marked ring 使用实心粉色填充。拖动 marked subset 时，Geometry Service 从当前一维空间顺序中移除 marked IDs，再按 remaining-order insertion index 插回，保留 marked 内部顺序与现有统一间距。Leafer 连续预览全部选中图层并显示蓝色插入线，pointer up 恢复 projection 后只发送稳定 IDs 和 insertion index。`planSmartSelectionReorder` 只更新 transform 和必要的 Group bounds，不改变 parent、childIds 或 Layers panel 顺序，并与 spacing 共用 exact scope、单事务和失败恢复语义。

标记状态是 Leafer/Renderer 的 session-only 投影，包含 exact document/Page/revision、完整 Smart Selection IDs 与 marked subset，不进入文档协议。一维双击 ring 标记全部；二维 `Shift + 双击` 先标记命中的稳定 row/column，再次执行时标记全部。duplicate 成功后标记迁移到新副本；delete 后保留剩余 Smart Selection；revision、Page、工具或选区不匹配时，快捷键和工具栏不得消费过期标记。

二维选区允许单层拖到另一个已占用 cell。默认 rearrange 按现有 row-major occupied slots 插入并移动中间层；按住 macOS Command 或 Windows Control 时交换 moved/target cell。每次候选都按新的 cell ownership 重新求 column max width、row max height 和既有双轴间距，不假定等尺寸。Leafer 用蓝色目标框显示候选 cell；pointer up 只提交 `movedNodeId + targetNodeId + insert/swap`，Runtime 重新分析当前稳定二维选区后形成单事务。

Geometry Service contract 28 增加 `reflowSmartSelectionMutation`，统一计算 duplicate/delete/resize 后的位置：一维按原轴向顺序插入、补位或以 resized marked layer 为锚恢复间距；二维按 columns-as-lists 处理，副本位于源层下方、删除向上补位，整列删除与宽度变化还会恢复列间距。二维 resize 只允许一个 marked layer；一维允许多个。Renderer 的按钮与 `Cmd/Ctrl+D`、Delete/Backspace 共用 EditorRuntime planner；直接 resize 先恢复 Leafer projection，再把 marked subtree 的可信操作、回流和 Group normalization 合成一个 transaction，因此只产生一次 revision/undo，且不改变既有 Layers 顺序。

中心标记、handle、tooltip 和 preview 均不进入 `DesignDocument`、history、save、capture 或 export。Component 派生目标、locked layer、Auto Layout flow child、不可逆 transform、歧义 overlap graph 和预算失败继续关闭该入口，不以错误坐标冒充支持。

## 当前边界

本切片完成普通 Smart Selection 的间距、完整标记、重排以及 duplicate/delete/resize 回流。吸附、参考线、标尺、像素策略和更多键盘等价入口仍需后续切片；当前自动化也不冒充 macOS/Windows 打包产品的真实指针与键盘 smoke。

## 验证

- Geometry 覆盖一维、二维、不等尺寸、稀疏 cell、负间距与歧义拒绝；
- EditorRuntime 覆盖目标轴保持、Group normalization、一次 revision/undo；
- Leafer adapter 覆盖 hover/ring、真实 preview、semantic callback、handle 缓存、Escape、pointer cancel、stale revision 和 projection 恢复；
- 一维重排覆盖单击/Shift marked state、实心 ring、真实全选区 reflow preview、蓝色插入线、层级不变与 semantic callback；
- 双击覆盖一维全选与二维同轴→全选，标记在 duplicate 后迁移到新副本；
- Geometry/Runtime 覆盖一维和二维 duplicate/delete/resize、整列补位、宽高变化、ID 冲突、Group normalization 与单 transaction；
- Renderer controller 覆盖 spacing/reorder/mutation 的 exact document/Page/revision/selection、快捷键/按钮、一次 history 和 stale 零写入。

## 参考

- [Figma：Arrange layers with Smart selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)
- [Figma：Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
