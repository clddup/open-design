# ADR-0023：版本化 SVG 交换服务与显式保真边界

- 状态：已接受（纯 service 与 EditorRuntime 导入/导出 planner 完成，产品入口待完成）
- 日期：2026-08-11
- 补充：ADR-0011、ADR-0012、ADR-0015、ADR-0021、ADR-0022
- 固定依赖：`@xmldom/xmldom 0.8.13`、`transformation-matrix 3.1.0`

## 背景

OpenDesign 已用可移植 SVG path data 表达 Path/Vector，并用固定 PathKit provider 处理布尔与路径几何，但“文档中能保存一段 path”不等于具备 SVG 文件交换能力。完整 SVG 涉及 XML 解析、transform grammar、层级、样式继承、gradient、stroke、mask、filter、图片、文字、外部引用、安全限制和保真报告；这些职责不能继续塞进 React、Leafer adapter、Agent prompt 或 Main 文件处理分支。

Figma 的公开行为提供产品参照：导入的 SVG 不再作为 raster image，而是转成可编辑 vector；SVG 导出提供 `id`、outline text 和 simplify stroke 等显式选项，并说明文字默认转 glyph、stroke 会按 SVG 限制转换。OpenDesign 不逐字复制实现，但采用同一原则：交换结果必须可编辑，格式不兼容项必须显式转换或报告，不能静默宣称无损。

## 依赖裁决

首个 service 固定以下成熟依赖：

- `@xmldom/xmldom 0.8.13`：MIT、无运行依赖、npm 解包约 203 KB；负责 XML DOM parse/serialize，不自行编写 XML parser。
- `transformation-matrix 3.1.0`：MIT、无运行依赖、npm 解包约 458 KB；负责 SVG transform attribute grammar、仿射矩阵组合和点变换，不自行编写 transform parser。
- 既有 `pathkit-wasm 1.0.0` provider：负责 path 校验、规范化、tight bounds 与 Boolean 派生结果；SVG service 不持有或泄漏 PathKit 对象。

Paper.js 拥有 Project/Layer/Item 和渲染场景，ADR-0021 已因第二份编辑状态风险拒绝。SVGO 是优化器而不是 OpenDesign 语义 importer；可以在后续独立导出优化阶段评估，但不用于决定当前文档层级和保真语义。

## 决策

### 独立、纯、版本化 service

新增 `@opendesign/import-export-service`，首个契约为 `SVG_INTERCHANGE_VERSION = 1`。它只接收纯 OpenDesign 数据、受控 SVG 文本、显式 viewport 和 geometry provider，返回：

- 导出 SVG 字符串、实际参与节点 ID 和结构化 fidelity issues；
- 导入后的候选 OpenDesign nodes、单一 root Group、source viewport 和结构化 fidelity issues；
- 失败时的明确 issue code，不返回部分成功文档冒充完整结果。

service 不读取或写入文件，不持有 `EditorRuntime`，不创建第二份持久文档，不访问 Leafer、Electron、项目路径、网络、凭据或 Agent 权限。`EditorRuntime.planSvgImport()` 已把成功候选树转换成父节点优先的标准 `insert_element` 命令，并保持 service 与文档状态分离；后续人工 UI、Agent 与 MCP 只能复用该 planner，把候选 nodes 包装成普通 `DesignTransaction` 进入唯一 `EditorRuntime.apply()`。`EditorRuntime.planSvgExportRequest()` 从显式 Page、稳定 root IDs 和 `baseRevision` 生成 origin-normalized 的纯 `SvgExportRequest`；它不读取实时选区、Renderer 对象或文件路径。

### 导出目标与设置语义

Figma 当前允许导出 layer、Frame、Group、Section、Slice 和 Page，默认开启 Ignore overlapping layers；SVG 还提供 include ID、outline text 与 simplify stroke 等格式设置。当前 OpenDesign 子集采用可证明的共同部分，并对未实现部分保持显式限制：

- 只导出调用方给出的稳定 root IDs，不把相交但未选择的层隐式加入产物；同一组合产物按 Page paint order 排列，不使用点击顺序决定 z-order。
- Group 的产物 bounds 来自实际渲染子树；显式 Frame 目标保持 Artboard 固定尺寸；嵌套 world transform 被归一到 `viewBox="0 0 width height"`，可选 padding 提供受控留白。
- 多 root request 表示一个组合 SVG；Figma 式逐层/批量多文件导出由后续产品入口对每个目标分别规划，不能让 service 隐式决定文件数量。
- `includeLayerIds` 是当前已实现的显式设置。Outline text、simplify/outline stroke、include overlapping layers、Slice、Page 与持久 export settings 尚未实现，不在 API 中提供无效开关。
- 选中锁定层仍可只读导出；锁定只禁止修改，不禁止检查和交付。
- 若渲染子树包含 Boolean，planner 只接受与当前 `documentId + revision + Page` 完全匹配且无相关 resolver issue 的几何快照。失配、缺失或失败结果不会进入 service。

