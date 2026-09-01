# ADR-0251：Frame Flatten

## 状态

已接受。

## 背景

OpenDesign 已能把同父级基础 Shape、Path、Vector、nested Group 与 Boolean 破坏性替换为一个 editable Vector，但 Frame 仍被整体拒绝。Frame 的可见矢量结果可由自身 Fill、按 `childIds` 排列的后代、可选内容裁剪和自身 Stroke 确定性组成，不需要把渲染缓存写回文档。

## 决策

1. 继续扩展现有 `planFlattenNodes`、Canvas `⌘E / Ctrl-E` 与统一 Agent `opendesign_edit_vector flatten`，不新增 Frame 专用工具。
2. Frame Fill 先物化，后代按稳定层级顺序递归物化，Frame Stroke 最后物化，以保持实际绘制顺序和全部祖先 transform。
3. `clipsContent=true` 时，Frame 的 rounded-rectangle 边界通过固定 PathKit provider 变换到所选根的 parent space，并逐项与每个后代的 Fill/outlined Stroke 执行 `intersect`；完全不可见的后代不进入结果。嵌套 clipping Frame 按祖先顺序累积裁剪，Frame 自身 Fill/Stroke 只受祖先裁剪，不受自身裁剪。
4. Frame Fill/Stroke 和 clip boundary 在 planner 内转换为临时 Rectangle 几何贡献；该中间值不进入 DesignDocument、history、保存或渲染事实。
5. 成功结果仍由一个 EditorRuntime transaction 原子删除所选 Frame 及其后代，并插入一个宿主生成 ID 的 editable Vector；undo 一次恢复完整原结构。
6. Text、Image、opacity/effect/blend/mask 及其他需要像素合成的语义继续在事务前明确失败，不做视觉近似。
7. Flatten 结果属于当前 Design File。Run 的失败、取消、超时或 Provider/API 异常只终止该轮执行；同一 Conversation 的后续 Run 可继续编辑、撤销或再次 Flatten 历史内容。

## 结果

- clipped/unclipped Frame 可与 Group、Boolean 和基础矢量层使用同一人工/Agent Flatten 路径。
- Frame 自身外观与后代顺序被编译到一个权威 Vector Network，不建立第二份文档状态。
- 矢量裁剪与像素合成边界保持显式，后续可独立完成 Text outline 与 Image Paint。

## 验证

- Runtime：Frame Fill → nested children → Frame Stroke 顺序、祖先 transform、rounded boundary intersect、完全裁掉的后代省略、原子删除、单 revision/undo。
- 失败：Text/Image 后代和不可精确保真的 compositing 在生成删除命令前拒绝。
- Agent：现有 `flatten` action 接受 inspection 返回的 Frame ID，结果 ID 仍由宿主生成。
- 连续对话：结果和原设计均按 Design File 持久化，不继承创建 Run 的失败状态或写入所有权。

## 后续决策

ADR-0259 已在同一 Flatten 主链完成 Image node，以 region-local Image Paint 保留 placement、filters 与圆角裁剪；本 ADR 中 Image 失败边界仅记录 Frame 切片当时的历史状态。opacity/effect/blend/mask 与其他任意像素合成仍然失败关闭。
