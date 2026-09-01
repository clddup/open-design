# ADR-0255：Branch Junction Vertex Delete

- 状态：接受
- 日期：2026-09-01
- Geometry Service contract：`23`

## 背景

ADR-0249、ADR-0253 与 ADR-0254 已让 branch network 的节点、handle 和明确 incident edge 可编辑，但选中 shared junction 后按 Delete 仍被整网 `topologyEditable` 门禁拦截。删除节点的目标已经由稳定 `vertexId[]` 完整表达，不存在需要宿主猜测的 incident edge；继续拒绝会让普通 Figma 式节点编辑因为网络中存在分支而退化为只读。

## 决策

1. `deleteVectorVertices(network, vertexIds)` 只要求 network 通过 schema/invariant 与 point-editability 校验，不再要求整网满足非分支 topology editability。
2. 删除一个 shared junction 时，Geometry Service 按每个 owning path 独立应用既有节点删除语义：移除目标节点，保留仍相邻的原 segment；跨越被删节点的 surviving neighbors 由宿主建立确定性 connector。过短 path 被删除，引用失效 closed path 的 region 同步删除。
3. 未受影响的 vertex、segment、path 与 region ID 保持不变；生成的 connector 使用 Geometry Service 的稳定 ID。若全部 path 消失，Runtime 删除 Vector node。
4. Leafer 的 Delete/Backspace 不再因 `topologyEditable=false` 禁止已选 vertex；point mode、闭合 branch Disconnect、junction Cut 与已有 branch merge 的独立门禁不变。
5. Agent 继续复用 `opendesign_edit_vector`，增加同一工具内的 `delete-vertices` action。模型只提交 inspection 返回的 `nodeId + vertexIds`，不能重写完整 network。
6. Canvas 与 Agent 都通过同一 EditorRuntime planner、preview/apply、单 revision 和单 undo 提交。

## 影响

- branch junction Delete 成为与普通节点 Delete 一致的直接编辑，不再把明确操作误判为歧义拓扑变更。
- 本决策没有新增工具名、第二份文档状态或兼容分支。
- junction vertex Cut、闭合 branch junction Disconnect 与已有 branch network merge 仍是后续独立语义，不得因本切片完成而放开。

## 验证

- Geometry 覆盖 Y 形 shared junction 删除、稳定主 path ID、确定性 connector 与恢复普通 topology editability。
- Runtime 覆盖 branch network 的 typed `delete-vertices` planner。
- Leafer 覆盖 `topologyEditable=false` 时 vertex Delete 仍提交，其他歧义控件继续关闭。
- Agent Contract 与执行层覆盖闭合 schema、Runtime 路由、单 revision/undo。
