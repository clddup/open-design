# ADR-0041：开放描边的版本化有限线 Cut

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：不变（`DesignDocument 1.10.0`）
- Service contract：`Geometry Service v8`
- 关联：ADR-0026、ADR-0027、ADR-0038、ADR-0039、ADR-0040

## 背景

ADR-0039 的有限线 Cut 只接受每条恰好有两个横穿交点的闭合 contour；ADR-0040 已把该几何语义扩展到多 Vector 编辑集合和 document-space 公共切线。专业矢量编辑器还必须允许切线穿过开放描边，否则 Pen 创建的开放路径只能用点击 Cut 逐点拆开，多层 Cut 又会因其中一个开放目标而整体失败。

开放描边不能复用闭合轮廓的 connector 逻辑：补连接边会改变路径外形与 cap 语义，创建 region 或保留 Fill 会把本来开放的线静默变成封闭面积。它也可能被一条有限线横穿一次、两次或更多次，不能套用闭合 contour “必须两个交点”的限制。

Figma 当前公开说明把 Cut 定义为拖过一个或多个 vector paths，并明确开放 vector path 的 endpoints/caps 语义；公开行为没有把开放 path 排除在 Cut 之外。OpenDesign 采用这一交互预期，但继续由自有 Vector Network、Geometry Service 与 EditorRuntime 定义可保存语义。

参考：

- [Figma：Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- [Figma：Vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)

## 决策

### Geometry Service v8 拥有开放 contour 分割语义

`cutVectorNetworkByLine(network, start, end)` 保持同一版本化入口，并新增开放 contour 行为：

- 按 path traversal 顺序收集所有真实 transverse crossings；
- 从最后交点向前调用精确 path Cut，避免前一次拆分让后续 segment parameter 失效；
- 同一 line/cubic segment 上的多个交点使用原始参数与当前上界重映射，不重复使用 stale `t`；
- 生成的 path pieces 按 traversal 顺序交替归属：第 0、2、4…片进入 retained network，第 1、3、5…片进入 extracted network；
- 含原始起点的第 0 片保留 source path ID，其余 vertex/segment/path ID 由现有确定性 ID allocator 产生；
- 所有开放片保持 `closed:false`，不补 connector、不创建 region，也不通过 Fill 发明隐式闭合面积。

闭合 contour 继续使用 v7 语义：每条受支持轮廓必须恰好两个横穿交点，两块补真实 connector，并保留 region/winding。一个 network 可同时包含独立 open/closed contours，最终仍只返回 retained/extracted 两份 schema-valid editable networks。

### 接触、相切与重叠的失败边界

- 开放 path 全局起点或终点与切线接触不算分割；若没有其他横穿交点，返回 `no-op`。
- vertex 去重和 transverse crossing 判定继续复用 v7；tangent 或无法消歧的边界返回 `unsupported-topology`。
- 与切线重叠的 line/cubic segment 继续明确失败，不能猜测切除范围。
- compound hole、闭合 contour 超过两个交点、self-intersection 与 connected/branching network 仍不在本切片内。

### Runtime、Canvas 与 Agent 不建立旁路

单层 `planVectorSemanticEdit` 与多层 `planVectorLayersLineCut` 继续调用同一个 Geometry Service 入口。多层 planner 可在一次 document-space Cut 中混合 closed/open targets，逐层求 world transform 逆矩阵，并把全部 update/insert 合并为一次 preview/apply、revision 和 undo。锁定、Page scope、stale revision、non-invertible transform 和原子失败行为不变。

人工 Canvas 的 Cut 手势、`opendesign_edit_vector cut-with-line` 与 `cut-layers-with-line` 只提交稳定目标和切线；模型与 Leafer 都不生成拓扑、结果 ID、bounds 或 transform。Viewport pan/zoom 仍只重投影 overlay，不参与几何或 revision。

### SVG 与持久化

开放分片继续使用受控 editable-network metadata v2，同时导出标准无 `Z` 的 SVG path。导入时必须同时通过 schema、拓扑与标准 `d` 一致性校验；两个 sibling nodes 分别恢复为开放 network 且 regions 为空。文档 schema 已能表达该状态，因此不升级 `DesignDocument`。

## 验证

自动化覆盖：

- 开放 line/cubic 的单交点、多个交点、同一 cubic 多交点参数重映射和 traversal 交替归属；
- endpoint 接触 no-op、tangent/overlap 失败、closed contour v7 兼容行为；
- Runtime preview/apply、tight bounds、transform offset、undo/redo、保存重开；
- 人工 Canvas 与 Agent 的 closed/open 混合多层 Cut、一次 revision/undo、selection 隔离和宿主结果 ID；
- 两个独立开放 sibling 的标准 SVG 无 `Z`、无 region、metadata v2 导出与可编辑再导入。

## 当前限制

- compound hole redistribution、闭合凹形 contour 的四次及以上 crossing、self-intersection 和 connected/branching network 尚未实现。
- connect/disconnect、lasso、多点变换框、flatten、outline stroke 与正式 Slice 仍是后续独立能力。
- 真实像素 baseline 与 macOS/Windows 打包程序的鼠标、触控板、DPI 和性能交互仍待人工验收，因此 capability 保持 `degraded`。

## 后果

- Pen 创建的开放描边与闭合图形可以使用同一 Cut 工具和同一多层事务，不再因 topology 类型切换工作流。
- 开放 path 的 endpoint、cap、无 region 与无 Fill 语义在 Runtime、Canvas、Agent、保存和 SVG 中保持一致。
- 后续 compound hole 与闭合凹形多交点可继续扩展 Geometry Service，而不改写多目标 planner 或引入第二份画布状态。
