# ADR-0247：Vector Dash 与顶点描边外观保真

## 状态

已接受。

## 背景

Figma 的 `dashPattern` 属于节点描边；`VectorVertex.strokeCap/strokeJoin` 可覆盖节点 fallback。此前 OpenDesign 对两者组合只能在 Leafer 降级为节点级外观，并在 Outline、Flatten 与 SVG 中拒绝，原因是逐 segment 投影会让 dash phase 在每个顶点重新开始。

## 决策

1. Geometry Service contract 19 为一个 path traversal 维护一条 dash cursor；phase 跨 authored segment、cubic 与 disposable rounded segment 连续推进，不在顶点重置。
2. 任意正数 custom dash pattern 均按 SVG/Figma 的偶数化规则解析；奇数项序列复制一遍。无效、空投影与超预算输入结构化失败。
3. line 以精确长度切分；cubic 使用确定性 Gauss-Legendre arc-length 积分与二分反解生成精确 cubic subcurve，不把曲线折线化。
4. dash 片段内部跨顶点时保留该 vertex 的 join override；dash 边界使用节点级 cap，开放 path 的真实端点仍使用 vertex cap override。投影 ID 与切分点不进入文档、selection 或 history。
5. Leafer、Outline Stroke、Flatten、Boolean operand 与标准 SVG stroke parts 消费同一投影，不再以 fallback 或错误掩盖 dash + vertex override。受控 SVG metadata 继续保存 authored network 与节点 `dashPattern`，不保存 disposable dash topology。
6. 本切片不新增 Agent 工具或 DesignDocument 字段；人工与 Agent 继续通过既有 `dashPattern` 和 `set-vertex-stroke-appearance` 编辑同一事实。
7. 这是 Design File 外观能力，不属于创建 Run。单轮失败、取消或 Provider 异常不影响同一 Conversation 的后续消息继续编辑。

## 结果

- custom dash 不再因顶点覆盖而被禁用，Canvas、导出、Outline、Flatten 与 Boolean 共用连续 phase。
- authored Vector Network 保持不变，所有 dash fragment 都是可丢弃投影。
- 分支网络的多路径 phase 起点、真实 Figma 像素 baseline 和双平台产品证据继续由后续切片完成。

## 验证

- Geometry：跨 segment phase、custom/odd pattern、line/cubic 切分、join/cap override、corner radius/smoothing 共存与预算失败。
- 消费者：Leafer 无 fidelity warning、Outline/Flatten 生成 filled editable Vector、Boolean operand 可解析、SVG 输出独立标准 stroke parts 并恢复 authored metadata。
- 回归：无 dash 与无 vertex override 路径保持原投影；单事务、undo/redo/save-reopen 与持续 Conversation 语义不变。
