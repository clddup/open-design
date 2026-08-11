# ADR-0038：版本化矢量点击 Cut 与互不连接多轮廓编辑

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：不变（`DesignDocument 1.10.0`）
- Service contract：`Geometry Service v6`
- 关联：ADR-0009、ADR-0012、ADR-0021、ADR-0023、ADR-0026、ADR-0027、ADR-0037

## 背景

OpenDesign 已能创建、编辑、开放、闭合和反转单条非分支 Vector Network contour，但不能在已有节点或路径中间建立真实断点。用两个视觉重合但仍共享同一 vertex 的路径冒充 Cut，会让后续移动重新牵连两侧；直接删除 segment 会丢失曲线、稳定 ID、bounds 和撤销语义；让模型重写完整 network 则会绕过宿主拓扑不变量。

Figma 当前 Vector Edit 次级工具栏提供 Cut（`X`）：点击已有 point 或路径任意位置创建 break；拖拽穿过一条或多条路径则把切出的部分移动到独立图层。两类行为具有不同的命中、拓扑、图层与历史语义，因此必须分成独立垂直切片。

参考：

- [Figma：Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- [Figma：Vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)

## 决策

### Geometry Service v6 拥有 Cut 拓扑

`cutVectorPath(network, pathId, location)` 只接受通过拓扑校验、互不共享 vertex 的非分支 path runs。`location` 必须来自稳定几何 ID：

- `{ kind: "vertex", vertexId }`；
- `{ kind: "segment", segmentId, t }`，其中 `t` 是该 path reference 遍历方向上的有限 `[0, 1]` 参数。

Cut 建立两个坐标重合但 ID 不同、拓扑不相连的 endpoint：

- 闭合 contour 在断点处旋转 path reference 顺序，删除依赖该 path 的 closed region，并变为一条开放 contour；
- 开放 contour 的内部断点拆成两条开放 path run，原 path ID 保留给遍历前半段，新半段使用确定性的 `path_edit_N`；
- 已是开放 endpoint 的 vertex Cut 返回 `no-op`，不制造 revision；
- segment 内部 Cut 使用确定性的 `vertex_edit_N`、`segment_edit_N` 和必要的 `path_edit_N`，原 segment ID 保留给 path 遍历前半段；
- cubic 通过 de Casteljau 精确分割，保留曲线形状和反向 reference 语义；line 使用同一拓扑流程但不制造无意义 tangent；
- 未受影响的 vertex、segment 和 path ID 不重写。

`nearestVectorSegmentPoint()` 是确定性的纯命中辅助：line 使用正交投影，cubic 使用固定采样和固定次数区间细化，并返回 path-directed `t`。它不读取 viewport、selection 或 Leafer 对象。

### Cut 结果必须继续可编辑

`vectorNetworkEditability()` 从“只允许一条 contour”扩展为“允许多条互不连接的非分支 contour”：

- 每个 path run 必须连续并独占 segment；
- 不同 path run 不得共享 vertex；共享 endpoint、连接和 degree 大于 2 的分支继续明确拒绝，留给 connect/disconnect 与 branch 切片；
- 节点移动、point mode、handle drag 和删除按 vertex 所属 contour 解析；删除只移除失效 contour，仍有合法 contour 时不删除整个 Vector node；
- Open/Close/Reverse 在多 contour network 中必须提供明确 `pathId`，单 contour 调用继续兼容省略。

文档 schema 不升级：`DesignDocument 1.10.0` 已能表达多个 path run、独立 vertex、segment 和 region。

### 人工 Canvas 使用独立 Cut 子工具

Vector Edit 次级工具栏提供 Move（`V`）与 Cut（`X`）：

- Cut 模式保留可见 anchor，但不允许节点/handle drag；
- Leafer overlay 增加不可见的加宽 stroke hit surface，只命中真实路径，不把闭合形状内部 fill 当作 Cut；
- pointer 通过 `getInnerPoint(pathElement)` 转为节点局部坐标，再调用纯 Geometry 命中；screen、viewport 和 object 坐标不混用；
- 锁定或继承锁定时 Cut 不可用；成功后保持 Vector Edit、Cut 模式、画布焦点，并选中新生成的 endpoint pair；
- 人工回调把稳定 location 交给 `planVectorSemanticEdit()`，通过唯一 EditorRuntime preview/apply，形成单 revision 和单 undo。

Cut overlay 是不可持久、不可导出、不可命中的产品展示状态，不建立第二份文档事实。

### Agent 使用同一语义 planner

现有 `opendesign_edit_vector` 增加 `cut-path`，不增加通用写工具。模型必须提交 inspect 所得 `pageId/nodeId/pathId`，以及已有 `vertexId` 或 `segmentId + t`；模型不得提交完整 network 或自行创建新几何 ID。

Renderer 复用同一 Geometry/EditorRuntime planner，先 preview 再原子 apply，并返回宿主生成的 `cutVertexIds/pathIds`。missing/stale ID、错误 path、锁定、Page scope、revision、endpoint no-op、连接或分支 topology 都返回结构化失败；实时 selection 不参与目标解析。

### Render、Boolean 与 SVG 不建立 Cut fallback

Leafer、Boolean resolver 和 SVG 继续从权威 network/region 派生 path：

- 多条开放 contour 序列化为多个标准 `M ...` subpath；
- 没有 closed region 时 Fill 为 `null` / `none`，Boolean 不发明填充面；
- 受控 SVG editable-network metadata v2 必须与标准 `d` 精确匹配，导出再导入后保留 Cut 产生的 path/vertex/segment ID。

## 验证

自动化覆盖：

- 已有 vertex、line segment、正向/反向 cubic segment Cut；
- de Casteljau 控制点、稳定 ID、endpoint no-op、非法 `t`、错误 path/segment/vertex；
- 闭合转开放、开放拆双 contour、Cut 后继续移动/point mode/delete；
- 多 contour 明确 path 的 Open/Close/Reverse 与连接 topology 拒绝；
- EditorRuntime preview/apply、单 revision/undo/redo、保存重开、锁定和 Page scope；
- Move/Cut 工具、`V`/`X`、焦点、只读和 Leafer path hit callback；
- Agent schema、显式 ID、可信结果、stale/no-op 和实时选区隔离；
- Leafer 多 subpath、Boolean open-region 和受控 SVG metadata 往返。

## 当前限制

- 本 ADR 只完成点击 point/path 的 Cut。拖拽穿越一条或多条路径、几何交点排序、切出独立图层及其多目标 selection/history 语义尚未实现。
- 连接/断开、共享 vertex、分支 network、Lasso、多节点变换框、Flatten、Outline Stroke 与 Slice 尚未实现。
- Pen 仍只创建一条非分支 contour；本切片只保证已有互不连接多 contour 可继续编辑。
- 真实像素 baseline 与 macOS/Windows 打包程序的指针、键盘、DPI 产品交互仍待验收，因此 capability 保持 `degraded`。

## 后果

- Cut 成为正式、可保存、可撤销、可由人工与 Agent 共用的拓扑操作，不再依赖删除线段或重写完整 network。
- Cut 结果不会立即掉出编辑能力；多个互不连接 contour 可以在一个 Vector node 内继续被节点工具处理。
- 下一切片可以在同一稳定 ID、命中和事务边界上实现拖拽穿越 Cut，再推进 connect/disconnect 与 branch，而无需改变渲染后端或复制文档状态。
