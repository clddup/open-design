# ADR-0241：可编辑 Vector Flatten 共用垂直切片

## 状态

已接受。

## 背景

OpenDesign 已有非破坏 Boolean Group 和 Outline Stroke，但缺少 Figma `Flatten`（macOS `⌘E`、Windows `Ctrl-E`）的明确语义。Flatten 不是 Boolean Union，也不是导出时临时展开；它需要把所选图层的当前可见矢量外观破坏性替换为一个仍可继续编辑、保存和撤销的 Vector。若人工入口、Agent 或 SVG 各自拼接 path，会形成多个几何事实源并丢失 Paint 顺序。

## 决策

1. 当前完整切片接受同一父级、可写且可精确保真的 Rectangle、Ellipse、无端点装饰的 Line、零圆角 Polygon/Star、Path 与 Vector。Rectangle 保留精确圆角，规则图形先转换为精确 path，再与 Path/Vector 共用后续物化。带端点装饰的 Line、圆角 Polygon/Star、隐藏图层、可见 effect、非普通 blend、mask、Boolean operand 或其他当前无法物化的 compositing 显式失败，不伪装为完整 SceneNode Flatten。
2. Geometry Service 把每层的 Fill region 和 Outline 后的 Stroke 按 sibling 与层内外观顺序物化到 document coordinates，再合并为一个带稳定 ID、region-local Paint 的正式 `VectorNetwork`。
3. `planFlattenNodes` 删除源节点并在最前源节点的位置插入一个新的 Vector。结果使用 tight bounds、补偿后的 transform、空 node-level Fill/Stroke 和有序 region Paint；全部命令只进入一个 EditorRuntime transaction、revision 和 undo step。
4. 人工入口使用 Figma 标准 `⌘E / Ctrl-E`；Agent 复用统一 `opendesign_edit_vector` 的 `flatten` action。模型只提交当前 inspection 中的 Page 与 node IDs，结果节点和 geometry IDs 由宿主生成，不新增独立 Agent 工具。
5. 受控 SVG metadata v3 保持结果为一个 editable Vector，并验证多 region Paint 顺序；标准 SVG 不恢复已被 Flatten 删除的源图层。
6. Flatten 结果是当前 Design File 的普通内容，不归创建它的 Run 或 Conversation 所有。Conversation 持续存在，单次 Run 的成功、失败、取消或 Provider 中断都不得阻止后续 Run 继续编辑该结果或同文件中的其他历史内容。

## 结果

- 人工、Agent、Geometry、EditorRuntime、undo/redo、保存重开与 SVG 往返共享同一实现。
- Flatten 与 Boolean Union 的产品语义分离：前者破坏性替换，后者继续保留源 operands。
- 文档现有 Vector Network 足以表达结果，不增加 schema 版本、兼容分支、内容 hash 或数量门禁。
- Text、Image、Frame/Group/Boolean 等容器或复合节点，以及复杂 effect/mask/blend 的像素保真 Flatten 仍是后续能力，当前明确失败封闭。

## 验证

- Geometry：多个已变换 network 合并、稳定 ID 和 region Paint 顺序。
- Runtime：同父级 Rectangle/Ellipse/plain Line/sharp Polygon/Star/Path/Vector 删除与结果插入、精确规则图形 path、拒绝圆角 Polygon/Star、端点装饰 Line 和不可保真外观、单 revision/undo/redo/save-reopen。
- 人工：macOS `⌘E`、Windows `Ctrl-E`、输入控件与不可用选区不误触发，成功后选择结果节点。
- Agent：统一 Vector action 使用显式 node IDs 和宿主结果 ID，不读取实时 selection。
- SVG：一个 filled editable Vector 以标准 path + metadata v3 往返，多 region Paint 顺序保持且源节点不被伪造恢复。
