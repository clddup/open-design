# ADR-0248：跨 Vector 图层 Endpoint Connect

## 状态

已接受。

## 背景

OpenDesign 已支持同一 editable Vector 内的非分支 Connect，但 Figma 式节点编辑允许用户同时编辑多个 Vector 图层并连接两个开放端点。此前 Canvas 和 Agent 都只能把端点归属压成一个 `nodeId`，跨层选择会被拒绝；让模型重写完整 network 又会破坏稳定 ID、并发与撤销语义。

## 决策

1. `connect-endpoints` 接受两个显式 `{ nodeId, vertexId }`，同层继续复用既有 Geometry Connect，跨层由 EditorRuntime 编排，不新增细碎工具。
2. 跨层目标必须位于同一 Page、同一 parent，均为未锁定、非分支且外观一致的 editable Vector；任何目标缺失、变换不可逆、端点非法或外观冲突都在产生事务前整体失败。
3. sibling 顺序较早的图层保留稳定 node ID、外观与层级。后一个 network 通过 world transform 投影到保留层 local space，并对全部 geometry ID 做确定性无冲突 remap。
4. 合并后的 authored networks 继续交给 Geometry Service 的 `connectVectorEndpoints`；成功后一个事务更新保留层并删除追加层，只产生一次 revision、undo 和 save。
5. Canvas 多层编辑集合汇总两个真实 point selection，共用现有 Connect 按钮；成功后选中保留层。Agent 使用同一个 `opendesign_edit_vector` action 和 Runtime planner，不读取实时 selection，也不直接提供 network 或结果 ID。
6. 本切片只连接两个非分支开放 contour。degree 大于 2 的分支网络会改变 traversal、region ownership、stroke/dash phase、selection 与导出语义，继续作为独立契约切片失败封闭。
7. 连接结果属于 Design File，不属于创建它的 Run。失败只结束当前 Run；同一 Conversation 的后续消息仍可继续编辑连接前后及其他历史设计。

## 结果

- 人工与 Agent 可在一个原子事务中连接两个 sibling Vector 图层，不再要求用户先手工 Flatten 或让模型重写几何。
- 稳定 node/geometry ID、world-space 视觉位置、undo/redo 和唯一文档事实源得到保留。
- 不同外观不会被静默覆盖；分支网络也不会借跨层合并绕过现有非分支 invariant。

## 验证

- Runtime：跨 transform sibling、ID 冲突 remap、源文档不变、单 revision、删除追加层、undo 恢复。
- 失败：非 sibling、外观不一致、锁定、不可逆 transform、非 endpoint 与同层回退。
- Agent：Provider/Runtime 共用 endpoint Contract；同层与跨层请求均进入一个 planner，并返回保留/删除 node ID。
- Canvas：多层 point selection 启用同一个 Connect 操作，成功后清理已删除层的编辑状态。
