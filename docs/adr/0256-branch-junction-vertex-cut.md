# ADR-0256：Branch Junction Vertex Cut

- 状态：接受
- 日期：2026-09-01
- Geometry Service contract：`24`

## 背景

明确 branch segment 已可 Cut，但 shared junction 上的节点 Cut 仍被拒绝。`cut-path` 已同时携带稳定 `pathId` 与 `vertexId`，目标 path 不存在歧义；继续要求额外 incident edge 会重复表达同一意图，并让 Canvas 与 Agent 无法对一个已选 path 执行普通节点断开。

## 决策

1. `cutVectorPath(network, pathId, { kind: "vertex", vertexId })` 可以处理该 vertex 被多个 path 共享的合法 network。
2. shared junction 是目标开放 path endpoint 时，继续复用 endpoint detach：复制 junction，只把目标 path 改接到复制点。
3. shared junction 位于目标开放 path 内部时，按该 path 的稳定 traversal 在 junction 处分成 prefix/suffix 两个开放 runs；prefix 保留原 path/vertex，suffix 使用确定性新 path/vertex。其他 path、segment、region 和稳定 ID 不变。
4. shared junction 位于目标 closed path 时，沿目标 path traversal 打开该 contour；失效 region 被移除，其他 owning paths 保持连接原 junction。
5. Canvas 在 shared vertex 上不猜 path。Renderer 把当前选中 segment 推导出的 `activePathId` 传给 Leafer；没有唯一 active path 时，junction 点击 Cut 不执行。Agent 本来就必须提交 inspection 返回的明确 `pathId`。
6. 点击 Cut 继续经过 Geometry Service、EditorRuntime、preview/apply、单 revision 与单 undo。拖拽 line Cut 在 branch network 上仍保持独立门禁。

## 影响

- junction vertex Cut 不再因为同一节点被多个 path 共享而被整网拒绝。
- `Disconnect` 与 `Cut` 语义保持区分：Disconnect 可用明确 `segmentId` 选择内部 junction 的某条 incident edge；Cut 根据明确 path traversal 创建断点，不再增加字段。
- 后续 ADR-0257 已完成 closed incident-edge Disconnect 与已有 branch network 的唯一 endpoint merge；ADR-0258 已完成 branch network 拖拽 line Cut。

## 验证

- Geometry 覆盖开放 path 在 Y 形 shared junction 上的确定性 prefix/suffix、稳定 branch path 与合法结果 network。
- Runtime 覆盖 branch network 的 typed vertex `cut-path` plan。
- Leafer 覆盖 `topologyEditable=false` 时，只有存在明确 `activePathId` 的 junction 点击才提交正确 `{ pathId, vertexId }`。
- Agent 继续复用既有 `cut-path` contract，不新增工具或重复结构 Schema。
