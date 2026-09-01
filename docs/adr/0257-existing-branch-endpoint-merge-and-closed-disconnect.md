# ADR-0257：Existing Branch Endpoint Merge 与 Closed Junction Disconnect

- 状态：接受
- 日期：2026-09-01
- Geometry Service contract：`25`

## 背景

合法 branch network 已能创建、移动、删除和切开 junction，但两个唯一开放 endpoint 仍因整网存在 branch 被拒绝 Connect；closed path 上的 shared junction 也无法断开明确 incident edge。两类输入都已完整命名目标，不需要模型或宿主猜测拓扑。

## 决策

1. `connectVectorEndpoints` 不再按整网是否存在 branch 拒绝 endpoint-to-endpoint Connect。两个目标仍必须分别解析为唯一开放 endpoint；shared junction 同时属于多个 path 时不会被误认成唯一 endpoint。
2. 不同 path 的唯一 endpoint 继续按文档 path 顺序保留较早 path ID，确定性定向并合并 references；重合点合并 vertex，不重合点创建一个稳定 connector。其他 branch vertex、segment、region 和 path ID 不变。
3. 同一 path 的两个唯一 endpoint 继续复用 Close。明确 `pathId` 的 Open/Close/Reverse 只要求 network 合法且 point-editable，不再因其他 path 存在 branch 被整网阻止；省略 `pathId` 时，多 path network 仍结构化拒绝。
4. closed path 上的 shared junction Disconnect 必须提供该 path 的明确 incident `segmentId`。宿主复制 junction，只把该 incident edge 改接到复制点，按稳定 traversal 打开 path，并移除引用失效 closed path 的 region；其他 owning path 保持连接原 junction。
5. Canvas 的 Connect 继续只提交两个稳定 endpoint；Open/Close/Reverse 在存在明确 active path 时开放。Disconnect 继续提交 active path、vertex 和唯一选中 incident segment。Agent 复用既有 `connect-endpoints`、`set-closed`、`reverse-path` 与 `disconnect-vertex` action，不新增工具或 Schema 分支。
6. 所有结果继续通过 Geometry Service、EditorRuntime preview/apply、单 revision 与单 undo 提交。

## 影响

- existing branch network 不再因为无关分支而阻止明确 endpoint merge 或明确 path topology edit。
- repeated junction traversal 可以保存在同一个开放 path run 中；Vector Network invariant 仍要求 segment 唯一 ownership、引用连续和合法 closed/open 边界。
- shared junction 本身不是唯一 endpoint，仍不能通过 endpoint Connect 猜测某条 owning path。
- branch network 的拖拽 line Cut 在本决策中仍是独立边界，后续已由 ADR-0258 按 connected component ownership 完成。

## 验证

- Geometry 覆盖 branch network 中不同 path endpoint merge、同 path Close、稳定 ID、closed junction incoming/outgoing Disconnect 与 region 移除。
- Runtime 覆盖已有 branch 的 Connect、Close 和 closed-junction Disconnect 单事务计划与 undo。
- Canvas 覆盖明确 active path 的 Open/Close/Reverse，以及唯一 endpoint Connect/incident-edge Disconnect。
- Agent 继续通过现有统一 Vector Contract 与执行入口，不新增模型生成 topology。
