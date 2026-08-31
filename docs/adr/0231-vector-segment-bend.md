# ADR-0231：Vector Segment Bend

- 状态：Accepted
- 日期：2026-08-31
- Geometry Service contract：`14`
- DesignDocument：不变
- 关联：ADR-0027、ADR-0113、ADR-0114、ADR-0115

## 背景

OpenDesign 的 Vector Network 已保存 cubic tangent 与 vertex handle mode，也已有手柄拖动、节点模式、segment hit test、Runtime 原子更新和 Leafer disposable overlay，但直线 segment 只能被选中、删除或切断。用户不能像 Figma Vector Edit 的 Bend 工具一样，直接点击路径添加 Bézier handles，或拖动路径形成曲线。

文档事实已经足以表达 Bend，因此不能增加第二套 curve 状态，也不需要修改 DesignDocument。缺口是一个从 segment hit 到 Geometry、Runtime、Canvas 和 Agent 的完整语义入口。

## 决策

Geometry Service contract 14 增加 `bendVectorSegment(network, pathId, segmentId, t, point)`：

- `t` 使用 path run 的有向参数，service 负责转换为 segment 存储方向；
- 对直线 segment，先建立位于弦线三等分点的 cubic controls，因此只点击路径时视觉外观保持不变，但手柄已可编辑；
- 拖动时同时平移两个 controls，使 cubic 在同一参数 `t` 精确经过 node-local `point`，端点和稳定 segment/path ID 不变；
- 对已有 cubic，在现有 controls 上计算同一约束；真正 no-op、缺失 ID、端点参数、非法数字和不支持拓扑结构化拒绝；
- 端点 handle mode 由结果 network 重新推导，后续手柄拖动继续复用 no mirroring、mirror angle、mirror angle and length 三态语义。

Leafer Vector Edit 次级工具栏增加 Bend：点击无手柄节点建立 smooth handles；点击直线路径建立可编辑 cubic；拖动路径只更新 disposable overlay，Escape/pointer cancel 恢复 before network，pointer-up 通过既有 `onVectorEdit` 进入 `planVectorNetworkUpdate`，只产生一个 revision/undo。selection、预览和手柄不进入文档、history、save、capture 或 export。

Agent `opendesign_edit_vector bend-segment` 只接受 inspection 返回的 Page/node/path/segment ID、内部参数 `t` 和 node-local 目标点。Provider schema 与 Runtime 从同一 `DesignVectorContract` 派生；模型不能直接写 tangent、bounds、transform 或整个 network。

## 后果

- 人工画布与 Agent 共用 Geometry/Runtime 的同一 Bend 事实和失败行为。
- 文档、SVG metadata、Boolean resolver 与 Leafer projection 继续消费既有 Vector Network，不增加迁移或兼容层。
- 本切片不包含 per-segment appearance、跨层 Connect、branching network、Flatten、Outline Stroke 或 Variable Width。

## 验证

- Geometry：straight/cubic、reversed path、准确参数点、no-op、非法参数与缺失 ID；
- Runtime：preview、单 revision、undo/redo、保存重开与锁定/stale 既有 guard；
- Leafer：click/drag Bend、disposable preview、Escape、handle overlay 与单次 callback；
- Renderer/Agent：工具栏状态、双语提示、唯一 Contract schema、typed execution 与原子事务。

## 参考

- Figma：<https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>
- Figma Vector Networks：<https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks>
- Figma Plugin API：<https://developers.figma.com/docs/plugins/api/VectorNetwork/>