### 当前结构化子集

当前导入/导出覆盖：

- Group、Rectangle、Ellipse、Path、Vector；外部 line/polyline/polygon 转为正式 Vector path；
- 层级、可见性、opacity、SVG transform list、viewBox、solid、linear/radial gradient、fill rule、center stroke、cap/join/dash；
- 固定字符数、元素数、节点数与深度预算；确定性 ID 和输出顺序；
- 导入结果重新通过完整 `DesignDocument` schema/invariant 校验测试。

当前仍明确报告或拒绝：Text、Image、Instance、stylesheet、`use`、clip/mask、filter/effects、image paint、angular gradient、多个叠加 paint、inside/outside stroke、user-space gradient、复杂 gradient transform 和外部 URL。这里的“拒绝”是保真边界，不把危险或无法表达的数据保存到 `extensions` 后继续执行。

### Boolean 的标准 SVG 语义

标准 SVG 无法保存 OpenDesign 非破坏 Boolean 的 operation、源 operand、统一组外观和编辑 scope。导出 Boolean 时，调用方必须提供同 revision、同 Page resolver 产生的纯 `SvgResolvedBooleanPath`：

- SVG 只写一个标准 result `<path>`；
- 返回 `boolean-flattened` warning；
- OpenDesign 文档中的 Boolean 与 operands 不变，派生 path 不写回文档；
- re-import 得到可编辑 Vector，不根据私有 metadata 伪造缺失 operands 或恢复 Boolean。

可选 `data-opendesign-*` metadata 只帮助保留名称、ID 与源 kind，不成为持久设计事实，也不能绕过 importer 校验。第三方 SVG 没有这些属性时仍使用同一公开语义导入。

### XML 与引用安全

SVG 始终视为不可信输入。当前边界在 DOM parse 前拒绝 `DOCTYPE`/`ENTITY`，并拒绝 script、foreignObject、stylesheet、`use`、外部 paint URL 和未解析引用。XML DOM、Matrix、Element 与 provider 对象不进入公共结果。后续图片、字体、CSS 或 linked resource 只能通过 Main 签发的资源句柄和独立 capability 引入，不能在 SVG parser 中直接 fetch 或读路径。

## 当前证据

- `OD-BRAND-01` 的真实 PathKit Boolean result 导出为单一 SVG path，源 operand 不进入 SVG；
- re-import 返回可编辑 Vector，重应用 transform 后与原 Boolean result 的 normalized path、fill rule 和 bounds 一致；
- Path/Vector/Rectangle/Ellipse、group hierarchy、transform、solid/linear gradient、stroke 和 dash 确定性往返；
- 导入候选树可组成合法 `DesignDocument`；
- EditorRuntime planner 校验显式 Page/Frame/Group 目标、锁定祖先、插入位置、候选 schema、唯一根、可达性、parent/child 对称、ID 冲突、asset 引用和事务命令上限；成功树按 parent-first 顺序进入一个 revision，一次 undo 删除整棵 SVG，保存重开与 redo 保持一致；
- EditorRuntime 导出 planner 校验显式根层、Page 归属、ancestor/descendant 重复选择、base revision、设置预算与 Boolean snapshot；嵌套变换、Group/Frame bounds、stroke 防裁切、padding、Page paint order 和 0-origin viewport 通过纯 service 产物测试；
- DOCTYPE/ENTITY、script、stylesheet、external URL 和缺失 Boolean geometry 均产生稳定失败；
- service typecheck、lint、fixture 和全仓验证纳入统一门禁。

## 后续门禁

1. Main 通过窄 IPC 读取用户选择的 `.svg` 和写入用户选择的目标，不让 Renderer 获得原始路径能力。
2. 人工 UI 与 Agent typed tools 复用同一 planner/service、fidelity report、取消与诊断；MCP 后续复用同一入口。
3. 接入 outline stroke、text glyph、effects/filter、mask/clip、image asset 和多 paint 保真；unsupported 项未清零前不宣称完整 SVG。
4. 在 `OD-BRAND-01` 上保存导出产物、re-import 文档、真实 Leafer像素 baseline，并完成 macOS/Windows 打包产品 smoke。

## 参考

- [Figma add images and videos：SVG 导入为可编辑 vector](https://help.figma.com/hc/en-us/articles/360040028034-Add-images-and-videos-to-designs)
- [Figma export static designs：Layer、Frame、Group、Slice 与批量导出](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma)
- [Figma export formats and SVG settings](https://help.figma.com/hc/en-us/articles/13402894554519-Export-formats-and-settings)
- [Figma Boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [xmldom](https://github.com/xmldom/xmldom)
- [transformation-matrix](https://github.com/chrvadala/transformation-matrix)
