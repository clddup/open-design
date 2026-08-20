# ADR-0113：Vector 节点套索与多点变换框

- 状态：Accepted
- 日期：2026-08-20
- Geometry Service contract：`12`
- DesignDocument：不变（`1.36.0`）
- Agent tool：`opendesign_edit_vector`（增加 `transform-vertices`）
- 关联：ADR-0026、ADR-0027、ADR-0040、ADR-0112

## 背景

OpenDesign 已支持一个或多个 Vector 图层同时进入节点编辑，并可 Shift-click 多选、移动和删除节点，但复杂 Logo、图标与插画仍缺少专业工具常见的自由圈选和多点缩放/旋转。普通图层已有 Leafer Editor 框选与变换框；它不能直接用于 Vector 内部节点，因为节点选择是 session state，节点变更还必须经过 editable-network Geometry Service、tight bounds 和唯一 EditorRuntime 事务。

Figma 的公开 Vector Edit 行为包括 Lasso（`Q`）以及多节点 bounding box；缩放可用 Shift 保持比例、Option/Alt 从中心缩放，旋转可用 Shift 吸附 15°。Figma Lasso 还能选择 path segment，而 OpenDesign 当前节点编辑状态只持有稳定 `vertexIds`，没有 segment selection。

## 决策

### 节点 Lasso v1 是 session-only selection

Vector Edit 次级工具栏增加 Lasso（`Q`）。拖动轨迹按每个编辑中 Vector 的本地坐标采样，因此嵌套 transform 和 viewport pan/zoom 不改变命中结果：

- polygon 内部或边界上的节点进入选区；
- Shift-drag 切换圈内节点，普通拖动替换节点选区；
- 多 Vector edit collection 分别维护稳定 `nodeId → vertexIds`，最后一个有命中结果的图层成为 active；
- 只读图层可圈选检查，但不会开放变换；
- 轨迹、选区和 active layer 不进入文档、revision、history、capture 或 export。

本切片不声称支持 segment selection；path segment 的稳定选中身份、样式和删除语义必须作为后续契约完成。

### 多点变换框复用可校验节点仿射变换

Move 模式中同一 Vector 选中两个或更多节点时显示八向 resize handles、内部 move hit area 与四角外侧 rotation hit area：

- 边/角拖动缩放，Shift 保持比例，Option/Alt 从中心缩放；
- 旋转时 Shift 吸附 15°；
- preview 只更新当前 Leafer 投影，pointer-up 才提交一次 network update、revision 与 undo step；
- Escape/cancel、tool/revision/node scope 变化丢弃 preview 并恢复权威 network；
- locked/read-only 只显示选区，不接受变换。

Geometry Service v12 增加 `vectorVertexBounds` 和 `transformVectorVertices`。后者接受稳定 vertex IDs 与 node-local `[a,b,c,d,e,f]`，同时变换节点和附着在这些节点上的 Bézier tangent endpoints，再由 Runtime 统一 normalize tight bounds 和补偿节点 transform。

### Agent 使用同一 Geometry/Runtime planner

`opendesign_edit_vector transform-vertices` 只接受 inspection 返回的 Page、Vector、vertex IDs 和有限 node-local matrix。模型不能提交完整 network、bounds、结果 ID 或实时 selection。人工 Canvas 与 Agent 最终都经过 Geometry Service、`planVectorNetworkUpdate`、Runtime preview/apply、revision、history、保存重开和 SVG metadata v2。

## 后果

- 节点级选择和变换达到可用于 Logo/Icon 精修的基础专业交互，不重复普通图层变换状态。
- 文档 schema 和 SVG metadata 不升级，因为只改变既有稳定节点坐标、tangent 与外层 tight bounds。
- 本切片不完成 segment Lasso、跨 Vector 图层统一节点变换框、Space 在 resize/rotate 中途平移、skew、分支网络、flatten 或 outline stroke；这些边界继续在 capability manifest 与 roadmap 中保持明确。

## 验证

- Geometry：选中 bounds、平移/非均匀缩放/旋转、tangent 跟随、missing/no-op/非有限矩阵；
- Leafer：Lasso replace/Shift toggle、轨迹清理、只读状态、八向 resize、rotation、Shift/Alt modifier、preview 不提交与 pointer-up 单提交；
- Runtime/Agent：显式 vertex IDs、严格 matrix schema、tight bounds、selection 隔离、preview/apply、单 revision、undo/redo、保存重开；
- 回归：Cut guide 层级、普通 Vector 点拖动、多 Vector edit、viewport 与现有 Connect/Disconnect/Cut 行为不变。
