# ADR-0112：同一 Vector 的非分支端点连接与断开

- 状态：Accepted
- 日期：2026-08-20
- Geometry Service contract：`11`
- DesignDocument：不变
- Agent tool：`opendesign_edit_vector`（增加 `connect-endpoints`、`disconnect-vertex`）
- 关联：ADR-0026、ADR-0027、ADR-0037、ADR-0038、ADR-0044

## 背景

当前 editable Vector Network 已能创建、移动、删除、调整手柄、改变 point mode、Open/Close/Reverse 与 Cut，但 Cut 产生的两个真实 endpoint 不能重新连接。用户只能重建轮廓或让模型重写完整 network，这会丢失稳定 ID，并绕过 Geometry Service、Runtime preview、history 与 SVG 拓扑校验。

文档 schema 已允许多个独立 path runs 和普通非分支 connector；缺口是宿主拥有的拓扑操作，不需要升级文档格式或引入第二份矢量状态。

## 决策

### Connect 只接受两个真实开放 endpoint

`connectVectorEndpoints(network, [a, b])` 先验证当前 network 可编辑、ID 不同，并要求两个顶点都是受支持开放 contour 的首端或末端：

- 同一 path 的两端复用既有 Close 语义和 region 规则；
- 不同 path 按原 `paths` 顺序保留较早 path ID，并确定性反转 references，使第一个 endpoint 成为 retained path 末端、第二个成为 appended path 起点；
- 两个 endpoint 坐标重合时合并为 retained vertex，不创建零长度 segment；
- 坐标不同时创建一条宿主命名的真实 connector，并按已有 smooth/mirrored endpoint handle 语义补切线；
- internal vertex、closed contour、跨 Vector layer 和任何 degree 大于 2 的分支继续拒绝。

### Disconnect 复用真实 Cut 语义

`disconnectVectorVertex(network, pathId, vertexId)` 复用 `cutVectorPath` 的 vertex 分支：闭合 path 打开，开放 path 分成两条互不共享 vertex 的 path runs，坐标保持一致，新增 endpoint/path ID 由 Geometry Service 确定性生成。端点 no-op 与不支持拓扑继续结构化失败。

### 人工与 Agent 使用同一 planner

Canvas Vector Edit 工具栏只根据 exact-revision edit scope 启用 Connect/Disconnect。Agent 只提交 inspection 返回的 Page、node、path 和 vertex ID；不得提交 segment、path run、region、bounds、transform 或结果 ID。两条入口均经过 `planVectorSemanticEdit`、Runtime preview/apply、单 revision、undo/redo、保存重开与自动保存。

SVG metadata 不升级：结果仍是既有 schema-valid non-branching network，继续通过 metadata v2 的 schema、topology 与 rendered path 三重校验。

## 后果

- Cut 产生的断点可以无损重连，Logo 与图标轮廓不必重建。
- 本切片不宣称支持跨层 Join、路径合并成新 Vector layer、共享 vertex 或分支网络。
- Flatten、Outline Stroke、Lasso、多节点变换框和原生双平台交互证据继续按 roadmap 后续切片完成。

## 验证

- Geometry：同/异 path、正反 endpoint、重合合并、有距离 connector、internal vertex 拒绝；
- Runtime：Disconnect → Connect、tight bounds、两次 revision、undo/redo、保存重开；
- Canvas：按钮启用条件、真实事务、焦点与节点选区恢复；
- Agent：严格 action schema、稳定 ID、实时 selection 隔离和原子结果；
- Context：完整生产工具预算继续通过。
