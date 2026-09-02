# ADR-0281：Figma-compatible 标尺参考线距离 redline

## 状态

已接受。

## 背景

ADR-0277 已完成 Page/Frame 手工参考线，ADR-0279 已完成选区与悬停对象的临时距离测量，但从标尺拖出参考线时仍只能看到坐标。Figma 的公开行为是在选中顶层 Frame 后，按住 macOS `Option` 或 Windows `Alt` 拖出参考线：参考线位于 Frame 外时显示到 Frame 的距离，进入 Frame 后继续显示到 Frame 边和相交内容的距离。

该反馈只用于拖拽决策，不应生成文档节点、事务、revision、undo 或导出内容。

## 决策

1. `@opendesign/geometry-service` contract 35 增加纯 `measureGuideToRect`。输入为轴、参考线位置和有效轴对齐 bounds；参考线在 bounds 外时返回最近边距离，在 bounds 内时返回两侧非零 inset。
2. 只有当前 Page 的单个顶层 Frame 被明确选中，且拖拽期间按住 `Option/Alt` 时显示 redline。普通拖出参考线保持原交互；已有参考线上的 `Option/Alt` 复制语义不变，并同时显示测量。
3. 参考线位于 Frame 外时只测量 Frame；进入 Frame 后测量 Frame 两侧 inset，并沿指针所在横截面选择 Frame 直属可见对象中的最近前后对象和包含对象。不会全树扫描或展示所有对象，避免高频拖拽产生噪声和无界计算。
4. Frame 或 Frame-local 参考线含旋转/倾斜时不退化为 world AABB 测量；本切片失败开放，只保留原参考线拖拽。轴对齐对象继续使用当前 document-space bounds。
5. 红色 `#f24822` 线和固定屏幕尺寸标签位于 Canvas DOM overlay，与现有标尺同生命周期；pointer up、Escape、pointer cancel、blur 或松开修饰键立即清理，不进入 DesignDocument、history、capture/export。
6. 本切片不增加 Agent tool、IPC、文档字段或第二份可写状态。Vector anchor 测量、旋转/倾斜定向边测量和双平台打包实机证据继续后续完成。

## 影响

- 用户从标尺定位参考线时可直接看到 Frame 和内容间距，不再人工读取坐标相减。
- Geometry Service 只拥有后端无关的一维测量语义；Renderer 负责当前选择、指针横截面和 DOM 投影。
- 所有 redline 都是可丢弃反馈，提交参考线仍只产生原有一次事务/revision/undo。

## 公开语义参照

- [Figma：Add guides to the canvas or frames](https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames)
- [Figma：Measure distances between layers](https://help.figma.com/hc/en-us/articles/360039956974-Measure-distances-between-layers)
