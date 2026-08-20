# ADR-0114：Vector 路径段选择与删除

- 状态：Accepted
- 日期：2026-08-20
- Geometry Service contract：`13`
- DesignDocument：不变（`1.36.0`）
- 关联：ADR-0026、ADR-0027、ADR-0113

## 背景

Figma 的 Vector Edit Lasso 可同时选择 points 和 paths；选择多个 points 后出现 bounding box，所选内容也可从 network 删除。OpenDesign contract v12 只有 `selectedVertexIds`，因此圈住一条路径段会被忽略，或只能错误地冒充选中两个端点。两者语义不同：删除节点会重连相邻边，删除路径段则应保留端点并真正断开 contour。

## 决策

Vector Edit session 为每个编辑中 Vector 分别保存稳定 `selectedVertexIds` 与 `selectedSegmentIds`。两者都不进入文档、revision、history、save、capture 或 export：

- Move 模式点击路径可选择最近的稳定 segment；Shift 点击切换并保留另一类选择；
- `Q` Lasso 在各 Vector 的 node-local 坐标中同时圈选节点与完整位于 polygon 内的 line/cubic segment；cubic 使用有界自适应 flatten 和 polygon crossing 检查，不按端点猜测；
- overlay 直接从当前 network 的稳定 segment ID 派生高亮；多点 bounding box 仍只消费节点；
- Delete/Backspace 在一次手势中删除 segment selection，再处理仍存在的 vertex selection，并通过现有 Runtime network planner 提交一个 revision/undo step。

Geometry Service v13 增加 `deleteVectorSegments` 与 `deleteVectorSelection`。删除 segment 会把受影响 contour 确定性拆成一个或多个开放 path run：最早保留 run 继承源 path ID，后续 run 使用宿主确定性 ID；未受影响 contour 与 ID 保持不变。破坏闭合边界后移除引用它的 region，孤立 vertex/segment 不保留。删除 vertex 继续保持既有“移除节点并重连相邻边”语义。

## 后果

- Lasso 不再只做“看起来像 Figma”的节点动画，而能真实选择和删除路径段。
- session selection 与持久 graph topology 继续分离，Renderer 不建立第二份作者事实。
- 本切片不增加 segment 拖动/Bend、per-segment appearance、跨 Vector 统一节点框、分支网络、flatten 或 outline stroke；这些继续按独立契约推进。

## 验证

- Geometry：开放/闭合 contour 单段与多段删除、稳定 path ID、region 清理、混合 point/path selection、missing segment 与整节点删除；
- Leafer：line/cubic polygon containment、direct segment click、Shift/Lasso selection、segment overlay、Delete 单提交、只读/取消/多 Vector selection 隔离；
- Runtime/Renderer：stable segment ID 过滤、active path、状态不持久化、revision 后失效 ID 清理和中英文状态文案。
