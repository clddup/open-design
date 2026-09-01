# ADR-0252：Text Glyph Outline Flatten

## 状态

已接受。

## 背景

Figma Flatten 会把 Text 转成 Vector，但 OpenDesign 不能用字符框、浏览器 fallback 或截图冒充真实字形。现有 Text Run Layout contract 已允许受信任 provider 返回带 UTF-16 cluster、位置和 path 的 glyph outlines；HarfBuzz provider 可对用户已导入的确定字体生成这些一次性投影数据。

## 决策

1. 现有人工 `⌘E / Ctrl-E` 与 Agent `opendesign_edit_vector flatten` 接受 Text，不新增 Text 专用工具。
2. Planner 使用当前 Renderer 已绑定的 Text Run Layout provider，对完整 Text、runs、paragraph/list layout 和节点尺寸发起一次确定性排版；provider 必须返回身份一致、结构有效且每个 fragment/marker 都包含 glyph path 的结果。
3. 每个 glyph path 按 fragment/marker 位置、baseline、Y 轴方向和 Text/祖先 transform 物化为 editable Vector region；Fill 按字符 run 保留，Text Stroke 通过现有精确 Outline Stroke 物化，Frame clipping 继续复用 ADR-0251 的 PathKit intersect。
4. Provider glyph path 是本次 planner 的可信派生输入，不写回原 Text。成功后一个 EditorRuntime transaction 原子替换 Text，并产生一个宿主 ID 的 Vector、一个 revision 和一次 undo。
5. 当前只接受可完整显示、非 justify、无 decoration、无 run-level Style 引用且 provider 能提供精确 outlines 的 Text。截断/裁切 Text、缺失字体、系统 fallback、run Style、decoration 和 provider 不可用都在删除命令产生前明确失败。
6. 结果属于 Design File，不属于创建 Run；同一 Conversation 的后续消息可继续编辑或撤销，前一 Run 的失败不锁定 Text 或结果。

## 结果

- 已导入确定字体的普通与 rich Text 可在人工和 Agent 路径中生成真实 editable glyph vectors。
- OpenDesign 不猜测系统字体轮廓，也不把渲染 proxy 或位图当成 Vector。
- Text truncation/decoration/Style materialization 与系统字体 outline 仍是后续能力，不冒充完成。

## 验证

- Runtime：glyph baseline/Y-flip/transform、Paint、单 revision/undo、缺失 provider 与不支持 Text 语义失败。
- Agent：同一 `flatten` action 传 Text ID，Renderer 注入可信 provider，模型不提交 glyph path 或结果 ID。
- Frame：Text glyph 可复用 nested clipping boundary。
- 连续对话：成功与失败后均可从当前 Design File revision 继续。
