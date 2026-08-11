# ADR-0023：版本化 SVG 交换服务与显式保真边界

- 状态：已接受（纯 service、EditorRuntime planner、Main 文件桥、人工入口、Agent 导入/导出、受控可编辑 Text 与基础 filter effects 完成；剩余格式保真与打包实机待完成）
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

service 不读取或写入文件，不持有 `EditorRuntime`，不创建第二份持久文档，不访问 Leafer、Electron、项目路径、网络、凭据或 Agent 权限。`EditorRuntime.planSvgImport()` 已把成功候选树转换成父节点优先的标准 `insert_element` 命令，并保持 service 与文档状态分离；人工 UI 已复用该 planner，把候选 nodes 包装成普通 `DesignTransaction` 进入唯一 `EditorRuntime.apply()`，后续 Agent 与 MCP 也必须复用同一入口。`EditorRuntime.planSvgExportRequest()` 从显式 Page、稳定 root IDs 和 `baseRevision` 生成 origin-normalized 的纯 `SvgExportRequest`；它不读取实时选区、Renderer 对象或文件路径。

Electron Main 另以 `SvgFileService` 提供路径不出 Main 的窄文件桥：Renderer 只能请求原生打开对话框，或提交 `suggestedName + contents` 请求原生保存对话框；不能提交或接收 `filePath`。打开只接受一个 regular `.svg` 文件，并在读取前后校验共享字符/UTF-8 字节预算，使用 fatal UTF-8 解码；保存只接受 `.svg`，缺少扩展名时追加，并使用同目录临时文件后 rename。Preload 对请求与响应再次执行 exact-shape 校验，取消统一返回 `null`。POSIX 与 Windows path semantics、伪造路径字段、未知发送方、额外 IPC 参数、非法 UTF-8 和超预算文件均有自动化回归。

人工产品入口位于原生/标题栏 File 菜单和 Properties Inspector。导入在打开原生对话框前冻结 document、revision、Page、选区目标与 viewport center；单选 Frame/Group 时居中插入容器，否则居中插入当前 Page viewport。XML 与 PathKit 工作只在可终止的 module Web Worker 中执行，返回后再次核对 revision，再以一个事务应用并选中新根；取消、worker crash、协议错误和 stale target 都不会留下部分树。导出冻结 document snapshot 与显式选区 roots，移除已被选中 ancestor 覆盖的 descendant，在同一 worker 解析 Boolean 后才经 Main 保存；用户在导出期间继续编辑不会改变该次产物。Properties 只开放当前真实实现的 `includeLayerIds` 和 `padding`，并显示进行中、取消、成功与有界 fidelity report。

Agent `opendesign_export_svg` 只接受 `inspect_document` 返回的稳定 Page/root IDs、portable suggested name、`includeLayerIds` 与 `padding`，不读取发送时或实时选区，也不接受路径、SVG 源码或未实现设置。Renderer 使用同一 worker 生成版本化 preparation；Main 再校验完整源码、revision、实际导出节点和 fidelity issues，随后打开同一原生保存对话框。utilityProcess 最终只收到 `saved/name/revision/exportedNodeIds/issues`，不收到 SVG 源码或目标路径。用户取消原生对话框是正常 `saved:false` 结果。

Agent `opendesign_import_svg` 只接受当前 Run 已附加的 `svg_<sha256>` 内容寻址句柄，以及 `inspect_document` 返回的稳定 Page/Frame/Group 目标、插入层序和目标局部左上角坐标；不接受 XML、URL、路径、实时选区或 viewport。SVG 附件不冒充 raster image 或普通文档，不进入 Provider 多模态/文档输入；模型只看到有界的 handle/name/byteSize 提示。Main 的 `AgentReferenceHost` 在当前 Run 内复核句柄和存储元数据，生成不由模型控制的内部 ID prefix，再以仅限 Main→Renderer 的 `opendesign_internal_import_svg` 传入同一可取消 worker。Renderer 复用 `planSvgImport()`，preview 后执行一次 `EditorRuntime.apply()`、自动选中新根并形成一次 undo。Main 最终只向 utilityProcess 返回 `attachmentId/name/pageId/parentId/rootNodeId/importedNodeIds/revision/issues`；XML、路径和内部 ID prefix 不回传。未授权句柄、过期 revision、锁定或越界目标、worker 失败、伪造结果和取消均不会留下部分树。

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

