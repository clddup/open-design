# ADR-0261：基础 Text Decoration 精确 Flatten

## 状态

接受。

## 背景

OpenDesign 的 Text 与 rich-text runs 已保存 `none`、`underline`、`strikethrough` 三种基础 decoration。此前生产布局可以显示这些样式，但 Text Flatten 只接收 glyph outline；带 decoration 的 Text 会被整体拒绝。若按字号比例猜测线位和粗细，结果会与字体设计、画布投影和专业交付不一致。

Figma 公开类型还包含 decoration style、offset、thickness、color 与 skip-ink 等高级字段。当前 OpenDesign 文档契约并未保存这些字段，因此本切片只完成已有基础语义，不伪造尚未建模的能力。

## 决策

1. Text Run Layout contract 5 为正文 fragment 与 list marker 增加可选 `decorations`。每项 decoration 是 fragment-local、baseline-relative、Y 轴向上的闭合 path，与 glyph outline 使用同一坐标约定。
2. HarfBuzz provider 从已导入字体的 SFNT `post` 表读取 underline position/thickness，从 `OS/2` 表读取 strikeout position/size；缺表、长度不足或非正 thickness 时返回受控 unsupported，不按字号比例猜测。
3. 每个具有可见宽度且样式为 underline/strikethrough 的 fragment 或 marker 必须返回一个 kind 匹配的有界 outline。Validator 将 glyph 与 decoration 一起计入总 path 预算。
4. EditorRuntime Flatten 让 glyph 与 decoration 复用同一 baseline、Y-flip、祖先 transform 和对应 run Paint，再由既有 Geometry/Runtime planner 生成一个 editable Vector 和一次 revision/undo。
5. 人工与 Agent 继续使用现有 `flatten` action；不增加 Text Decoration 专用工具，不修改 DesignDocument schema，也不建立 Run 级所有权。结果属于 Design File，同一 Conversation 的后续 Run 可继续编辑。

## 结果

- 已导入且包含可信指标的字体可以把基础 underline/strikethrough 精确物化为 editable Vector。
- 缺少精确 glyph outline、缺少 decoration 指标或未来高级 decoration 字段时继续失败关闭；ending truncation/maxLines 后续由 ADR-0262 完成。
- 系统字体 outline、Figma 高级 decoration 字段和真实跨平台像素基线保持后续独立切片。

## 验证

- Contract：decorated fragment/marker 必须返回匹配 outline，非法 kind、缺失 path 和超预算结果被拒绝。
- Provider：真实 Noto Sans Arabic 的 underline/strikethrough 使用字体表指标生成闭合 path。
- Runtime：Flatten 结果同时包含 glyph 与 decoration region，Paint、baseline、Y-flip、祖先 transform 和单事务替换保持一致。
