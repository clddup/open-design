# ADR-0203：顶层画布 Frame 标签

## 状态

已接受。

## 背景

OpenDesign 的 Layers 面板已经显示完整图层树，但画布上的多个页面/屏幕根缺少名称，用户必须反复在画布与左侧树之间对应位置。Figma 将直接位于画布上的 Frame 定义为 top-level Frame，并在画布上显示其名称；这使多屏 UI、品牌画板和交付尺寸可以在低缩放下快速识别。[Figma Frames 官方说明](https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design)

## 决策

1. Active Page 的顶层 Frame 在画布左上边界上方显示固定屏幕字号的名称。顶层 Component Main root 与 Slice 使用同一定位机制，并保留可区分的 label kind；普通 Group 和嵌套 Frame 不显示，避免复杂文档产生标签噪声。
2. 标签只从当前 DesignDocument、Page rootNodeIds、Component root identity 和 Viewport 派生。它是 Renderer overlay，不进入文档、revision、history、Leafer scene、capture 或 export。
3. 标签使用权威 world bounds 经当前 viewport 转为 screen 坐标；平移、缩放、Frame 变换和窗口尺寸变化会重新投影。完全离开 viewport 的标签不挂载，避免大文件累积无意义 DOM。
4. 单击标签只用稳定 node ID 更新 EditorRuntime selection，并把焦点交还画布；选中态与普通态可辨识，标签具备原生 button 焦点和键盘激活能力。
5. 双击标签进入短生命周期 inline editor，`Enter`/blur 提交，`Escape` 取消，输入法 composition 期间不提交；失败保留输入和可见错误，且不产生 revision。Renderer 只保存 draft/error，正式写入复用现有 `renameLayerTarget → planRenameLayers → DesignTransaction` 路径，不建立第二套文档状态或事务逻辑。
6. Section 专用语义和大规模 root virtualization 继续在后续容器与性能切片处理，不因标签交互扩展当前文档协议。

## 结果

- 多画板设计在画布上可直接识别名称，不需要依靠 Page 根顺序或猜测内容。
- 标签始终跟随权威文档和 viewport，不会覆盖画布事实或污染设计交付。
- 顶层语义与 Figma 的 Frame 层级方向一致，同时保持 OpenDesign 自身 Component、revision 和渲染边界。

## 验证

- 顶层可见 Frame 在正确 viewport 坐标生成名称。
- 隐藏、离屏、普通 Group 与嵌套 Frame 不生成标签。
- Component Main root 使用 component kind。
- 点击和键盘激活把稳定 Frame ID 交给 selection owner。
- 双击重命名的提交、取消与失败状态可复现；成功写入复用 Layer rename planner 的单 revision/undo，失败为零 revision。
- Desktop typecheck、Canvas 组件测试与 production build 通过。
