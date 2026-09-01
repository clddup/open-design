# ADR-0254：Branch Junction Endpoint Disconnect 与 Segment Cut/Delete

## 状态

已接受，2026-09-01。

## 背景

ADR-0249 与 ADR-0253 已让合法 branch network 保持节点变换、独立入射 handle 和明确 segment Bend，但 `disconnect-vertex`、`cut-path` 与 segment Delete 仍先经过整网非分支门禁。结果是一个 path 仅以开放 endpoint 接入 shared junction 时，虽然目标 path、junction 和待分离的唯一入射边都已明确，人工与 Agent 仍无法执行可逆的普通断开；明确 branch segment 的 Cut/Delete 也被不必要地拒绝。

内部 junction 同时连接目标 path 的入边和出边；现有 `{ pathId, vertexId }` 输入没有指定应分离哪一条 incident edge，不能用固定方向替用户猜测。

## 决策

1. Geometry Service contract 22 的 `disconnectVectorVertex(network, pathId, vertexId)` 先验证完整 network，再只解析显式 `pathId`，不因其他 path 存在 branch 而把整网设为只读。
2. 当 shared junction 是目标开放 path 的 endpoint 时，宿主复制该 vertex，在原坐标保留视觉连续性，并只把目标 path 拥有的 segment endpoint 改接到复制点。其他 path、segment、handle、region 和稳定 ID 保持不变。
3. 结果继续返回两个同坐标但拓扑独立的 endpoint ID，由 EditorRuntime 在一个 revision/undo 中归一化并提交。Canvas 只有在唯一选中 vertex 且明确 active path 时开放 Disconnect；Agent 继续复用统一 `opendesign_edit_vector disconnect-vertex`，不新增工具。
4. shared junction 位于开放目标 path 内部时，调用方必须再提供该 path 上明确的 `segmentId`。宿主在 junction 复制 vertex，把所选 incident edge 改接到复制点，并在该 vertex 处把 path 确定性拆成两个开放 runs；未选 incident edge 与其他 branch path 保留原 junction。结果继续允许节点级编辑，但剩余的 connected path runs 在后续 merge 语义完成前仍使用 topology-specific 门禁，不得通过删除既有 path ID 假装归一化。闭合 branch junction 继续结构化拒绝。普通 path 内部 Disconnect 即使同一 network 的其他位置存在 branch，也可沿既有确定性切分语义执行。
5. `cutVectorPath` 同样只解析显式 path。明确 segment 的内部参数 Cut 可在 branch network 上执行并生成两个同坐标 endpoint；junction 顶点 Cut 只在它是目标开放 path endpoint 时复用上述 detach 语义，内部 junction 顶点继续拒绝。
6. Leafer/Canvas 在 branch network 上开放 Cut 路径点击并提示当前边界；拖拽 line Cut 仍只在完整 topology-editable network 上执行。Agent 复用既有 `cut-path` action，不新增工具。
7. segment Delete 同样以显式 `segmentId[]` 为充分目标。Geometry 只删除这些边并按既有稳定顺序保留或拆分 owning path；Leafer 在 branch network 中仍拒绝 vertex Delete，但允许已选 segment Delete。Agent 在统一 `opendesign_edit_vector` 中增加同层级 `delete-segments` action，不增加新的工具名，也不让模型重写 network。

## 影响

- 一次明确的 branch endpoint Disconnect 或 branch segment Cut/Delete 不再被全局 topology 门禁误伤，也不要求重写完整 network。
- 人工和 Agent 共用 Geometry/EditorRuntime 入口、稳定 ID、当前 revision 和一次 undo。
- 闭合 branch junction Disconnect、junction 顶点 Delete/Cut、拖拽 line Cut 与已有 branch network merge 仍待后续独立语义；不得把本切片描述为完整 branch topology 编辑。

后续 ADR-0255 与 ADR-0256 已分别完成 junction vertex Delete 和明确 path 上的 junction vertex Cut；ADR-0257 已完成 closed incident-edge Disconnect 与 existing branch 唯一 endpoint merge；ADR-0258 已完成按 connected component ownership 分配的 branch network 拖拽 line Cut。
