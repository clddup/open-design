# ADR-0082：Figma-compatible 富文本 runs 与真实 range 编辑闭环

- 状态：Accepted
- 日期：2026-08-15
- 文档协议：`DesignDocument 1.31.0`
- SVG Text metadata：v6（继续读取 v5/v4/v3/v2/v1）
- 取代：ADR-0081 中“正式 rich-text schema/Agent/Figma/SVG 尚未接入”的待办结论
- 关联：ADR-0074、ADR-0076、ADR-0077、ADR-0079、ADR-0081

## 背景

Text Range Service v1 与 Text Run Layout v2 已分别证明 UTF-16 范围变换和 native/HarfBuzz 投影，但 `DesignDocument 1.30.0` 仍只能保存整节点样式。继续只展示 synthetic fragments 会形成不可创建、不可保存、不可由 Agent 或格式适配器往返的预览能力；直接把 fragments/glyph Path 写入文档又会破坏 OpenDesign 对作者事实、revision 和导出的所有权。

## 决策

### runs 是作者事实，fragments/glyphs 仍是派生投影

`DesignDocument 1.31.0` 为 Text 增加规范化 `runs`。范围使用 Figma-compatible UTF-16 `[start,end)`；非空 runs 必须按序、无空洞、完整覆盖 content、不得切开 surrogate pair，相邻同样式自动合并。`[]` 表示整段使用 Text base style。首版 run 保存能够真实编辑、渲染和往返的 exact face identity、字号、字距、行高、case、decoration、fills，以及可选 Text/Paint Style ID；不提前保存列表、OpenType features、variable axes、超出当前几何能力的 decoration 参数或 text-on-path。

`update_text_range_style` 是唯一逐段样式事务。它要求稳定 Text node ID、非空范围、至少一个样式字段和当前 `baseRevision`；锁定、越界、半 surrogate、错误 Style 类型、no-op 与 stale revision 原子失败。普通 `update_properties` 不允许直接替换 runs；直接内容编辑继续使用 bounded diff 重映已有 runs。undo/redo、保存重开和 Auto Size 都消费同一权威事务。

### Inspector 使用真实 DOM selection，不维护伪选区

Leafer TextEditor 的 contenteditable selection 被转换为 UTF-16 offset，并连同 `documentId + revision + nodeId` 回传 Renderer。Inspector 只在该 identity 仍有效且范围非空时显示“Selected text”状态；字体、字号、face、weight/slant、行高、字距、case 与 decoration 经 `update_text_range_style` 写入。混合值明确显示 Mixed。切页、关闭编辑、revision 变化或 dispose 会清空/失效该范围，不能把旧 offset 应用于新 content。

### 生产画布、capture 与 raster 共用 provider 链

正式 runs 在每个 revision 由 native Leafer run provider 解析；只有 native 明确返回 `unsupported` 或 `provider-unavailable` 时，才回退到已显式导入字体的 HarfBuzz provider。invalid input 和 measurement failure 不被 fallback 掩盖。成功结果继续形成 disposable Text fragments 或 glyph Paths；失败保留权威原 Text 并产生 `rich-text-layout-failed` fidelity warning。

实时画布、Agent capture 与 PNG/JPEG/WebP delivery export 都从被冻结文档和同一 provider 链自动构造 exact-revision projection。派生 fragments/glyphs 不进入 document、history、save 或 SVG 作者数据。

### Agent、Figma 与 SVG 使用结构化范围

Agent 通过 deferred `opendesign_style_text_range` 暴露小型 typed range schema，避免把逐段 Paint/Typography 定义重复嵌入通用 apply schema；宿主仍把它编译为唯一的 `update_text_range_style` Runtime 事务，并继续经过 target scope、revision、事务和恢复门禁。Inspection 返回正式 runs，并同时枚举 base 与 run face availability。

Figma adapter 在 exact `FontName.style`、pixel letter spacing/line height 和当前支持的 paint 边界内双向转换 styled segments；不按 weight 猜 face，也不静默降级不支持的 paint。SVG metadata v6 保存 runs，并为每个作者 run 输出带 UTF-16 range 属性和标准字体/Fill 属性的 `<tspan>`；导入同时校验 metadata 与标准结构。synthetic Path 从不作为作者 SVG 数据序列化。

## 后果与门禁

专业富文本能力继续为 `degraded`，不是完整 Figma 文字栈。列表/缩进的逐段语义、OpenType features、variable font axes、decoration style/offset/thickness/color/skip-ink、paragraph-level mixed 属性、text-on-path、字体随 Design File 打包与授权迁移、Unicode 13 之后 bidi 数据，以及 macOS/Windows 打包视觉基线仍是后续门禁。Range Style ID 当前可保存、校验和往返；跨 range 的本地 Style 实时传播需要与后续 Style/Library 切片共同完成。

## 验证

- `1.30.0 → 1.31.0` 迁移、规范化 runs、UTF-16 边界、直接内容编辑重映、range style、no-op、锁定、undo/redo 与保存重开。
- Fixed 与 Auto Size 通过统一 Text Run provider；native 明确 unsupported 时才进入 HarfBuzz。
- DOM selection identity、Mixed Inspector、range-only transaction 与关闭/过期恢复。
- 生产 projection 的 exact revision、Fill 映射、failure warning，以及 capture/raster 自动投影。
- Agent typed schema、目标 scope、base/run font inspection。
- Figma styled segments 与 SVG metadata v6/styled tspan 往返及篡改拒绝。
