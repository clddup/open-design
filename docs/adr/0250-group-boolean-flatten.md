# ADR-0250：Group 与 Boolean Flatten

## 状态

已接受。

## 背景

OpenDesign 的 Flatten 已能把同父级基础 Shape、Path 和 Vector 破坏性替换为一个 editable Vector，但选择 Group 或 Boolean 会直接失败。Figma 的公开 Plugin API 将 Flatten 定义为把指定节点转换为新的 Vector Network；因此容器身份本身不应迫使用户手动拆组或先复制 Boolean 派生 path。实现仍必须保持 OpenDesign 的唯一文档事实、精确几何、单事务与持续 Conversation 语义，不能把渲染缓存当成持久结果。

## 决策

1. 现有 `planFlattenNodes`、Canvas `⌘E / Ctrl-E` 和统一 Agent `opendesign_edit_vector flatten` 扩展到 Group 与 Boolean，不新增专用工具。
2. Group 按持久 `childIds` 递归展开。每个叶节点的 local transform 与全部祖先 transform 相乘后进入既有 Geometry materialization；嵌套 Group 的稳定 child order 即最终 Paint/region 顺序。
3. Boolean 不读取 Leafer synthetic Path，也不把派生结果写回原节点。Planner 使用固定 PathKit provider 和既有 Boolean resolver，从当前 DesignDocument/revision 解析真实 path，再按 Boolean 自身 Fill/Stroke 与 transform 进入同一 Vector materialization。
4. Flatten 成功后，一个 EditorRuntime transaction 删除所选根及其后代，并在最早 sibling index 插入一个宿主生成 ID 的 editable Vector；undo 原子恢复原 Group/Boolean 和全部后代。
5. Group/Boolean/后代存在非 1 opacity、可见 effect、非 normal/pass-through blend、mask、无效 child、空结果或不支持的后代时明确失败。Frame clipping、Text outline、Image placement 与任意像素合成不在本切片中，不做视觉近似。
6. 结果属于 Design File，不属于创建它的 Run。Run 失败、取消或 Provider/API 异常只结束当前执行；同一 Conversation 的后续消息可继续 Flatten、撤销或编辑该结果及历史设计。

## 结果

- 人工和 Agent 可直接 Flatten nested Group 与 Boolean，不再需要手动拆组或复制派生几何。
- Group 层级、Boolean 派生、删除和插入仍只有一个权威 Runtime 事务。
- 未完成的 Text/Image/Frame 与 compositing 能力保持诚实边界，不用截图或隐藏 raster 结果冒充 editable Vector。

## 验证

- Runtime：nested Group child order、祖先 transform、Boolean resolver、源容器及后代删除、结果 parent/index、单 revision/undo。
- Agent：现有 `flatten` action 接受 inspection 返回的 Group/Boolean node ID，结果 ID 仍由宿主生成。
- 失败：无效/空 Boolean、unsupported descendant、opacity/effect/blend/mask 和 Boolean edit-scope operand 在事务前整体拒绝。
- 连续对话：成功结果和失败前的原设计都属于 Design File，后续 Run 不继承失败锁定。