- Frame、Group、Rectangle、Ellipse、Path、Vector，以及标准 `<text>/<tspan>` + 有界受控 metadata 的 OpenDesign Text 往返；外部 line/polyline/polygon 转为正式 Vector path；
- 层级、可见性、opacity、SVG transform list、viewBox、solid、linear/radial gradient、fill rule、center stroke、cap/join/dash；
- 圆角 Frame `clipsContent`，以及按父容器 child order 分段的 alpha、luminance、outline、clipping sibling mask；受支持的外部本地 user-space `<mask>/<clipPath>` 引用展开为可编辑同级蒙版组；
- 最多八个普通混合、零 spread 的 drop shadow 与一层 layer blur；效果数组顺序和 `visible` 可确定性往返，标准单个 `feDropShadow`/`feGaussianBlur` 可直接导入；
- 固定字符数、元素数、节点数与深度预算；确定性 ID 和输出顺序；
- 导入结果重新通过完整 `DesignDocument` schema/invariant 校验测试。

当前仍明确报告或拒绝：没有 OpenDesign 受控 metadata 的普通第三方 Text、Image、Instance、stylesheet、`use`、SVG root-level mask/clip、同一元素组合 `mask + clip-path`、`objectBoundingBox` clipPath、包含不受支持 Text/Image source 的 mask、inner shadow、background blur、inner/outer glow、grayscale、shadow spread/非普通 blend、复杂 filter/mask graph、image paint、angular gradient、多个叠加 paint、inside/outside stroke、user-space gradient、复杂 gradient transform 和外部 URL。这里的“拒绝”是保真边界，不把危险或无法表达的数据保存到 `extensions` 后继续执行。

### Text 的标准输出与受控可编辑往返

OpenDesign Text 导出为真实的标准 SVG `<text>` 和逐行 `<tspan>`，保留 content、transform、font family/size/weight、line height、letter spacing、水平/垂直对齐、fill、stroke、opacity 与当前受支持 effects；不会用文字转轮廓伪装可编辑文本。行位置由 Text box 和 line height 显式写入，空白通过 `xml:space="preserve"` 保留。

SVG 1.1 不能单独表达 OpenDesign 固定 Text box、自动换行和完整字体布局语义，因此导出同时写入有界、版本化且通过 Text schema 校验的 `data-opendesign-text-version="1"` metadata。重新导入 OpenDesign 自己的产物时，importer 同时校验 metadata、标准 font/alignment/tspan 内容与位置、paint/stroke 表达，任一篡改都返回 `text-fidelity-unsupported`，不会让 metadata 覆盖不匹配的可见 SVG。字体文件不嵌入会返回 `text-font-not-embedded` warning；自动换行、justify 与不同 SVG consumer 的 shaping 差异返回 `text-layout-fidelity` warning，但普通 Text 不再导致整个导出失败。没有受控 metadata 的第三方 `<text>` 继续显式拒绝，直到独立 Text/Font service 能确定性解析字体与 text-box 语义。

### Frame clipping 与 sibling mask 语义

Figma 的公开语义是非破坏 sibling mask：mask source 位于被遮罩层下方，向上影响同一父容器内的后续 siblings，直到下一个 mask、父 Frame/Group 边界或 clipping Frame。Mask source 与被遮罩层相互独立移动，不形成父子关系。OpenDesign 文档的 `maskMode` 与 Leafer 投影采用同一顺序语义，而标准 SVG 把 `mask="url(#id)"` / `clip-path="url(#id)"` 写在“被遮罩的渲染对象”上，因此不能把 `maskMode` 直接翻译成当前节点属性。

导出器按每个 Frame/Group 的 `childIds` 识别 mask runs，并生成受控标准结构：

- `alpha` 与 `luminance` source 分别进入显式 `mask-type="alpha|luminance"` 的 user-space `<mask>`；
- `outline` source 进入 user-space `<clipPath>`，source opacity 作用于整个 masked run；
- `clipping` 保留可见 source，并用去除重复 layer identity 的 source 副本建立 alpha `<mask>`，避免同一 SVG 文档产生重复 `id`；
- 每个 run 的 masked siblings 放入引用对应 definition 的透明 `<g>`；遇到下一 mask 或父容器边界立即结束；
- user-space mask region 取 source/targets 变换后 bounds 的并集，并按可见描边、blur、drop shadow/glow 的保守扩张量放大，避免专业效果在 mask 边界被默认 region 截断；
- Frame background 仍作为自身外观绘制，children 单独进入与 Frame 尺寸/圆角一致的本地 `<clipPath>` wrapper，因此 `clipsContent` 不会错误裁掉 Frame background；
- source 与 targets 只各计入一次 `exportedNodeIds`，definitions 不建立第二份文档状态。

