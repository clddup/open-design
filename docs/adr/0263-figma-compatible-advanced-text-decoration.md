# ADR-0263：Figma-compatible 高级 Text Decoration

## 状态

接受。

## 背景

基础 `underline/strikethrough` 只能表达是否存在装饰，无法保存 Figma Text range 已公开的 underline style、offset、thickness、color 与 skip-ink。若只把这些值留在 Inspector、Provider 或 Figma adapter，会产生第二份设计事实；若将 Figma Text range 与 Text Style 视为同一能力，又会在导出 Shared Text Style 时静默丢字段。

## 决策

1. `DesignDocument 1.54.0` 在 Text、rich character run 与 Text Style 的同一文字样式结构中增加 `textDecorationStyle`、`textDecorationOffset`、`textDecorationThickness`、`textDecorationColor` 与 `textDecorationSkipInk`。只有 underline 可以携带完整高级字段；none/strikethrough 必须全部为 `null`。
2. 旧 underline 确定迁移为 `solid/auto/auto/auto/false`，以保持既有连续下划线视觉。切换 decoration 时由同一 Runtime planner 原子建立或清除完整字段，不由 Renderer、Agent normalizer 或 Provider 猜测修补。
3. offset 的 pixels/percent 表示 baseline 下方距离，thickness 的 percent 相对当前 `fontSize`。auto 继续使用导入字体的 SFNT decoration metrics，不按字号比例猜测。
4. Text Run Layout contract 7 返回带 style 与 color 的闭合 decoration outline。solid、dotted 与 wavy 使用确定性 editable path；显式颜色独立于 glyph fill。`skipInk: true` 在当前 Provider 缺少精确 glyph clipping 时返回受控 `unsupported`，不得伪造支持。
5. 固定 `@figma/plugin-typings 1.133.0` 的 `StyledTextSegment` 与 TextNode range API 支持全部高级字段，因此 character ranges 完整往返。该版本 `TextStyle` 只公开基础 `textDecoration`；Figma Shared Text Style 仅允许默认 underline，非默认高级字段精确拒绝，不能静默丢失。
6. SVG Text metadata 9 完整保存上述字段，并输出标准 `text-decoration-style`、`text-underline-offset`、`text-decoration-thickness`、`text-decoration-color` 与 `text-decoration-skip-ink`。旧 metadata 确定迁移为 canonical defaults。
7. Inspector、现有 Text/range Agent schema、Figma/SVG adapter、生产投影与 Flatten 共用一份权威字段。不得新增 decoration 专用 Agent tool；Flatten 继续通过统一 action 产生一个 editable Vector 和一次 revision/undo。

## 结果

- 单样式与 rich-text range 可编辑、保存、恢复、投影和 Flatten solid/wavy/dotted underline，并保持显式 offset、thickness 与 color。
- Provider 可见 Agent schema 从 Design Contract 投影，不再手写第二份枚举或结构。
- Figma range 与 Figma Shared Text Style 的能力差异保持显式，不以兼容名义丢失设计事实。
- 精确 skip-ink、系统字体 outline、OpenType/variable axes 与双平台像素验收仍是后续工作。

## 验证

- Contract：旧文档迁移、underline 完整字段、非 underline 清空及准确字段路径。
- Runtime/UI/Agent：Text、range、Text Style、Inspector 与现有 typed schema 使用同一 canonical 字段集。
- Provider/Flatten：solid/dotted/wavy path、auto/px/percent 换算、独立颜色及 skip-ink 失败关闭。
- Interop：Figma range 完整往返、非默认 Figma Text Style 拒绝、SVG metadata 9 与标准属性往返。
