# ADR-0159：Figma-compatible Smart Selection 画布间距手柄

- 状态：Accepted，画布间距手柄已实施；标记、重排和结构变化后的回流待后续
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

中心标记、handle、tooltip 和 preview 均不进入 `DesignDocument`、history、save、capture 或 export。Component 派生目标、locked layer、Auto Layout flow child、不可逆 transform、歧义 overlap graph 和预算失败继续关闭该入口，不以错误坐标冒充支持。

## 当前边界

本切片只完成普通 Smart Selection 的水平/垂直统一间距。Figma 的选区标记、画布重排、duplicate/delete/resize 后的自动 reflow、吸附和键盘等价入口仍需独立设计；这些能力不得因已有中心 ring 或 spacing handle 被描述为完成。

## 验证

- Geometry 覆盖一维、二维、不等尺寸、稀疏 cell、负间距与歧义拒绝；
- EditorRuntime 覆盖目标轴保持、Group normalization、一次 revision/undo；
- Leafer adapter 覆盖 hover/ring、真实 preview、semantic callback、handle 缓存、Escape、pointer cancel、stale revision 和 projection 恢复；
- Renderer controller 覆盖 exact document/Page/revision/selection、一次 history 和 stale 零写入。

## 参考

- [Figma：Arrange layers with Smart selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)
- [Figma：Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
