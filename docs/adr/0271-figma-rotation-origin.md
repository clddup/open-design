# ADR-0271：Figma-compatible 普通图层旋转原点

## 状态

已接受。

## 背景

OpenDesign 已支持普通图层旋转，但此前旋转始终围绕选择中心。Figma Design 允许用户通过 macOS `Option+R` / Windows `Alt+R` 进入 rotation origin 编辑并拖动目标点；该能力属于普通设计编辑，不依赖 Motion。若只把原点保存在 Leafer Editor 或 Renderer 状态中，保存重开、Agent 修改、下一次旋转和 undo 会产生不同事实。

## 决策

1. `DesignDocument 1.55.0` 为普通 `DesignNode` 增加可选 `rotationOrigin: { x, y }`。坐标是节点本地尺寸的相对值，允许小于 `0` 或大于 `1`，因此原点可以位于图层边界外。
2. 默认中心 `{ x: 0.5, y: 0.5 }` 不序列化；`update_properties.rotationOrigin: null` 恢复默认中心。设置或清除原点不改变当前 transform、bounds 或视觉，只影响后续旋转。
3. 单选普通节点时，Leafer Editor 从权威节点投影 percent `rotateAround`；多选、Smart Selection 与组件派生目标继续围绕选择中心，不建立多选原点文档状态。
4. 人工入口为 Inspector 的 Edit/Reset 控件和 Canvas `Option/Alt+R`。原点 target 是 session-only DOM overlay；拖动期间只更新草稿，pointer up 经唯一 EditorRuntime 提交一次 revision/undo，Escape、pointer cancel、选区/Page/工具变化和锁定状态变化零写入。
5. Agent 不增加专用工具，复用现有 Arrange tool 的 `set-rotation-origin` action 和同一 Runtime planner。Provider、Runtime 与 Renderer 使用同一闭合 Contract；Run 不拥有节点，后续 Run 可继续修改历史设计。

## 影响

- 保存重开、undo/redo 与 Agent/人工入口共享同一个持久原点；Leafer scene 仍是可丢弃投影。
- rotation origin 不进入画布 capture、位图导出或 SVG 可见内容；它是编辑语义，不是可见图层。
- 锁定、错误 Page、缺失节点、零尺寸 UI 目标、stale revision 和文档 invariant 继续失败关闭。
- 本 ADR 不引入 Motion anchor、关键帧、时间线、旋转角度输入、15° 吸附、智能吸附、标尺或参考线；这些能力按各自完整切片处理。

## 公开语义参照

- [Figma：Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
- [Figma：Move a layer's anchor point](https://help.figma.com/hc/en-us/articles/41352588622615-Move-a-layer-s-anchor-point)
