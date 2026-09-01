# ADR-0249：Vector Branch Junction 节点编辑首切片

## 状态

已接受。

## 背景

跨 Vector Endpoint Connect 已能原子合并 sibling 图层，但 editable Vector 仍把任何 degree 大于 2 的网络整体标为只读。这样既阻止创建真实分支，也错误地把“部分 topology 操作尚未定义”扩大成“已有节点不能选择或移动”。OpenDesign 是持续对话编辑 Agent；分支结果一旦写入 Design File，就必须与其他历史设计一样可由当前或后续 Conversation Run 继续编辑，不能归创建 Run 所有。

## 决策

1. Geometry Service contract 20 将节点编辑能力分为两层：`vectorNetworkPointEditability` 只要求 network schema/invariant 合法且至少存在一个 path；`vectorNetworkEditability` 继续表示需要无歧义 contour ownership 的完整 topology 编辑能力。
2. `connectVectorEndpoints` 保留两个开放 endpoint 的既有语义，并增加一个 endpoint 到另一 path vertex 的连接。非重合点创建真实 connector；重合 endpoint 直接替换为目标 junction，不产生零长度 segment 或孤儿 vertex。目标 junction 清除 circular corner radius，并使用 independent handle mode。
3. EditorRuntime、Canvas 和 Agent 沿用现有 `opendesign_edit_vector connect-endpoints` 与稳定 `{ nodeId, vertexId }`，不新增细碎工具。跨层连接继续由同一 planner 处理 parent、appearance、world/local transform、ID remap 与单事务删除。
4. 分支网络允许 point selection、point move、单层/跨层 affine transform 和 vertex stroke appearance。Leafer scope 分别暴露 `readOnly` 与 `topologyEditable`；分支网络不是只读，但会禁用 Bend/Paint/Cut、point mode、Delete、Close/Reverse/Disconnect 等当前会产生歧义的 topology 操作。
5. branch junction 同时属于多个 path，`findVectorPathIdForVertex` 不猜测唯一 path。已有 branch network 上的 endpoint-to-endpoint merge 继续明确失败，直到 traversal、handle ownership、Delete/Disconnect/Cut 和 region/stroke phase 语义完整定义。
6. 每次有效操作仍只产生一个 OpenDesign transaction、revision 与 undo。失败前不提交部分事务，也不通过 Leafer 内存建立第二份文档状态。
7. Conversation 是长期 Agent 上下文，Run 只是单轮执行。失败、取消、Provider/API 异常只结束当前 Run；后续消息必须可继续读取和编辑 Design File 中的 branch 及其他历史内容。

## 结果

- 用户和 Agent 可以创建真正的 degree>2 shared junction，并立即继续选择、移动和变换节点。
- 未完成的 topology 操作按动作禁用，而不是把整层永久锁成只读。
- 同层与跨层 Connect、人工与 Agent 路径继续复用同一 Geometry/EditorRuntime 事实源。
- 完整分支 topology 编辑仍是明确缺口，不以近似结果或隐藏修复冒充支持。

## 验证

- Geometry：endpoint→path vertex、非重合 connector、重合合并无孤儿 geometry、degree>2 检测、junction point move/transform、严格 topology guard。
- EditorRuntime：branch 创建、可写 scope、`topologyEditable=false`、junction transform、跨层 branch、单 revision/undo。
- Leafer/Canvas：分支节点仍可选择和拖动；point mode、handle、Delete、Bend/Paint/Cut 等歧义操作不会提交事务或生成用户错误卡。
- Agent：Provider 与 Runtime 共用 endpoint Contract，模型只提供 inspection 返回的稳定 IDs；结果 network 与 geometry IDs 由宿主生成。

## 后续决策

ADR-0253 已用明确 `segmentId + side` 和 `pathId + segmentId` 消除已有 handle move 与 segment Bend 的歧义，因此取代本 ADR 对这两项的暂时拒绝。point mode、Delete、Disconnect、Cut 与 branch merge 的边界保持不变。
