# ADR-0240：可编辑 Outline Stroke 共用垂直切片

## 状态

已接受。

## 背景

OpenDesign 已能渲染和导出描边，也已有隔离的 PathKit stroke outline primitive，但此前缺少 Figma 式产品语义：人工操作和 Agent 都不能把一个现有 Path/Vector 的可见描边转换成可继续编辑、可保存和可撤销的正式 Vector。仅返回 SVG path string、直接改写源节点或在 Renderer 复制几何逻辑都会建立第二份事实，并破坏后续编辑与跨入口一致性。

## 决策

1. Geometry Service 负责把 PathKit 标准化的绝对 `M/L/Q/C/Z` 轮廓物化为正式 `VectorNetwork`。PathKit 对象和私有命令不越过 provider 边界；二次曲线在物化时转换成等价 cubic tangents。
2. `planVectorOutlineStroke` 是人工与 Agent 的唯一领域入口。它读取当前 Page 中一个未锁定 Path/Vector 的可见 stroke，由宿主生成结果节点和几何 ID，在源节点之后插入新的 Vector sibling，并保留源节点不变。
3. 新 Vector 以源 stroke paints 作为 fills，清空 strokes 和 dash，保存正式闭合 network、tight bounds 与补偿后的 local transform。一次操作只提交一个 EditorRuntime transaction、revision 和 undo step。
4. 人工入口位于所选 Path/Vector 的 Inspector Stroke 区域，不向顶部工具栏继续堆叠按钮；Agent 继续复用统一 `opendesign_edit_vector` 的 `outline-stroke` action，不增加独立工具。
5. Browser PathKit provider 仅在执行该命令时动态加载。加载、拓扑、锁定、空描边、Boolean operand 和 stale document 失败必须显式返回，不得静默改写或退化为不可编辑 path data。
6. 受控 SVG metadata v3 继续作为标准 SVG path 的补充证据；outline 结果导出后可重新导入为 filled editable Vector。普通外部 SVG 仍不猜造 Vector Network。
7. Outline 结果是 Design File 中的普通用户内容，不归创建它的 Run 或 Conversation 所有。Conversation 可继续产生后续 Run，任何后续人工操作或获准 Run 都能按当前 revision 编辑该节点。

## 结果

- 人工、Agent、保存重开、undo/redo 和 SVG 往返共享一个 Vector Network 事实。
- 源描边与轮廓结果可以并存，符合非破坏式 Figma 心智；用户可自行删除源层。
- 文档 Schema 足以表达结果，因此不增加文档版本、兼容分支、hash 或数量门禁。
- `flatten`、跨层 Connect、分支网络和 vertex-local stroke appearance 仍是独立缺口。

## 验证

- Geometry：中心/内外描边、dash、闭合 contour、稳定 IDs 与非法命令拒绝。
- Runtime：新 sibling、源节点保留、单 revision/undo、redo 与保存重开。
- 人工：只有可写且存在可见描边的单选 Path/Vector 启用 Inspector 操作，成功后选择结果节点。
- Agent：统一 Vector action 由宿主生成结果 ID，单事务提交且保留源节点。
- SVG：outline 结果以标准闭合 path 和 metadata v3 导出，重新导入后仍为 filled editable Vector。
