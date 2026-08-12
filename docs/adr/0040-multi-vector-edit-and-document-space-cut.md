# ADR-0040：多 Vector 编辑作用域与文档坐标 Cut

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：不变（`DesignDocument 1.10.0`）
- Service contract：不变（`Geometry Service v7`）
- 关联：ADR-0009、ADR-0026、ADR-0027、ADR-0038、ADR-0039

## 背景

ADR-0039 已完成单个 Vector layer 的有限线拖拽 Cut，但用户在专业编辑器中会同时编辑多个矢量图层，并希望用一条切线穿过所有选中对象。若 Canvas 为每层分别提交事务，会产生部分成功、多个 revision 和碎片化 undo；若把同一屏幕坐标直接交给每层 geometry，会在父级变换、画布平移或缩放后切错位置；若只显示 active layer 的控制点，用户也无法确认当前编辑集合。

Figma 当前公开行为允许一个或多个 Vector layers 进入 Vector Edit，并通过 Shift 点击加入编辑集合、macOS Command / Windows Control 点击切换编辑图层。Cut 可以从一个或多个 Vector layers 开始。OpenDesign 采用这些产品语义，但继续保持自有文档、Runtime 和短生命周期 Leafer 投影。

参考：

- [Figma：Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- [Figma：Vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)

## 决策

### 编辑集合与 active layer 分离

Vector Edit state 保存有序 `nodeIds`、独立 `activeNodeId`、逐层 `selectedVertexIds` 和当前 Move/Cut tool。一个或多个已选且具有 editable network 的 Vector/Path 可通过 Enter 或双击进入；Shift 点击可加入另一个 Vector layer，macOS Command / Windows Control 点击可切换成员。最后一个成员被切换掉时退出 Vector Edit。

Leafer adapter 为集合内每层维护独立的短生命周期 session 和 overlay。所有成员显示 path trace 与 anchors，命中的 layer 成为 active；节点和手柄编辑只提交命中层。overlay 不进入文档、保存、history、selection 或导出，锁定成员保持可检查但只读。

### 公共切线使用 document coordinates

拖拽 Cut 同时维护：

- document-space `start/end`，作为跨层语义输入；
- 发起 layer 的 node-local `start/end`，只用于显示临时 guide；
- client-space 起点，只用于 4 px drag threshold。

画布 pan/zoom 只改变 viewport 投影。它不修改 document-space 切线、Vector geometry、revision 或目标集合；overlay 在 viewport 事件中重绘并继续依附权威 document tree。macOS 与 Windows 使用同一 document/world transform 路径，不按平台复制几何算法。

### Runtime 负责逐层坐标转换与单事务

`planVectorLayersLineCut(document, pageId, targets, start, end)` 接收明确稳定的 source/result pairs 与 document-space 有限线。可信宿主对每个 source 解析 world transform 并求逆，再把切线转换为该层 node-local coordinates，复用 Geometry Service v7 的 `cutVectorNetworkByLine`。

- 未被切线命中的显式目标不产生操作；全部未命中返回 `no-op`；
- 缺失、锁定、不支持拓扑或 non-invertible target 让整份 plan 失败，不返回可提交的部分结果；
- 同父级 source 按原 sibling index 降序规划 insert，最终顺序稳定为 `source, result, source, result`；
- 所有命中层的 update + insert 合并为一次 preview/apply、一个 revision 和一个 undo；
- 人工 Canvas 只提交编辑集合中的可写成员，锁定成员仍保留只读 overlay；Agent 明确指定锁定目标则整体失败，不能静默缩小模型声明的目标。

文档 schema 与 Geometry Service contract 不升级：单层切割算法和两个标准 Vector nodes 的表达均未改变，本切片增加的是可信宿主的多目标编排和坐标边界。

### Agent 使用相同的多目标 planner

`opendesign_edit_vector` 增加 `cut-layers-with-line`。模型只能提供 inspect 所得 `pageId/nodeIds` 与 document-space `start/end`，不能提供 result IDs、network、bounds、transform 或实时 selection。Renderer host 为每个目标生成有界稳定 result ID，复用同一 planner、mutation target 校验、preview 与原子 apply，并返回实际命中 targets、intersection counts、result IDs、revision、changes 与 warnings。

原有 `cut-with-line` 继续保留单节点 node-local 输入，避免静默改变既有 tool call 的坐标语义。

## 验证

自动化覆盖：

- 有序多层 edit scope、active layer、逐层 point selection、Shift add 与 Command/Control toggle；
- 多 overlay 创建/销毁、active layer 切换、只读成员过滤、Escape 和 viewport 重绘；
- transformed parent 下 document → node-local 转换、未命中跳过、duplicate/non-invertible/locked 失败；
- 同父级稳定插入顺序、一次 revision、undo/redo、保存重开；
- Canvas 多选进入、一次 Cut 后选择所有 source/result layers；
- Agent schema、宿主 result IDs、selection 隔离、mutation target、原子结果与结构化 target report。

## 当前限制

- Pen 仍只创建单条非分支 contour；编辑集合只接受当前支持的互不连接非分支 networks。
- open stroke division、compound hole redistribution、单 contour 四次及以上 crossing、self-intersection、connected/branching network、connect/disconnect、lasso、多点变换框、flatten、outline stroke 与正式 Slice 尚未完成。
- 真实像素 baseline 与 macOS/Windows 打包程序的鼠标、触控板、DPI 和性能交互仍待人工验收，因此相关 capability 保持 `degraded`。

## 后果

- 用户可以在移动画布查看生成或编辑过程时保持骨架、控制点、Cut guide 与真实对象对齐；viewport 不再参与设计数据。
- 多层 Cut 不会因循环调用单层事务留下半成功文档，也不会要求模型或 Canvas 手算父级变换。
- 后续 open stroke、compound hole 与 concave multi-crossing 继续扩展 Geometry Service 的单层语义；多目标编排无需再次重写。
