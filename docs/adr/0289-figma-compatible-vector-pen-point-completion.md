# ADR-0289：Figma-compatible Vector Pen 节点闭合与连接

## 状态

Accepted

## 背景

ADR-0288 已允许 Vector Edit Pen 沿现有 line/cubic segment 无损插点，并从一个选中节点继续绘制。但点击另一个现有节点仍只会切换选择，不能按 Figma Pen 心智完成当前路径，因此用户必须退出 Pen 再手工执行 Connect。

Figma 当前公开说明要求 Pen 可以把路径完成在 vector network 的另一个点上，并用闭合目标提示表达即将发生的连接；Vector Network 允许多条 path 在不同方向分支：

- <https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks>
- <https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>

公开测量文档只定义 Vector Edit 中锚点到锚点或新锚点的测量，没有定义 path/handle 测量，因此本切片不为追逐旧 roadmap 措辞而发明额外交互：

- <https://help.figma.com/hc/en-us/articles/360039956974-Measure-distances-between-layers>

## 决策

### 1. Pen 点击另一个节点表示完成当前路径

Vector Edit Pen 中同一 Vector layer 恰好选中一个 source vertex 时，悬停另一个 vertex 会显示放大的闭合目标 ring；点击目标后直接复用 Geometry Service contract 41 已有的 `connectVectorEndpoints`：

- 同一开放 path 的两个 endpoint 关闭该 path，并创建真实 closing segment 与 region；
- 两条开放 path 的 endpoint 合并为一条稳定 path；
- 一个开放 endpoint 连接到另一 path 的 vertex 时创建真实 shared junction branch；
- source 与 target 相同只保留选择，不产生事务；
- 同一 path endpoint 到内部 vertex 等现有 Geometry 明确不支持的歧义 topology 继续结构化拒绝，不猜测 region ownership。

成功连接后清空节点/segment 选择，表示该次 Pen path 已完成；用户仍停留在 Vector Edit Pen，可重新选择 endpoint 后继续绘制。

### 2. 反馈与选择保持 session-only

闭合目标 ring 只由当前 tool、同层单选 source、hovered target 与 viewport zoom 派生。pointer leave、window blur、工具/选区/revision 变化或 drag 开始立即清理。ring 不进入 DesignDocument、history、capture 或 export。

### 3. 继续复用唯一事务入口

点击只调用一次现有 `onVectorEdit`，由 Renderer 按 exact document/Page/revision 进入唯一 EditorRuntime transaction。callback/stale 拒绝恢复权威投影并保留原选择；不新增 Agent tool、Geometry 算法副本、DesignDocument 字段、权限或第二套可写状态。

跨 Vector layer 的 Pen 连接继续使用既有多层 Connect 工作流，不在本切片把单 layer pointer 操作暗中升级为跨层 mutation。

## 验证

- 同一开放 path 两端点击后得到 closed path、closing segment 与 region，且只提交一次。
- 悬停目标 ring 保持屏幕尺寸，离开、blur、选区/tool/revision 变化后清理。
- endpoint 到另一 path 内部 vertex 创建 shared junction branch，稳定 ID 与未受影响 path 保留。
- 无 source 时点击节点只建立起点选择；read-only 与 callback/stale 拒绝零写入。
- Desktop 中英文提示明确“继续绘制或点击另一节点完成路径”。

## 后续

- Vector Edit Pen 在空白处开始新的独立 contour，并在同一 network 内连续创建多 contour。
- 顶层 Pen 的多 contour 与 branch authoring。
- path/handle 吸附，以及 macOS/Windows 打包产品的真实指针、键盘、HiDPI 与视觉证据。
