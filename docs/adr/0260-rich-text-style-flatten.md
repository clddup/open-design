# ADR-0260：Rich Text Style 引用与 Flatten

## 状态

接受。

## 背景

OpenDesign 已保存 Figma-compatible UTF-16 rich-text runs，并允许每个 run 绑定 TEXT Style 与 PAINT Style。此前 Style Service 只投影节点级 Style 和 Vector region Style；run 在创建引用时复制了一份 fallback，但 Style 后续更新不会进入当前 revision 的 rich-text 投影。Flatten 又把任何 run-level Style 引用整体拒绝，导致合法的持续编辑状态无法转换为 editable glyph outlines。

## 决策

1. Style Service contract 3 在既有 local/imported Style lookup 中增加 rich-text run 投影，不新增文档字段或第二份状态。每次投影都从当前 Style 定义解析 `textStyleId` 与 `fillStyleId`，fallback 只保留为权威文档中的恢复值。
2. TEXT Style 只覆盖 run 的字符级字体、字号、字重、字形、行高、字距、大小写和基础 decoration；段落 indent/spacing/list 继续由 paragraph runs 管理，不把段落字段塞进 character run。
3. PAINT Style 覆盖 run 的 Paint 列表并保留 Style ID。缺失或类型错误返回准确 `/nodesById/{id}/properties/runs/{index}/style/{field}` issue，不猜测其他 Style。
4. Leafer、capture 与位图导出继续通过既有 `Component → Style → Variable` projection 消费结果。Style 更新会改变下一次 exact-revision rich-text 投影，源 Text run 不被改写。
5. Text Flatten 在 Style 投影成功后把 resolved run font facts 发送给同一 glyph-outline provider，并把 resolved run Paint 写入结果 Vector region；不再仅因存在 Style ID 而失败。Decoration、truncation、缺失 exact outline 与不可精确保真的 compositing 仍明确拒绝。
6. 人工与 Agent 继续使用现有 `flatten` action、宿主结果 ID、单 revision/undo，不增加 Text Style 专用 Agent 工具。结果属于 Design File；Run 失败不限制后续 Conversation 继续编辑。

## 结果

- Rich-text Style 更新、画布投影与 Flatten 消费同一当前 Style 定义，不再依赖绑定瞬间复制的旧值。
- Flatten 后 Style 引用按破坏性操作预期被物化为 glyph region Paint；原 Text 与 Style registry 可由一次 undo 恢复。
- 基础 decoration、ending truncation、系统字体 outline 与高级 Figma decoration fields 继续作为后续独立切片，不在本次猜测近似。

## 验证

- Style Service：仅 run 引用也触发投影；TEXT/PAINT 当前值覆盖 fallback；源文档不突变。
- Runtime：glyph provider 收到当前 TEXT Style 字符字段，结果 region 使用当前 PAINT Style，单事务替换仍可 undo。
- 边界：无 schema 升级、无新 Agent tool、无产品版本、内容 hash 或数量门禁。
