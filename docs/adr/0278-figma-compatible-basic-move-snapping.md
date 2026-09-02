# ADR-0278：Figma-compatible 普通对象移动吸附

## 状态

已接受。

## 背景

OpenDesign 已通过 ADR-0277 保存并显示 Page/Frame 手工参考线，但普通对象移动仍完全自由，缺少成熟设计编辑器中用于精确定位的对象、参考线与像素网格吸附。Figma 将 Snap to objects、Snap to pixel grid 与仅用于 Vector edit 的 Snap to geometry 分开，并让吸附偏好跨 Design files 生效；对象吸附使用外边缘和中心，命中时显示红色参考线，普通移动中按住 `Control` 暂时关闭对象吸附。

吸附是高频 pointer-move 路径，不能通过每帧遍历完整文档、修改 DesignDocument 或向 Renderer 建立第二份可写几何状态实现。Leafer 的 DragEvent 会根据 drag start、累计 pointer total 与当前元素位置还原每一帧原始移动，因此宿主也不能把上一帧 correction 再次从新一帧扣除。

## 决策

1. `@opendesign/geometry-service` contract 32 增加与渲染后端无关的 move snap resolver。选择框每轴使用 start/center/end anchors；候选优先级固定为手工参考线、对象、像素网格，并以 source、距离、anchor、稳定 ID 做确定性 tie-break。
2. Leafer 在 drag begin 时一次自顶向下累计可见节点 world transform，构建并排序对象 target index；pointer move 只做二分邻域查询。选择本身及其后代从候选中排除，多选按 top-level selected nodes 的 world-space union bounds 作为一个整体吸附。
3. Page guide 作用于整页；Frame-local guide 只作用于该 Frame 后代。跨 Frame 多选只使用共同祖先 Frame guides 与 Page guides，移动 Frame 不使用自身 guide。当前仅将投影后仍与文档轴正交的 Frame guide纳入吸附；旋转或倾斜 guide 后续以定向直线 resolver 单独完成，不伪装为已支持。
4. 每个 Leafer `editor.move` 到达宿主时视为当前 raw pointer transform，再应用本帧 correction；仅在 `Control` 状态切换或连续外部 revision 刷新 target index 时撤销当前 correction 后重算。连续 revision 不复用旧 target index，非连续 revision 沿用既有 direct manipulation 取消策略。
5. document-space correction 通过每个 top-level selection 父级 world transform 的 inverse linear part 转为 parent-local delta，支持不同 parent、多选、旋转、缩放与可逆 skew；Grid flow child 的语义 cell move 不进入普通吸附。
6. 红色 `#f24e8a` smart guides 位于统一 editor sky overlay 层，不可命中、不进入文档、保存、capture 或 export。viewport gesture、程序化 viewport sync 与 render-child settle 均重算 overlay transform，线宽保持屏幕 1px。
7. Renderer 的 View options 提供 Snap to objects 与 Snap to pixel grid。偏好保存在应用本地设置中并跨 Design Files 生效，不写入 DesignDocument。默认均开启；普通 move 按住 `Control` 暂停对象与 guide 吸附但保留 pixel grid，左右 Control 独立跟踪，窗口失焦时恢复。
8. 本切片不增加 Agent tool 或事务类型。吸附只修正人工直接移动的预览 transform，pointer up 仍由现有唯一 DirectTransform → DesignTransaction → EditorRuntime 路径形成一个 revision/undo。

## 影响

- 普通对象移动现可吸附对象外边缘/中心、当前作用域手工参考线与像素网格，并显示稳定红色反馈。
- 吸附不产生中间 revision，不改变 capture/export，偏好也不污染设计文件。
- Vector geometry snapping、旋转/倾斜 Frame guide、resize snapping、等距/距离 redlines、全量大型文档性能基线，以及 macOS/Windows 打包产品实机证据仍待后续切片。

## 公开语义参照

- [Figma：Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
- [Figma：Add guides to the canvas or frames](https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames)
