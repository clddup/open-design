# ADR-0025：版本化 Polygon/Star 语义与受控 SVG 往返

- 状态：已接受
- 日期：2026-08-11
- 文档协议：`DesignDocument 1.6.0`

## 背景

专业设计平台中的规则多边形和星形不是一次性 Path。用户需要在创建后继续修改顶点数、星形内径、尺寸、外观和圆角；Agent、人工 UI、保存重开、Boolean 与 SVG 交换也必须理解同一语义。如果只让工具栏创建普通 Path，或把参数塞入 `extensions`，后续编辑会丢失高层意图，并形成 Renderer、Agent 与导出器各自猜测的补丁链。

Figma 的 Shape tools 与 StarNode 把规则图形作为可继续编辑的高层对象；LeaferJS 提供原生 Polygon/Star 绘制属性。OpenPencil 在固定提交 `449f31dd8b7df12965f65d9da774597332fc153d` 中也区分画布侧 Polygon 输出与普通 SVG polygon 导入：普通 `<polygon>` 被解析为闭合 Path，而不是从顶点猜测高层语义。这些行为作为产品和交换边界参考，不改变 OpenDesign 自有文档、事务和权限模型。

## 决策

`DesignDocument 1.6.0` 新增两个唯一持久节点：

- `polygon`：`pointCount` 为 `3..60` 的整数，`cornerRadius >= 0`；默认三边、零圆角。
- `star`：`pointCount` 为 `3..60` 的整数，`innerRadius` 为 `0..1`，`cornerRadius >= 0`；默认五角、`innerRadius = 0.382`、零圆角。

两类节点复用 Shape 的 fill、stroke、opacity、blend、effect 与 mask 语义。顶点在节点局部 bounds 中从顶部开始并按顺时针生成；非正方形 bounds 对局部单位圆作独立 x/y 缩放，因此 resize 不需要把节点扁平化为 Path。Figma 式 corner smoothing 尚未进入协议，不能用 Leafer 私有字段或 `extensions` 冒充。

人工工具栏提供独立 Polygon 与 Star 入口，不编造 Figma 未定义的单键快捷键。拖动创建复用 Leafer 画布手势：Shift 保持正方形 bounds，Alt/Option 从中心绘制；点击创建确定性默认尺寸。创建成功后选中新节点并回到 Select。Inspector 可修改顶点数、Star 内径百分比、圆角和通用外观；每次提交仍是一条普通 `DesignTransaction`，复用 revision、undo/redo 与保存重开。

Leafer adapter 把两个节点分别投影为固定 `leafer-editor@2.2.9` 的 `Polygon` 与 `Star`，映射 `sides` / `corners`、`innerRadius`、`cornerRadius` 和通用 appearance。Leafer 场景仍是当前 revision 的可丢弃投影，不保存为 OpenDesign 文档，也不向 Agent 暴露引擎对象。

Agent 的 `opendesign_apply_transaction` 接受同一完整节点，并由完整 Design Contracts 做最终运行时校验。模型提示词要求规则多边形/星形使用语义节点，不能在需要后续参数编辑时提前扁平化为 Path。

## Boolean 与 SVG 保真边界

零圆角 Polygon/Star 使用协议中的确定性顶点生成器转换为闭合 PathKit 输入，可以成为非破坏 Boolean operand。fingerprint 包含尺寸、顶点数、Star 内径与圆角，任何几何参数变化都会精确失效缓存。

当前 Leafer 圆角算法没有对应的 OpenDesign 精确 outline service。`cornerRadius > 0` 的 Polygon/Star 因此会在 Boolean planner/resolver 中返回 `visual-fidelity` / `unsupported-style`，不会忽略圆角后继续计算。

零圆角 Polygon/Star 以标准 `<polygon>` 导出，并附带版本、kind、width、height、pointCount、innerRadius 与 cornerRadius 的受控 OpenDesign metadata。导入器只有在 metadata 完整、范围合法且实际 points 与参数生成结果逐点一致时才恢复语义节点；缺失或被篡改的数据明确失败。普通第三方 `<polygon>` 继续按标准 SVG 语义导入为 Vector，不猜测 Polygon/Star。圆角规则图形在精确 outline 完成前明确拒绝 SVG 导出，不输出视觉错误的尖角替代品。

## 迁移

读取 `1.5.0` 文档时只把 `schemaVersion` 确定性升级为 `1.6.0`，不发明 Polygon/Star。`1.0.0` 至 `1.4.0` 继续按既有 appearance、Path、Image placement、mask 与 Line 迁移顺序升级。未知版本继续拒绝。

专业 fixture 的权威生成器同步输出 `1.6.0`；生成文档和 SHA-256 manifest 由脚本重新生成，不手工修改派生产物。

## 当前证据与限制

- Contracts 覆盖合法/非法参数、顶部起点的确定性顶点与 `1.5.0 → 1.6.0` 迁移。
- Leafer mapping/adapter 覆盖原生 Polygon/Star 投影、Shift/Alt 创建和增量场景路径。
- Renderer 覆盖工具栏创建、选中、回 Select、Inspector 参数更新与 undo/redo。
- Agent schema 覆盖合法节点以及小数/越界 pointCount、越界 innerRadius 拒绝。
- Boolean 使用真实 PathKit 覆盖尖角 Polygon/Star、参数缓存失效与圆角拒绝。
- SVG 覆盖受控语义往返、普通外部 polygon 保持 Vector、metadata/points 篡改拒绝与圆角导出拒绝。
- capability 保持 `degraded`：尚无 macOS/Windows 打包直接操作证据、真实 Leafer 像素 baseline 与 Figma 式 corner smoothing。

## OpenPencil 对照的使用边界

OpenPencil 的稳定工作台、Pen/锚点编辑、画布 overlay、属性面板、图片裁剪、SVG 测试和模板库可作为后续产品行为与验收矩阵参考。OpenDesign 不重新引入其 Rust/Jian/CanvasKit runtime、文档对象、MCP 任意路径入口、vendor/submodule、构建资源或双写状态。任何借鉴都必须重新落入 OpenDesign 公共语义、唯一 `EditorRuntime`、Main capability 与 Leafer/专业 service adapter。

## 参考

- [Figma Shape tools](https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools)
- [Figma StarNode](https://developers.figma.com/docs/plugins/api/StarNode/)
- [Leafer Polygon](https://www.leaferjs.com/ui/en/reference/display/Polygon.html)
- [Leafer Star](https://www.leaferjs.com/ui/en/reference/display/Star.html)
- [OpenPencil pinned comparison commit](https://github.com/ZSeven-W/openpencil/tree/449f31dd8b7df12965f65d9da774597332fc153d)
- [OpenPencil SVG import shape mapping](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/svg_import/nodes.rs)
- [OpenPencil SVG export](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-ui/src/svg_export.rs)
- [OpenPencil Pen authoring](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/pen.rs)
- [OpenPencil path editing](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/path_edit.rs)
