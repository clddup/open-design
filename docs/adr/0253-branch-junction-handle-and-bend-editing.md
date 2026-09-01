# ADR-0253：Branch Junction Handle 与 Bend 编辑

## 状态

已接受。

## 背景

ADR-0249 已让 degree>2 branch junction 可选择、移动和变换，但整个 network 的 `topologyEditable=false` 同时关闭了本来没有歧义的已有 Bézier handle。Figma 的 Vector Network 以 segment endpoint 持有控制柄；明确的 `segmentId + side` 足以标识一条入射边，不需要猜测 junction 属于哪个 path。

## 决策

1. Geometry Service contract 21 将 handle/Bend 与拓扑变更分开。合法 branch network 继续关闭 point mode、Delete、Disconnect、Cut 和 branch merge，但不再关闭明确 segment 的 handle move 与 Bend。
2. `moveVectorHandle` 先验证 network invariant，再以 `segmentId + side` 定位真实 endpoint。普通 contour 继续遵循 mirrored/smooth 关系；一个 vertex 同属多个 path 时，只修改命中的 segment handle，并把 junction 标记为 `independent`，不联动其他入射边。
3. `bendVectorSegment` 继续要求明确 `pathId + segmentId + t + point`。branch network 中只改该 segment 的两个控制柄，不重写 path、vertex、region 或稳定 ID。
4. Leafer 在 branch network 上显示并允许拖动已有 handle，也允许 Bend 命中 segment；point mode、Delete 与 Cut 的 topology guard 保持不变。所有预览仍是 session-only，pointer-up 继续通过既有 Runtime 事务提交。
5. Agent 不增加新工具。既有 `opendesign_edit_vector` 的 `bend-segment` 复用同一 Geometry/Runtime 路径；模型仍不提交 handle、network 或结果 ID。
6. 结果属于 Design File。当前 Run 的失败、取消或 Provider 异常不锁定 junction，同一 Conversation 的后续消息可以继续编辑。

## 结果

- branch junction 不再因为存在歧义拓扑就整层退化为无手柄只读。
- 一条入射边的曲率调整不会意外改变其他分支。
- Delete、Disconnect、Cut 与已有 branch merge 仍需分别定义稳定拓扑结果，不能借 handle 能力放宽。

## 后续决策

ADR-0254 已放开显式开放 path endpoint/明确 incident edge 从 shared junction 的 Disconnect 与明确 branch segment Cut/Delete；ADR-0255、ADR-0256 又分别完成 junction vertex Delete 与明确 path 上的 junction vertex Cut。ADR-0257 已继续完成 closed incident-edge Disconnect 与 existing branch 唯一 endpoint merge；ADR-0258 已按 connected component ownership 完成 branch network 拖拽 line Cut。

## 验证

- Geometry：degree>2 junction 的单 handle 独立移动、其他入射 handle 保持、branch segment Bend 与 invariant。
- Leafer：`topologyEditable=false` 时已有 handle 仍可拖动并只提交一次，point mode/Delete 继续关闭。
- Agent/Runtime：既有 `bend-segment` 使用稳定 path/segment ID，不新增工具或模型生成 geometry。