导入 OpenDesign 自己生成的 graph 时，importer 会校验版本、mode、local reference、Frame clip bounds、outline opacity，以及 clipping 可见 source 与 definition 副本的结构一致性，再恢复正式 sibling source + targets；受控 wrapper 不进入文档层级。普通第三方 SVG 的单一本地 user-space `<mask>` / `<clipPath>` 会展开为一个可编辑 Group，内部仍是 sibling mask source 与原 target，不保留隐式共享 definition。外部 URL、缺失/重复 definition、循环引用、`objectBoundingBox` clipPath、组合 mask+clip 和无法导入的 source 稳定失败，不能静默返回未遮罩内容。

### 基础 SVG filter effects 语义

Figma 当前把 shadow、blur、effect visibility 和 effect order 作为正式图层外观：单层最多可持有八个 drop shadow、八个 inner shadow 和一个 layer blur。OpenDesign 首个 SVG filter 子集先覆盖能由当前标准 SVG 和文档语义确定性表达的共同部分，不因渲染后端“看起来能画”就猜测复杂 graph。

W3C `feDropShadow` 是包含输入图像再次合成的 shorthand。若为多个阴影各自产生一个 `feDropShadow` 再 `feMerge`，半透明源图会被重复叠加。导出器因此把每个 drop shadow 展开为独立的 `SourceAlpha → feGaussianBlur → feOffset → feFlood → feComposite` shadow-only 分支，再按效果顺序与唯一源图合成；layer blur 使用独立 `SourceGraphic → feGaussianBlur` 结果。`blur/radius` 与标准差使用可逆的 `stdDeviation = radius / 2` 映射，filter 使用显式 `userSpaceOnUse` 区域，并按 stroke、offset 和四倍标准差扩展边界，避免默认 filter region 裁切。

不可见但受支持的 effect 仍写入无输出分支，并以有界 `data-opendesign-effect-*` 元数据保留编辑状态；最终 `feMerge` 只引用可见分支。该元数据不改变标准 SVG 的视觉结果，也不能恢复缺失的非 OpenDesign graph。导入只接受本地 `url(#id)`：OpenDesign 生成的受控 graph、单个标准 `feDropShadow` 和单个标准 `feGaussianBlur` 会进入正式 `DesignNode.effects`；外部 URL 直接拒绝，未解析引用、各向异性 blur、超预算数值和任意复杂 graph 返回 `unsupported-filter` fidelity warning，不藏入 `extensions` 或假装无损。

这个扩展没有改变公开结果 shape 或节点协议，只扩大 `SVG_INTERCHANGE_VERSION = 1` 的已支持标准子集，因此不升级交换版本。若后续公开 issue/result 结构、filter graph 语义或 effect 数据契约改变，必须升级版本并提供迁移行为。

### Boolean 的标准 SVG 语义

标准 SVG 无法保存 OpenDesign 非破坏 Boolean 的 operation、源 operand、统一组外观和编辑 scope。导出 Boolean 时，调用方必须提供同 revision、同 Page resolver 产生的纯 `SvgResolvedBooleanPath`：

- SVG 只写一个标准 result `<path>`；
- 返回 `boolean-flattened` warning；
- OpenDesign 文档中的 Boolean 与 operands 不变，派生 path 不写回文档；
- re-import 得到可编辑 Vector，不根据私有 metadata 伪造缺失 operands 或恢复 Boolean。

可选 `data-opendesign-*` metadata 只帮助保留名称、ID 与源 kind，不成为持久设计事实，也不能绕过 importer 校验。第三方 SVG 没有这些属性时仍使用同一公开语义导入。

### XML 与引用安全

SVG 始终视为不可信输入。当前边界在 DOM parse 前拒绝 `DOCTYPE`/`ENTITY`，并拒绝 script、foreignObject、stylesheet、`use`、外部 paint/filter/mask URL、未解析或循环引用。XML DOM、Matrix、Element 与 provider 对象不进入公共结果。后续图片、字体、CSS 或 linked resource 只能通过 Main 签发的资源句柄和独立 capability 引入，不能在 SVG parser 中直接 fetch 或读路径。

## 当前证据

