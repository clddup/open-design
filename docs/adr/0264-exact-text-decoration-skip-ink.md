# ADR-0264：精确 Text Decoration Skip-Ink

## 状态

接受。

## 背景

ADR-0263 已把 `textDecorationSkipInk` 纳入权威文字样式，但生产 Provider 当时缺少 glyph 与 underline 的精确布尔裁剪，只能对 `skipInk: true` 失败关闭。若由 Renderer 按字符或 bounds 猜测断点，HarfBuzz、画布、Capture、Flatten 与导出会出现不同几何事实。

## 决策

1. HarfBuzz Text Run Layout Provider 使用已经 shaping 的真实 glyph outline，并在 glyph 位置变换后从 underline outline 中执行 PathKit difference。文字内容、cluster、字体 face、baseline 与 decoration 继续由 Text Service 统一决定。
2. Text Service 只依赖窄化的同步 `TextDecorationGeometryProvider`；PathKit 类型和对象仍封闭在 Geometry/Renderer 适配边界，不进入文档协议或公共 Text contract。
3. 单次 difference 最多处理 64 个 glyph，较长行按稳定顺序分批从同一 subject 递减，避免构造无界 PathKit 操作。完全被 ink 裁掉的 decoration 是合法空结果。
4. `skipInk: true` 必须同时具备可信 glyph outline 与 exact geometry provider。缺少 provider、transform 或 difference 失败时返回受控 shaping failure，不回退为连续线、不按 glyph bounds 猜测，也不产生第二套近似路径。
5. Leafer 投影、exact-revision Capture、位图导出与 Text Flatten 共用 layout result 中同一 clipped decoration path。无需新增文档字段、Agent 工具、内容 hash 或数量门禁。

## 结果

- 导入字体的 HarfBuzz 文字可精确裁掉 underline 与 glyph ink 的交叠，并在画布、Capture、导出和 Flatten 中保持同一几何。
- 缺少精确几何能力的固定/native fallback 继续显式失败关闭，不伪造 Figma-compatible skip-ink。
- 系统字体 exact outline、custom list marker、OpenType/variable axes、字体打包及双平台像素证据仍是后续工作。

## 验证

- Text Service：glyph transform、分批 difference、完全裁空、provider 失败和无 provider 失败关闭。
- Leafer：同一 decoration path 进入投影、Capture/导出与 Flatten，缺失 exact provider 不产生近似结果。
- EditorRuntime：带 skip-ink 的 Text Flatten 保持单事务、单 revision 与可撤销结果。
