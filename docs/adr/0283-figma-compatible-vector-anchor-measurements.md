# ADR-0283：Figma-compatible Vector 锚点距离测量

## 状态

Accepted

## 背景

OpenDesign 已支持普通对象距离、标尺参考线距离和 Vector point-to-point geometry 吸附，但 Vector edit mode 中仍不能直接检查两个锚点的水平与垂直距离。

Figma 的公开行为是：进入 Vector edit mode，选中一个 anchor，按住 macOS `Option` 或 Windows `Alt`，再悬停另一个现有 anchor，显示两点的水平和垂直距离：

- <https://help.figma.com/hc/en-us/articles/360039956974-Measure-distances-between-layers>
- <https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>

该信息属于短生命周期编辑反馈，不应写入设计文档、事务或持久 selection。

## 决策

### 1. Geometry Service 只计算 document-space 两轴距离

Geometry Service contract 37 的 `measureVectorAnchorDistances` 接受 source/target 稳定身份和 document-space point，返回非零水平、垂直 measurement segment。它不持有文档、hover、按键或 viewport 状态。

### 2. 只在一个锚点被选中时显示

Leafer Vector edit scope 中所有层合计恰好选中一个 anchor 时，它成为测量 source。悬停当前 scope 内另一个 anchor 才形成 target；多选、同一 anchor、path、region、Bézier handle、selection box 和空白处均不猜测测量对象。

### 3. 坐标与多层编辑一致

source/target 均从权威 Vector Network 的 node-local point 通过当前可见 world transform 转为 document space，因此嵌套、旋转、缩放和同时编辑多个 Vector layer 不退化为局部坐标或 world AABB。

### 4. 复用现有红线 overlay

Vector controller 使用独立短生命周期状态追踪 hover 和 Option/Alt，但复用既有 `DistanceMeasurementOverlay` 的屏幕尺度 1 px redline 与标签。按键后无需再次移动鼠标即可显示；keyup、pointer leave、window blur、pointer down、drag、scope/selection/revision 变化和退出 Vector edit 均清理。

### 5. 不改变设计事实与工具面

测量不调用 EditorRuntime，不产生 revision/history/undo，不进入 capture/export，也不增加 Agent tool、DesignDocument 字段或 snap preference。Figma 文档中“点击画布创建新 anchor”属于 Pen authoring，继续由 Pen 路线单独实现，不混入只读测量反馈。

## 验证

- Geometry：双轴、单轴、无效 point 与稳定 ID。
- Controller：先 hover 后按 Option/Alt、keyup、pointer leave、blur、selection 变化、viewport sync 和 dispose。
- Adapter：旋转 Vector 的 node-local anchor 转为 document-space 两轴红线与标签，且零 Vector edit callback/revision。

## 后续

- path 最近点与 Bézier handle 吸附/测量。
- Pen 新锚点创建与自动连接。
- macOS/Windows 打包产品的真实指针、键盘、HiDPI 与视觉证据。
