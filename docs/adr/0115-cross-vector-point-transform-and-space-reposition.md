# ADR-0115：跨 Vector 节点变换与 Space 重定位

- 状态：Accepted
- 日期：2026-08-21
- Geometry Service contract：不变（`13`）
- DesignDocument：不变（`1.36.0`）
- 关联：ADR-0040、ADR-0113、ADR-0114

## 背景

OpenDesign 已允许多个 Vector 图层同时进入节点编辑，但每层仍分别绘制 selection box，resize/rotate 也只修改 active layer。用户跨层选择节点时看到多个互不相关的框，完成一次视觉变换还会产生多个 revision/undo。Figma 的公开 Vector Edit 行为则允许共同编辑多个 Vector layers、为多个 points 显示一个 bounding box，并在 resize/rotate 中按住 Space 重定位节点、松开后继续原操作。

该差异不能只通过合并 overlay 解决：各 Vector 可能位于不同的嵌套 translate/rotate/scale 下，preview 必须在 document-space 统一计算，再回到各自 node-local editable network；pointer-up 还必须作为一条原子 Runtime 事务提交。

## 决策

编辑集合内任意两个以上已选节点共享一个 disposable document-space transform overlay：

- 每层继续单独持有稳定 `selectedVertexIds/selectedSegmentIds`、trace、anchors、handles 与只读状态；统一 box 只消费 vertex selection，不把 segment 冒充节点；
- 宿主以当前权威文档的 visible world transform 将各层节点投影到 document-space，形成一个 axis-aligned bounds；overlay 位于 Leafer editor `sky`，随 viewport 变化但不进入文档、history、save、capture 或 export；
- box 内部 move、八向 resize 与四角 rotate 都生成一个 document-space affine matrix；每层 preview 使用 `inverse(world) × documentTransform × world` 共轭回 node-local，并继续由 Geometry Service v13 `transformVectorVertices` 同步节点与附着 Bézier tangents；
- 任一目标 locked、missing、stale、不可逆或几何失败时整体 fail closed，不提交部分层。

resize/rotate 的 Space 子模式保存当前 action pointer、已有 reposition offset 与 pointer 基线。Space 按下后冻结 resize/rotate matrix，仅把后续 pointer delta 累积为 document-space translation；松开后保留 offset，并以 `currentPointer - offset` 继续计算原操作，因此不重置、不跳变，也不触发 Canvas pan。Escape、pointer cancel、scope/tool/Page/revision 失效恢复所有 `beforeByNode` preview，零 revision。

`LeaferVectorEditRequest` 的材料更新统一为有界 `edits[]`。Canvas 使用 `planVectorNetworkUpdates` 先验证全部网络，再一次调用 EditorRuntime。Agent `opendesign_edit_vector transform-layers-vertices` 接收 inspection 返回的明确 `{nodeId, vertexIds[]}` groups 与有限 document-space matrix；`planVectorLayersVertexTransform` 使用当前 world transform 派生每层 local matrix，跳过真正未变化的 pivot layer，并把其余变化层合并为一个 transaction。模型不能提交 network、bounds、local conjugation 或实时 selection。

## 后果

- 单 Vector 两点以上的既有变换行为迁移到同一公共 overlay，不再维护两套 box 实现。
- 多层 gesture 和 Agent action 都只产生一次 revision/undo；Runtime、Renderer 与 Agent 不建立第二份文档事实。
- Geometry Service 已具备所需 node-local affine primitive，本切片不为宿主 document-space 编排虚增 contract 版本。
- segment Bend/per-segment appearance、跨层 Connect、分支 network、flatten、outline stroke、像素 baseline 与双平台打包交互证据继续独立推进。

## 验证

- 纯几何：跨不同 world transform 的公共 bounds、document→local 共轭与 Space translation composition；
- Runtime：多 target 全量校验、不同 scale/rotate parent、锁定/不可逆/重复/stale、单 revision 与单 undo；
- Leafer：统一 sky overlay、单层回归、跨层 move/resize/rotate、Shift/Option、Space keydown/move/keyup 无跳变、Escape/cancel/read-only/pan/zoom；
- Agent：严格 schema、明确 target groups、document-space transform、Mutation Target 校验、原子执行与系统能力说明。

## 参考

- Figma：<https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>
