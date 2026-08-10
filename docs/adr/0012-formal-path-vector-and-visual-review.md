# ADR-0012：正式 Path/Vector 语义与 Agent 视觉复核门禁

- 状态：已接受
- 日期：2026-08-10
- 关联：ADR-0009、ADR-0010、ADR-0011
- 文档协议：`1.2.0`

## 背景

`DesignDocument 1.1.0` 已定义渐变、描边、阴影、光晕、模糊、混合与蒙版，但 `path` / `vector` 仍使用无类型 `JsonObject` 占位。Agent 工具因此无法得知路径数据和外观字段的正式结构。更严重的是 Leafer adapter 的旧 Path 分支把 `fill` 与 `stroke` 固定为 `null`：事务可以成功、结构检查可以看见节点，实际画布却没有可见轮廓。Agent 在吉祥物任务中因此退回椭圆和圆角矩形拼接，形成了“协议宣称通用、实际只能稳定使用基础几何”的能力断层。

只有修复渲染仍不足以保证设计质量。旧运行时允许模型在第一次 `capture_canvas` 后直接宣布完成，没有要求根据真实渲染做任何修正，也没有第二次视觉验证。模型文本不能作为视觉质量或完成状态的可信证据。

## 决策

### `DesignDocument 1.2.0` 正式拥有路径语义

`path` 与 `vector` 节点不再使用通用 JSON 属性，统一采用 OpenDesign `PathProperties`：

- `path`：有界、可移植的 SVG path data 字符串，坐标位于节点本地空间；禁止 HTML/XML 标记和引擎私有对象。
- `fillRule`：`nonzero` 或 `evenodd`。
- 与其他 Shape 相同的多 `fills`、多 `strokes`、`strokeWidth`、`strokeAlign`、`strokeCap`、`strokeJoin` 与 `dashPattern`。
- 节点级 opacity、blend mode、mask 和 effects 继续复用 1.1 外观协议。

1.2 中 `path` 与 `vector` 使用同一单路径几何载荷和渲染行为；保留两个 kind 是为了维持资源语义与后续专业矢量模型的演进空间，不表示已经完成 Pen 节点/手柄、布尔运算、flatten 或多轮廓 geometry kernel。

公共协议只保存 SVG path data，不保存 Leafer 数字命令流、对象实例或私有 JSON。Leafer 2.2.9 adapter 把 Path/Vector 投影为 Leafer `Path`，并复用统一 Shape appearance 与 node effects 映射；Leafer 场景仍是当前 revision 的可丢弃投影。

### 迁移与失败行为

读取 `1.0.0` 或 `1.1.0` 文档时确定性升级到 `1.2.0`。旧 Path/Vector 的合法 SVG path 字符串和有效外观字段进入正式属性。无法解释的旧路径载荷不会作为引擎私有数据继续执行：节点使用不可见的安全占位路径 `M 0 0`，原始 properties 完整保存在 namespaced migration extension 中，供诊断或后续显式转换。未知版本继续拒绝；迁移只发生于内存，正常保存前不静默改写源文件。

### Agent 完成由可信 Runtime 复核

提示词继续指导设计方法，但完成门禁位于 Agent Runtime。对于包含至少两个新增节点、`replace_subtree` 或同等级批量命令的实质设计写入，完成顺序固定为：

```text
material design write
        ↓
successful capture_canvas
        ↓
concrete refinement write
        ↓
successful capture_canvas
        ↓
completion allowed
```

模型第一次截图后的“看起来正常”不构成 refinement。缺少任一步时，Runtime 拒绝完成，并把可信复核要求只加入下一模型轮次的 system context，不写成用户消息。被拒绝的临时完成文本不进入 durable journal；已经流到 Renderer 的增量以空 completion 收束并隐藏。门禁重试有上限；持续不满足时 Run 以可见错误结束，不能伪装成功或无限循环。

## 能力验收

本决策的首个产品验收样张是“原创企鹅”，不是企鹅特例：

- 主体、翅膀、脚、织物和自定义符号可使用可见 Path，而不是被迫用椭圆/矩形近似。
- 复合对象位于语义 Frame/Group，图层关系可选择、保存、重开、撤销和重做。
- Path 可组合渐变、描边、阴影、光晕、模糊、blend 与 mask。
- Agent 必须完成两次渲染检查和中间修正后才能报告完成。

同一门禁覆盖海报和品牌图形的自由轮廓、复杂外观、图片与文字合成。它不把尚未实现的专业 Pen 编辑、SVG 导入/导出、富文本、布局、组件或完整海报交付链描述为已完成。

## 验证门禁

- schema 接受有界 SVG path、fill rule 与完整 Shape appearance，拒绝标记文本、未知字段和未知文档版本。
- `1.1.0 → 1.2.0` 对合法和不可解释的旧 Path 均有迁移测试，原始载荷可追溯。
- Path 事务覆盖 preview、apply、保存重开、undo 与 redo。
- Leafer mapping 和 adapter 测试证明 Path 实例保留几何、渐变、描边、winding rule 与 glow/shadow。
- Agent tool schema 向模型公开正式 Path 字段并拒绝非路径标记。
- Runtime 测试证明被拒绝的完成消息不持久化、复核要求不伪装为用户消息。
- 真实 Electron 仍需用企鹅与效果海报样张完成截图和交互验收；自动化不能冒充最终审美验收。
