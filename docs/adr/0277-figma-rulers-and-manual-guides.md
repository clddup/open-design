# ADR-0277：Figma-compatible 标尺与手工参考线

## 状态

已接受。

## 背景

OpenDesign 已有 Frame `layoutGuides`，用于 Uniform、Columns、Rows 布局网格；它们是 Frame 外观辅助，不是从标尺拖出的单条参考线。Figma 将两类能力明确分开：标尺参考线可属于 Page 或 Frame，公开 Plugin API 的权威结构仅为 `{ axis: "X" | "Y", offset }`，其中 offset 相对持有它的 Page 或 Frame。

若把手工参考线继续塞进 `layoutGuides`，会同时破坏 Figma 交换语义、Frame-local 坐标和后续吸附边界；若只在 Renderer 保存，又会让参考线无法保存、撤销、Agent 编辑或跨平台恢复。

## 决策

1. `DesignDocument 1.57.0` 增加唯一 `Guide` 结构 `{ axis: "X" | "Y", offset: number }`；`DesignPage.guides` 与 `Frame.properties.guides` 使用同一结构。X 表示竖线，Y 表示横线，offset 永远相对所有者本地坐标。
2. 旧文档迁移只升级 schema，不制造空数组。手工参考线不携带私有 ID、颜色或显示状态；数组索引只用于一次 exact-revision 编辑的临时定位，不成为跨 revision 身份。
3. `update_page` 允许原子更新 name 和/或 guides；Frame 继续使用通用 `update_properties`。`planSetGuides` 与 `planEditGuide` 负责 Page/Frame owner、锁定、当前值、移动、复制和删除，最终仍只通过唯一 `EditorRuntime` 事务提交。
4. Renderer 的标尺、刻度、选中高亮、拖拽预览和值标签只属于 editor session，不进入文档、capture 或 export。`Shift+R` 和状态栏视图菜单控制可见性。
5. 从水平标尺拖出 Y guide，从垂直标尺拖出 X guide；落点位于当前选中层所属 Frame 内时保存为 Frame-local guide，否则保存为 Page guide。Alt/Option 拖动现有参考线复制；拖回对应标尺、Delete/Backspace 或右键删除。
6. Frame 参考线通过完整 world transform 投影并裁到 Frame 边界；Page 参考线跨当前 viewport。锁定 Frame 的参考线可见但不可改。
7. Agent 不增加细碎工具；现有 `opendesign_edit_design` arrange 工具增加 `set-ruler-guides` action，并与人工操作共用同一 Contract、Runtime planner 和 undo。
8. `@opendesign/figma-interop` 对固定 `@figma/plugin-typings 1.133.0` 的 `Guide` 做无损双向投影。该切片不假装已完成完整 Figma 文件导入器。

## 影响

- Page/Frame 标尺参考线现在可保存、重开、撤销/重做，并可由人工和 Agent 修改。
- Layout Guides 与手工参考线保持两个清晰概念，不增加兼容分支或第二份文档状态。
- 对象/几何/像素吸附、对参考线吸附、距离 redlines、标尺辅助面板和 macOS/Windows 打包产品实机证据仍属于后续切片；当前能力保持 `degraded`。

## 公开语义参照

- [Figma：Add guides to the canvas or frames](https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames)
- [Figma Plugin API：Guide](https://developers.figma.com/docs/plugins/api/Guide/)
- [Figma Plugin API：PageNode guides](https://developers.figma.com/docs/plugins/api/properties/PageNode-guides/)
