# ADR-0288：Figma-compatible Vector Pen 沿现有路径插点

## 状态

Accepted

## 背景

ADR-0287 已允许从一个选中锚点向画布候选位置创建连接点，但 Vector Edit 中的 Pen 仍不能像 Figma 一样点击已有 line/cubic segment 插入锚点。用户只能借助 Cut 或重建轮廓，前者改变拓扑语义，后者会破坏稳定 path/segment/region 身份。

Figma 公开文档把以下行为列为同一个 Vector Edit 工作流：Pen 点击已有 path 增加锚点，点击拖拽创建 Bézier handles，并可从选中锚点继续绘制：

- <https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>
- <https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks>

## 决策

### 1. Geometry Service 提供无损 segment split

Geometry Service contract 41 增加 `insertVectorPoint(network, pathId, segmentId, t)`：

- 只接受目标 path 内部的真实 line/cubic segment 与 `0 < t < 1`；
- line 按参数线性拆分，cubic 使用 de Casteljau 精确拆分，拆分前后渲染曲线一致；
- 原 segment ID 保留给 path traversal 的第一段，第二段与新 vertex 使用可信宿主分配的稳定 ID；
- 正向与 reversed reference 都保持原 traversal 顺序和 storage-direction handle 语义；
- closed path、region、Fill 与未受影响 path/segment/vertex ID 保持不变；
- 非有限参数、端点、缺失目标或非法 network 显式失败且不修改输入。

共用的 directed-curve、de Casteljau 与 storage-direction 转换从既有 Cut 实现提取为一个内部 Geometry 模块，Cut 和 Pen 不再各自维护一套曲线拆分算法。

### 2. Vector Edit 内提供 Pen 次级工具

Vector Edit 工具条加入 `Pen (P)`。该模式属于当前 Vector Edit session，不退出到创建独立 Vector 的顶层 Pen，也不建立第二份文档状态：

- 点击 path hit area 时，按最近 `segment + t` 生成无损插点预览；
- 点击拖拽新点时，为入射/出射 segment 写入镜像 handles；
- 点击现有锚点只更新当前节点选择；
- 单选一个锚点后点击画布，沿用 ADR-0287 的 append 语义继续 path 或创建真实 branch；
- 每次 pointer-up 最多提交一个既有 `onVectorEdit` 请求、一个 EditorRuntime revision 和一个 undo step。

### 3. 失败恢复权威投影

Pointer cancel、Escape、工具切换、read-only、callback/stale revision 拒绝或拖拽几何失败都恢复开始前的权威 network 与节点/segment 选择。拖拽失败状态不得在 pointer-up 提交旧 preview。预览、hit path、handles 和选择保持 session-only，不进入文档、history、capture 或 export。

### 4. 不扩大 Agent 工具和文档协议

本切片不新增 Agent tool、DesignDocument 字段、权限或持久状态。人工 Pen 继续通过现有 Vector transaction 入口；Agent 仍使用既有 Vector 语义工具。Geometry Service contract 递增只记录新增的公共纯几何语义，不代表产品版本。

## 验证

- Geometry：line/cubic 无损拆分、正向/reversed reference、closed region 保留、端点和缺失目标失败关闭、输入不突变。
- Leafer：点击只提交一次、拖拽 mirrored handles、从新点连续绘制、callback 拒绝恢复、read-only 零写入。
- Desktop：Vector Edit 工具条、`P` 快捷键、选中状态、中英文操作提示。
- 回归：既有 Cut 继续复用同一曲线拆分语义；Move/Bend/Paint/Lasso、顶层 Pen、revision 与 selection 行为不变。

## 后续

- path 最近点和 Bézier handle 的测量与吸附。
- Pen 新起独立 contour、闭合反馈与更多 branch authoring 细节。
- macOS/Windows 打包产品的真实指针、键盘、HiDPI 与视觉证据。