- `OD-BRAND-01` 的真实 PathKit Boolean result 导出为单一 SVG path，源 operand 不进入 SVG；
- re-import 返回可编辑 Vector，重应用 transform 后与原 Boolean result 的 normalized path、fill rule 和 bounds 一致；
- Path/Vector/Rectangle/Ellipse、group hierarchy、transform、solid/linear gradient、stroke 和 dash 确定性往返；
- Text 以标准 `<text>/<tspan>` 输出，并在校验 font、line content/position、paint/stroke 与有界 metadata 后恢复为正式 TextNode；普通第三方 Text、metadata/content/paint 篡改稳定失败；
- 圆角 Frame `clipsContent` 与四种 ordered sibling mask mode 可确定性往返且不产生 background 假图层；受支持的外部本地 mask/clipPath 展开为合法可编辑树，篡改 definition、外部 URL、objectBoundingBox clip 与循环引用稳定失败；
- 多个 drop shadow、layer blur、effect visibility/order、filter region 与标准 shorthand 确定性往返；spread、inner/background/glow/grayscale 和复杂 graph 均返回明确保真报告，外部 filter URL 稳定拒绝；
- 导入候选树可组成合法 `DesignDocument`；
- EditorRuntime planner 校验显式 Page/Frame/Group 目标、锁定祖先、插入位置、候选 schema、唯一根、可达性、parent/child 对称、ID 冲突、asset 引用和事务命令上限；成功树按 parent-first 顺序进入一个 revision，一次 undo 删除整棵 SVG，保存重开与 redo 保持一致；
- EditorRuntime 导出 planner 校验显式根层、Page 归属、ancestor/descendant 重复选择、base revision、设置预算与 Boolean snapshot；嵌套变换、Group/Frame bounds、stroke 防裁切、padding、Page paint order 和 0-origin viewport 通过纯 service 产物测试；
- Main 文件桥只从原生对话框取得绝对路径，不向 Renderer 返回路径；打开/保存的扩展名、regular file、fatal UTF-8、字符/字节预算、原子写入、取消、发送方与参数数量均有专项测试，并覆盖 Windows `win32` 路径规则；
- 原生/标题栏 File 菜单和 Properties Inspector 已接通人工导入导出；专项测试覆盖 Page/Frame/Group 居中目标、revision stale 拒绝、ancestor/descendant 选区规范化、Windows-safe 文件名、worker 协议/崩溃/取消、设置禁用、保真报告、单 revision、自动选中新根和一次 undo；
- Renderer CSP 显式限制 `worker-src 'self'`；worker 只接收版本化 pure-data 请求，不获得 Electron、路径、凭据或第二份持久文档状态；
- Agent import/export contract、run-scoped SVG attachment/reference host、Renderer 原子 import 与 export preparation、Main import/delivery host 已覆盖无路径参数、先 inspect、显式稳定目标、revision 匹配、worker 取消、伪造 response 拒绝、单次 undo、自动选中新根、原生保存取消、fidelity result 有界化和源码不回传；十六个生产工具仍通过完整 prompt/tool context budget 与 Pi adapter 门禁；
- DOCTYPE/ENTITY、script、stylesheet、external URL、循环/缺失 mask reference 和缺失 Boolean geometry 均产生稳定失败；
- service typecheck、lint、fixture 和全仓验证纳入统一门禁。

## 后续门禁

1. MCP 后续复用同一版本化 SVG import/export service、资源句柄和事务入口，不新增任意 `filePath` 通道。
2. 接入可选 outline-text/text glyph、普通第三方 Text 的确定性字体布局、outline stroke、inner/background/glow/spread/blend 等剩余 filter 语义、复杂组合 mask graph、Text/Image mask source、image asset 和多 paint 保真；unsupported 项未清零前不宣称完整 SVG。
3. 在 `OD-BRAND-01` 上保存导出产物、re-import 文档、真实 Leafer 像素 baseline，并完成 macOS/Windows 打包产品 smoke。

## 参考

- [Figma add images and videos：SVG 导入为可编辑 vector](https://help.figma.com/hc/en-us/articles/360040028034-Add-images-and-videos-to-designs)
- [Figma export static designs：Layer、Frame、Group、Slice 与批量导出](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma)
- [Figma export formats and SVG settings](https://help.figma.com/hc/en-us/articles/13402894554519-Export-formats-and-settings)
- [Figma effects](https://help.figma.com/hc/en-us/articles/360041488473-Apply-effects-to-layers)
- [Figma masks](https://help.figma.com/hc/en-us/articles/360040450253-Masks)
- [Figma Boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [W3C CSS Masking Module Level 1](https://www.w3.org/TR/css-masking-1/)
- [W3C Filter Effects Module Level 1](https://www.w3.org/TR/filter-effects-1/)
- [xmldom](https://github.com/xmldom/xmldom)
- [transformation-matrix](https://github.com/chrvadala/transformation-matrix)
