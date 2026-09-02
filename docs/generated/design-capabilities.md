<!-- Generated from packages/design-capabilities/src/manifest.json. Do not edit by hand. -->

# OpenDesign 专业设计能力

能力清单版本：`1` · 更新日期：2026-09-02 · 文档协议：`1.57.0` · 画布基线：`leafer-editor@2.2.9`

当前状态：可用 0 项，降级可用 22 项，不可用 0 项。只有必需表面全部可用，并同时具备自动化与实机证据时，能力才允许标记为“可用”。

## 基础工作流

### 文档生命周期 — 降级可用

打开、保存、重开并版本化原生设计文件，聊天记录不充当设计事实。

- ID：`document.lifecycle`
- 实现方：OpenDesign Workspace + EditorRuntime
- 表面：contract=available；runtime=degraded；human=degraded；agent=degraded；render=available；export=unavailable
- 证据：自动化 7 项；实机 0 项
- 限制：Agent 可通过显式 Page 或 Design File 写入目标创建、重命名、复制、排序、清空和删除 Page，但尚不能管理 Project 或 Design File。

### 画布导航与选择 — 降级可用

在生产 Leafer 画布中平移、缩放、命中、框选、多选，通过兼容 Figma 的 Canvas/Layers/键盘统一选区遍历层级，并变换持久对象。

- ID：`canvas.navigation-selection`
- 实现方：@opendesign/leafer-engine / leafer-editor@2.2.9
- 表面：contract=available；runtime=available；human=available；agent=degraded；render=available；export=unavailable
- 证据：自动化 5 项；实机 0 项
- 限制：macOS 与 Windows 上的真实 Electron 平移、缩放、选框稳定性和大节点量性能尚未完成验收。

### 图层层级 — 降级可用

创建并检查语义化 Frame、Group、嵌套图层、可见性、锁定、兄弟图层堆叠顺序、跨容器重挂载和有序事务；人工命令与 Agent 共用同一套层级 planner。

- ID：`layers.hierarchy`
- 实现方：DesignDocument 1.39.0 + EditorRuntime
- 表面：contract=available；runtime=available；human=degraded；agent=available；render=available；export=unavailable
- 证据：自动化 7 项；实机 0 项
- 限制：画布直接操作时的自动归属仍未补齐；图层面板中的显式跨容器重挂载目前以指针拖放为主。
- 限制：当 Group 级可见性、不透明度、混合、效果或蒙版无法在解组后保持视觉一致时，解组会明确拒绝。

### 精确排列 — 降级可用

通过共享编辑器几何链对齐与排列图层、编辑 Smart Selection 间距与回流、翻转图层、设置持久旋转原点、创建 Figma-shaped Page/Frame 标尺参考线、吸附普通对象与可编辑 Vector 锚点，并检查对象、参考线或 Vector 锚点距离。

- ID：`transform.precise-arrangement`
- 实现方：DesignDocument 1.57.0 + Geometry Service contract 37 + EditorRuntime + Leafer editor projection + Canvas ruler/snap/measurement overlays
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=unavailable
- 证据：自动化 28 项；实机 0 项
- 限制：移动与轴对齐 resize 吸附已支持对象外边缘与中心、Page 参考线、轴对齐 Frame-local 参考线和像素网格取整。Vector edit 已支持直接及多点移动的 point-to-point geometry 吸附、独立持久偏好、Control 临时关闭和每次手势一次既有 Vector 提交；Option/Alt 对象、参考线与单选 Vector anchor 测量均已可用。旋转/倾斜对象定向 resize 与 Frame 参考线吸附、path/handle 吸附及 macOS/Windows 打包产品交互证据仍未补齐。
- 限制：Vector geometry 吸附只消费可编辑 network 锚点与文档变换；它不依赖隔离的 PathKit provider，也不把普通对象 bounds 当作矢量几何。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/Guide/)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039956974-Measure-distances-between-layers)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/41352588622615-Move-a-layer-s-anchor-point)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)

## 矢量

### 可编辑 Path、Pen 与节点编辑 — 降级可用

使用 Pen 创建可编辑三次曲线轮廓、继续调整节点与贝塞尔手柄、连接同层或 sibling Vector 图层的端点、按顶点覆盖端帽、转角与 circular 圆角、给稳定填充区域设置直接 Paint 或共享 Paint Style、把可见描边转换为新的 filled editable Vector sibling，并将同父级受支持的 Frame、nested Group、Boolean、Component Instance 当前投影、可信 glyph-outline Text、Image、图形、Path 与 Vector 拼合为一个 editable Vector，同时保持唯一权威 Vector Network。

- ID：`vector.path-rendering`
- 实现方：DesignDocument 1.57.0 + Geometry Service contract 31 point/path selection-delete/transform/Bend/Connect/Disconnect/Cut/region Fill/region Paint Style/vertex stroke appearance/vertex corner radius/regular-shape corner smoothing/Outline Stroke/Flatten + EditorRuntime document-space multi-Vector transform/Cut/cross-layer Connect/branch junction/Frame-Group-Boolean-Component-Text-Image and root-shell/isolated-pixel-compositing Flatten planner + Leafer exact regular-shape/Line-endpoint and synthetic region/stroke/corner projection + controlled SVG metadata
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 31 项；实机 0 项
- 限制：Pen 已支持点击放点、拖拽镜像三次曲线手柄、首点闭合、Enter/Escape 完成开放路径、Backspace 回退、切换工具收尾、精确 bounds 和单次可撤销事务；当前只创建单条非分叉轮廓。
- 限制：Enter 或双击可让一个或多个已选 Vector 图层进入 schema-valid network 节点编辑；每层拥有独立 trace、稳定 point/path 选区、节点可编辑状态与 topology 可编辑状态。branch junction 节点仍可选择、变换和删除，歧义 topology 控件会被禁用。Q 套索可圈选完整包含的节点与 line/cubic segment；Delete 对节点执行重连，对 segment 则真实断开并确定性生成开放 runs。编辑集合中任意两个以上节点共用一个 document-space 移动/八向缩放/旋转框；缩放或旋转中按住 Space 可平移选区，松开后无跳变继续原操作。pointer-up 与 Agent document-space 变换都把所有变化层提交为一次 revision/undo。
- 限制：Cut 模式（X）支持节点/路径真实断点和跨多个 Vector 图层的有限 document-space 分割；闭合边界通过同侧 connector 与连续边界缝合处理穿孔和凹形多交点 component，开放 contour 按每个真实横穿交点拆成 retained/extracted 开放 runs，不补 connector、region 或隐式 Fill。跨层 Connect 会原子合并外观一致的 sibling Vector 图层并保留较早图层；一个 endpoint 也可连接到另一 path vertex 以创建 shared branch junction，显式开放 path endpoint 也可从该 junction 断开而不重写其他 path。稳定 region 已支持继承、显式无填充或 region-local Paint 三态；Paint 点击设置区域，Alt 点击清除，Cut 会把已创作的区域 Paint 传承到两个有效结果。顶点级 stroke cap/join、circular corner radius、节点级 corner smoothing 与 custom dash 连续 phase 已通过 Inspector 与 Agent 支持并回退到节点外观；嵌套或重叠 region、只切孔洞、shared-junction 精确命中和切后仍跨两侧的 connected Cut component、像素基线和打包交互证据仍未完成。Outline Stroke 会创建新的 editable sibling 并保留源层；同父级 Frame、nested Group、Boolean、Component Instance 当前投影、可信 glyph-outline Text、Image、Rectangle、Ellipse、含端点装饰的 Line、精确零圆角或圆角 Polygon/Star、Path 与 Vector 可破坏性生成一个 editable 结果；Frame 保留 Fill、递归 children、Stroke 的绘制顺序与 rounded clipping boundary，Group 保留递归 child order 与祖先 transform，Boolean 复用已解析的 PathKit geometry，Text 从可信 layout provider 保留 UTF-16 run Paint、当前 Text/Paint Style 投影、baseline、glyph geometry、基础 underline/strikethrough 轮廓、solid/wavy/dotted 高级 underline 的 offset/thickness/独立 color、重新 shaping 的 ending truncation/maxLines 显示 glyph 与祖先 transform。Image Flatten 会把 Stretch/Fit/Fill/Crop、焦点、缩放、旋转、翻转、filters 与圆角裁剪保存为 region-local Image Paint。单根选择按 Component、Shared Style、Variable 投影当前外观，结果 Vector 保留根级 opacity/effect/blend/mask shell，Paint Variable 物化当前值后解除绑定。缺失精确 outline 或 exact geometry provider 的 Text 仍失败关闭。self-contained 多根或后代 opacity、普通 effect 与完整 mask stack 会从冻结 exact-revision Leafer 投影合成为一个 PNG asset 与 image-filled Vector 单事务；依赖选择外 backdrop 的 blend/background effect 仍未完成。导入字体 exact skip-ink 已可用。两种操作均有人工与 Agent 入口。
- 限制：受控 OpenDesign SVG metadata v6 只在通过 schema、拓扑且与标准渲染 region paths 精确匹配时保留 editable network；没有 metadata 的外部 SVG 保持为精确 path 数据，不猜测可编辑拓扑。当前 SVG vector slice 仍显式不支持 Image Paint。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360050986854-Adjust-corner-radius-and-smoothing)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/pen.rs)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/path_edit.rs)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-ui/src/widgets/canvas_path_overlay.rs)

### 直线与箭头 — 降级可用

创建并直接编辑有方向的直线，独立设置起终点装饰和专业描边，并通过 SVG 保持可编辑交换。

- ID：`vector.line-arrow`
- 实现方：DesignDocument 1.57.0 + Geometry Service contract 31 shared Line endpoint geometry + Leafer Arrow / LineEditTool + EditorRuntime Flatten + SVG controlled markers
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 10 项；实机 0 项
- 限制：当前切片支持单段可编辑直线、Shift 45 度约束、Alt 中心绘制、独立的无/线性箭头/三角/反向三角/圆点/菱形端点、端帽/连接/虚线控制和原生端点拖动；折线连接器、正交路由、吸附、标签挂接及 macOS/Windows 打包交互证据仍未完成。
- 限制：SVG 往返使用精确的本地 OpenDesign marker 定义；普通外部 line 可导入为 Line，未知、外部、缺失或被修改的 marker 会明确失败，不会被扁平化或盲目信任。
- 限制：Leafer 投影、受控 SVG marker 与破坏性 Flatten 共用 OpenDesign 自有的端点 path、方向与比例；中心线 dash 不作用于端点，零长度端点 Line 在产生部分几何前失败关闭。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/reference/display/Line.html)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/plugin/in/arrow/)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/reference/property/editable.html)

### 规则多边形与星形 — 降级可用

创建、缩放、调整外观并交换语义化 Polygon 与 Star 节点，不将其扁平化为普通 Path。

- ID：`vector.regular-shapes`
- 实现方：DesignDocument 1.57.0 + Geometry Service contract 31 + Leafer exact projection + controlled SVG regular-shape metadata 2
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 12 项；实机 0 项
- 限制：Polygon 支持 3–60 个顶点；Star 支持 3–60 个顶点和归一化内径。两者均支持非负圆角及 0–1 的 Figma-compatible 整形级 corner smoothing；Star 只对外尖角应用圆角。Shift 将绘制边界约束为正方形，Alt/Option 从中心绘制。
- 限制：零圆角与圆角 Polygon/Star 在实时渲染、Boolean、Flatten 和受控 SVG 往返中共用唯一精确 geometry resolver。SVG metadata 2 仅在标准 path 或 polygon 与声明参数精确一致时恢复语义节点；metadata 1 的零圆角图形继续可读，普通外部 SVG 仍导入为 Vector，不猜测语义。
- 限制：尚未记录 macOS/Windows 打包程序的直接操作证据与真实 Leafer 像素基线。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/StarNode/)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/en/reference/display/Polygon.html)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/en/reference/display/Star.html)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/svg_import/nodes.rs)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-ui/src/svg_export.rs)

### Pen 与节点编辑 — 降级可用

通过节点和贝塞尔手柄创建、编辑开放、闭合、分支与曲线矢量几何，并在 Vector edit mode 中使用 Figma-compatible 节点吸附与锚点测量。

- ID：`vector.pen-node-editing`
- 实现方：DesignDocument 1.57.0 Vector Network + Geometry Service contract 37 point/path selection-delete/transform/point-snapping/anchor-measurement/Bend/Connect/Disconnect/Cut/region Fill/region Paint Style/vertex stroke appearance/vertex corner radius/Outline Stroke/Flatten + EditorRuntime document-space multi-Vector transform/Cut/cross-layer Connect/branch junction/Frame-Group-Boolean-Component-Text-Image and root-shell/isolated-pixel-compositing Flatten planner + Leafer synthetic region/stroke/corner projection and native editing overlays
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 23 项；实机 0 项
- 限制：Vector 节点拖动和共享多点移动可通过独立偏好吸附到当前 edit scope 的其他锚点，Control 会临时关闭 geometry 与 pixel-grid 吸附；单选一个 anchor 后可用 Option/Alt 测量到另一个悬停 anchor 的 document-space 水平与垂直距离；path 最近点、Bézier handle 与 Pen 自动连接吸附仍未完成。Pen 当前创建单条非分支轮廓；已有节点编辑支持多 Vector collection、Open/Close/Reverse、同层或跨层 Connect/Disconnect、endpoint 到另一 path vertex 的 branch 创建、point/path Lasso 与 segment Delete、跨所选节点的统一 document-space 变换框、缩放/旋转中 Space 平移、点击/document-space Cut 和 region-local Paint 或共享 PAINT Style；branch junction 节点仍可选择、变换和删除，已有入射 handle 可独立拖动，明确 branch segment 可 Bend/Cut/Delete 且不改变其他入射边，明确 path 可在 shared junction 执行 Open/Close/Reverse/Cut，已有 branch network 内的唯一 endpoint 可继续合并，显式开放 path endpoint 或明确 incident edge 也可从开放或闭合 junction 断开。有限线 Cut 会按 shared vertex 与 region connectivity 分配 connected/branch network，未切 branch 会跟随真实 junction component。Bend 已支持节点/路径添加手柄和直接拖动 segment；顶点级 cap/join 外观、circular corner radius、节点级 corner smoothing 与 custom dash 连续 phase 已通过 Inspector 与 Agent 支持；嵌套或重叠 region、只切孔洞、shared-junction 精确命中和切后仍跨两侧的 connected Cut component、self-contained 多根或后代 opacity、普通 effect 与完整 mask stack 已合成为一个 exact-revision PNG-backed Vector 单事务；依赖选择外 backdrop 的 blend/background effect 与打包证据仍未完成。Outline Stroke 会保留源层并创建 filled editable Vector sibling；同父级 Frame、nested Group、Boolean、Component Instance 当前投影、Image、Rectangle、Ellipse、含端点装饰的 Line、零圆角或圆角 Polygon/Star、Path 与 Vector 可用一个 editable 结果替换源层。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/path_edit.rs)

### 布尔运算 — 降级可用

非破坏性的 union、subtract、intersect 与 exclude，且源图层保持可编辑。

- ID：`vector.boolean-operations`
- 实现方：DesignDocument 1.57.0 + Geometry Service contract 31 + EditorRuntime Boolean planner + recursive Skia PathKit resolver + Leafer derived projection
- 表面：contract=available；runtime=available；human=degraded；agent=available；render=available；export=unavailable
- 证据：自动化 13 项；实机 0 项
- 限制：递归 resolver 会把 Rectangle、Ellipse、零圆角或圆角 Polygon/Star、Path、Vector 与嵌套 Boolean 转换为包含 fill+stroke 的 PathKit 几何，应用局部 transform、保留真实空结果，并在不持久化 provider 输出的前提下投影稳定的 Leafer synthetic Path。
- 限制：工具栏/菜单、macOS 与 Windows 快捷键、Inspector operation 控件、解组命令和 Agent hierarchy typed actions 已复用同一套经过 preview 的原子 planner。Enter、双击、图层树选择、Shift+Enter、Escape 与 Tab 已提供短生命周期的源 operand 编辑、派生结果实时预览、锁定只读状态、受控外观字段和上下文失败恢复。文字轮廓、SVG 往返、像素基线和 macOS/Windows 打包产品证据仍不可用；超过两段的 dash pattern、带 mask 的 operand 和开放路径的非居中描边会明确失败，不做静默近似。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)

## 外观与合成

### 填充、效果与蒙版 — 降级可用

应用多重填充与描边、渐变、阴影、光晕、模糊、混合模式、蒙版和高级描边。

- ID：`appearance.paints-effects-masks`
- 实现方：DesignDocument 1.10.0 + EditorRuntime mask planner + PropertiesPanel + Leafer adapter + SVG filter/mask adapter
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 10 项；实机 0 项
- 限制：Figma-style 作者工作流现可从受支持的 Shape、Text、Image 或容器 source 原子创建 contained sibling mask，人工与 Agent 均使用 Alpha/Vector/Luminance，并在 undo/save 后保持内容可编辑；可编辑 SVG 边界继续保留其受控 alpha/luminance/outline/clipping 段。Image/Text SVG 蒙版源、任意组合 mask graph、画布蒙版轮廓视图、内/背景效果、Electron 视觉基线和专业取色仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360041488473-Apply-effects-to-layers)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450253-Masks)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/properties/nodes-ismask/)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/MaskType/)

## 图片

### 图片导入、生成与放置 — 降级可用

读取明示图片引用、粘贴或拖放图片、生成位图素材，并把内容寻址 asset 放入画布。

- ID：`image.import-generation-placement`
- 实现方：AgentAttachmentHost + ImageGenerationHost + EditorRuntime
- 表面：contract=available；runtime=available；human=degraded；agent=available；render=available；export=unavailable
- 证据：自动化 10 项；实机 0 项
- 限制：图片生成需要独立全局配置；当前文件图片资源已支持预览、搜索、使用次数、定位、画布拖放、导入、全文件替换/relink 与安全删除，但字体、跨文件 Library、来源谱系、移除背景、大列表虚拟化及 macOS/Windows 原生交互证据仍未完成。

### 图片裁剪与调整 — 降级可用

非破坏性裁剪与调整，保留来源历史、恢复图片变体，并在不覆盖原图的情况下替换来源。

- ID：`image.crop-adjustments`
- 实现方：DesignDocument 1.44.0 + OpenDesign Image Service contract 8 + recoverable image derivation DAG + Leafer per-image-paint adjustment projection
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 12 项；实机 0 项
- 限制：Image 节点及每项图片 Fill/Stroke 已通过同一确定性 RGBA 投影支持 Figma-compatible 调整；来源替换会记录由 Inspector、Assets、Agent、undo 与持久化共用的可恢复 typed derivation family，远端操作的当前事实由独立 AI 图片编辑能力记录。大图按需存储、standalone 跨文件 Image Paint Style asset bundle、SVG 位图嵌入、完整 Figma imageHash/transform 文件 adapter、P3/ICC 色彩管理及 macOS/Windows 原生交互证据仍未完成。
- 专业参照：[官方说明](docs/adr/0089-direct-image-crop-session.md)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040675194-Crop-an-image)

### AI 图片编辑 — 降级可用

基于一张或多张源图，通过蒙版、局部重绘、扩图、分辨率提升、背景替换、重打光或风格统一生成可追溯变体。

- ID：`image.ai-editing`
- 实现方：OpenDesign Image Service contract 8 + Main-owned RGBA mask/expansion raster, upscale target, background-preservation prompt, and typed relighting presets + ImageGenerationHost openai-images edit adapter + EditorRuntime recoverable derivation planner
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=available
- 证据：自动化 10 项；实机 0 项
- 限制：内嵌 PNG、JPEG 与 WebP Image 节点已可通过全局 openai-images 服务去背景、根据新环境描述独立替换背景、使用五个稳定 preset 重打光、用提示词和一张可选参考图编辑整图、通过画布 lasso 执行 Erase/Isolate、使用手柄扩图，并一键提升分辨率。背景替换和重打光由宿主添加固定保留指令并拒绝不受支持的 prompt、参考图或 mask；Upscale 使用宿主计算的约 2× 精确目标且不改变节点几何。带提示词的局部重绘、风格统一、Image Paint 编辑、多参考图、超过 3:1 或已达到当前内嵌结果像素预算的源图，以及 macOS/Windows 产品实机证据仍未完成。
- 专业参照：[官方说明](docs/adr/0133-trusted-remove-background-image-editing.md)
- 专业参照：[官方说明](docs/adr/0134-trusted-prompt-image-editing.md)
- 专业参照：[官方说明](docs/adr/0135-trusted-area-image-editing.md)
- 专业参照：[官方说明](docs/adr/0136-trusted-image-expansion.md)
- 专业参照：[官方说明](docs/adr/0137-trusted-image-resolution-boost.md)
- 专业参照：[官方说明](docs/adr/0138-trusted-image-background-replacement.md)
- 专业参照：[官方说明](docs/adr/0139-trusted-image-relighting.md)
- 专业参照：[官方说明](https://developers.openai.com/api/docs/guides/image-generation)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/24004542669463-Make-or-edit-an-image-with-AI)

## 文字

### 单样式文字 — 降级可用

创建、渲染、变换和编辑固定、自动宽度或自动高度文字，使用单一共享字体样式、对齐、明确换行以及固定框溢出控制。

- ID：`text.single-style`
- 实现方：DesignDocument 1.57.0 + Text Layout Service v5 / Text Run Layout v7 + leafer-editor@2.2.9 Text/TextEditor + controlled SVG text metadata v9
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 15 项；实机 0 项
- 限制：family/style-name/weight/slant 精确身份、运行时字体可用性、全文件精确替换、显式 Auto Size 重排及 unresolved Figma 导出失败已通过单次 revision/undo 可用；字体二进制资源、可变字体轴、精确跨平台 shaping 及 macOS/Windows 视觉验收仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/27378154668951-Adjust-text-dimensions-and-resizing)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/guide/display/Text.html)

### 专业富文本排版 — 降级可用

通过唯一版本化 Runtime、真实范围 Inspector、Agent 工具、native/HarfBuzz 投影及 Figma/SVG/位图结构往返创建 Figma-compatible UTF-16 字符与段落 runs。

- ID：`text.rich-typography`
- 实现方：DesignDocument 1.57.0 + Text Paragraph Service v2 / Text List Service v1 / Text Editing Session Service v2 / Text Run Layout v7 + leafer-editor 2.2.9 + HarfBuzz provider 1.7.0 + SVG metadata v9
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=available
- 证据：自动化 25 项；实机 0 项
- 限制：富文本 runs 已覆盖精确 face、字号、字距、行高、大小写、装饰（包括 solid/wavy/dotted underline 的 offset、thickness 与独立 color）、fills、可选 Text/Paint Style ID、逐段 indent/spacing，以及语义化 ordered/unordered 列表、五级缩进、list spacing、节点级 hanging marker、确定性嵌套计数、换行 hanging indent 与 LTR/RTL logical-start 投影。Text Editing Session v2 会暂存非空范围修改和折叠光标输入样式，只在真实 UTF-16 输入后物化样式；可丢弃 edit-DOM marker 不进入 content/history，Inspector 焦点与 IME DOM identity 保持稳定，每次编辑 session 只提交一条 commit_text_edit Runtime transaction/reflow/revision。输入前缀列表与结构键继续可用。custom list marker、系统字体 exact outline、OpenType 控件、可变字体轴、本地 Style 修改向绑定 range 的实时传播、字体随文件打包/授权迁移、路径文字、更新 bidi 数据、原生 IME/undo smoke 和 macOS/Windows 打包视觉证据仍不可用。
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/TextNode/)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/TextStyle/)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/TextListOptions/)
- 专业参照：[官方说明](docs/adr/0084-figma-compatible-text-lists.md)
- 专业参照：[官方说明](docs/adr/0085-figma-compatible-text-list-editing-session.md)
- 专业参照：[官方说明](docs/adr/0087-figma-compatible-caret-typing-style.md)
- 专业参照：[官方说明](docs/adr/0263-figma-compatible-advanced-text-decoration.md)

## 响应式布局

### Frame 响应式约束 — 降级可用

父 Frame 调整尺寸时，将普通直属子层固定到边缘、拉伸、居中或按比例缩放。

- ID：`layout.constraints`
- 实现方：DesignDocument 1.12.0 + @opendesign/layout-service contract v1 + EditorRuntime
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 9 项；实机 0 项
- 限制：Constraints v1 仅适用于普通 Frame 中无旋转/倾斜/局部缩放的直属子层；Auto Layout 流内子层改由父流管理，不再使用普通 constraints。Group/Boolean 边界、Instance resize、Auto Size 文字拉伸，以及 macOS/Windows 打包 GUI 实机证据仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039957734-Apply-constraints-to-define-how-layers-resize)

### Auto Layout — 降级可用

以线性、换行或 Grid Auto Layout 响应式布局 Frame，包括首行文字基线对齐、row-local Fill 子层、wrapped rows 自动分布及画布 padding/固定 gap 直接操作；也可添加不改变 child 几何且不导出的 Uniform、Columns 或 Rows Layout Guide。

- ID：`layout.auto-layout`
- 实现方：DesignDocument 1.47.0 + @opendesign/layout-service Auto Layout contract v11 + Text Layout Service v5 + EditorRuntime + Figma public Auto Layout projection
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 19 项；实机 0 项
- 限制：Horizontal flow 与 Wrap 使用 provider 实测首行文字基线，普通图层使用底边；交叉轴 Fill 继续以 stretch 覆盖对齐。Horizontal Wrap 以每个 Fill 子层的最小宽度作为换行 basis，在 Min/Max 范围内逐 row 独立分配宽度，只有全部子层都填充交叉轴时 AUTO tracks 才整体拉伸。它不会跨 row 伪造共享列。选中的轴对齐 Frame 会显示可丢弃的 padding 与 linear/Wrap 固定 gap 手柄，并以 exact revision 单次 undo 提交；Auto spacing 不会被静默改成固定值。Auto Layout Grid v2 已支持显式 Fixed/Fill/Hug 行列轨道、row-major flow 自动增减 Fill 行、独立双 gap、Manual 或 row-major 排布、child cell/span/alignment 与 span-aware 行列重排。Uniform、Columns 与 Rows Layout Guide 仍是不参与布局的视觉辅助。Fill 以外的自动行模板、自动列、dense/column flow、Guide style/变量、吸附、旋转 absolute child、spacing 单击输入/旋转/Grid gap 控件、普通 Smart Selection cell/reflow 手柄、SVG Grid metadata、breakpoint，以及 macOS/Windows 打包 GUI 实机证据仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/properties/nodes-counteraxisalignitems/)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450513-Create-layout-guides)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/properties/nodes-primaryaxisalignitems/)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutpositioning/)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/properties/nodes-counteraxisaligncontent/)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout)
- 专业参照：[官方说明](docs/adr/0153-figma-wrap-counter-axis-distribution.md)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutgrow/)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutalign/)
- 专业参照：[官方说明](docs/adr/0154-figma-wrap-fill-children.md)

## 设计系统

### 组件、实例与 Variants — 降级可用

创建主组件、实例、嵌套实例、override、组件属性、Slot 与 Variant Set。

- ID：`components.instances-variants`
- 实现方：DesignDocument 1.39.0 + @opendesign/component-service contract v6 + @opendesign/library-service contract v2 + isolated @opendesign/figma-interop
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=available
- 证据：自动化 16 项；实机 0 项
- 限制：已实现同一 Design File 内的 Main、链接/嵌套 Instance、Figma-compatible properties、Component Set、Variant、Slot、override、投影、持久化、autosave 和 history。同 Project 的 Design File 可发布不可变 Component/Variant/Shared Style/Variable release，由消费文件显式启用、放置链接 imported Instance、应用 imported Style/Variable、审阅更新、禁用且不破坏现有引用，并通过同一 Runtime 保存结果。Canvas、Layers、Inspector 与键盘导航共享唯一 Runtime selection；派生层只使用 session-only Instance 与稳定 source path，不安全的派生 transform 和危险命令失败封闭。Slot-in-Slot 按 Figma 公开 composition model 永久失败封闭；Workspace/远端 Library、发布权限、私有 .fig 解码、Plugin/REST 导入导出、完整派生直接操作和 macOS/Windows 打包 GUI 实机证据仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/38231200344599-Use-slots-to-build-flexible-components-in-Figma)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/SlotNode/)

### Variables、Collections 与 Modes — 降级可用

定义类型化 variable、collection、mode、alias、scope、binding 和确定性模式切换。

- ID：`variables.collections-modes`
- 实现方：DesignDocument 1.39.0 + @opendesign/variable-service contract v1 + @opendesign/library-service contract v2 + isolated @opendesign/figma-interop
- 表面：contract=available；runtime=degraded；human=degraded；agent=degraded；render=degraded；export=degraded
- 证据：自动化 16 项；实机 0 项
- 限制：Variables 已支持 BOOLEAN 可见性、FLOAT 不透明度、STRING 文本内容和 COLOR SolidPaint 颜色绑定，并可在 Shared Style 投影后应用节点 paint binding。同 Project Library 支持 Variable-only release 与隐藏 alias 依赖；消费文件启用后可搜索 Local/Library 来源，并以一笔事务导入 Collection、alias closure、Variable 和 binding。Timing/Easing 绑定、更多节点/Paint/Style 字段、渐变/效果、组件属性绑定、原型变量、扩展集合、Workspace/远端 Library、DTCG/REST/Plugin 导入导出及 macOS/Windows 打包 GUI 证据仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables)
- 专业参照：[官方说明](https://developers.figma.com/docs/rest-api/variables/)

### 共享样式 — 降级可用

创建并管理本地 Paint、Text、Effect 与 Grid 样式，并在同一 Project 的多个 Design File 之间发布和消费。

- ID：`styles.shared-local`
- 实现方：DesignDocument 1.39.0 + @opendesign/style-service contract v2 + @opendesign/library-service contract v2 + isolated @opendesign/figma-interop
- 表面：contract=available；runtime=degraded；human=degraded；agent=degraded；render=degraded；export=degraded
- 证据：自动化 14 项；实机 0 项
- 限制：已实现 Paint、Text、Effect、Grid registry、按类型稳定顺序、Figma-shaped 节点引用、解绑/删除/直接编辑时 fallback 保真、Component → Style → Variable 投影、Local Styles UI、Inspector picker、Agent typed 操作、Leafer/SVG/位图、持久化、history 与有界的 Figma 公共 interop。同 Project Library release 可发布可见 Styles 与 Component 所需隐藏依赖；消费文件显式启用 Library、搜索 Local/Library Styles、以单事务导入 source 并建立引用、审阅更新，禁用时保留现有引用。Workspace/远端 Library、发布权限、Style suggestions、完整 Figma payload、私有 .fig 解码、Plugin/REST 双向导入导出及 macOS/Windows 打包 GUI 证据仍未完成。
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/BaseStyle/)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/properties/nodes-fillstyleid/)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360038746534-Create-color-text-effect-and-layout-guide-styles)

## 交付

### 可编辑 SVG 交换 — 降级可用

把受支持的 SVG 结构、受控可编辑 Text、Frame 裁剪、蒙版与基础滤镜效果导入为可编辑 OpenDesign 图层，并以显式保真报告导出同一受支持语义和已解析 Boolean 结果。

- ID：`delivery.svg-interchange`
- 实现方：@opendesign/import-export-service SVG v1 + EditorRuntime planners + cancellable Renderer worker + Main path-free file bridge + run-scoped Agent import/export hosts + PathKit geometry
- 表面：contract=available；runtime=available；human=degraded；agent=degraded；render=degraded；export=degraded
- 证据：自动化 21 项；实机 0 项
- 限制：文件菜单与属性检查器可把 SVG 导入冻结的 Page/Frame/Group 目标，并通过可取消 Renderer worker 导出冻结的显式选区根。Agent 只能把当前 Run 内容寻址的 SVG 句柄导入检查所得目标的明确局部坐标，并通过同一 worker 导出稳定 Page/root ID。Main 会校验授权与 Renderer 结果；模型既不接收 SVG 源码，也不接收本地路径。macOS/Windows 打包产品 smoke 仍待完成。
- 限制：当前子集覆盖 Frame/Group、Rectangle、Ellipse、带受控本地端点 marker 的有向 Line/Arrow、Path/Vector、以标准 text/tspan 输出的受控 OpenDesign Text、transform、纯色与线性/径向渐变、居中描边、圆角 Frame clipsContent、有序 alpha/luminance/outline/clipping 同级蒙版段、最多八个普通零 spread 投影和一层 layer blur；普通外部 line 会导入为可编辑 Line，受支持的本地 userSpaceOnUse mask/clipPath 引用会导入为可编辑同级蒙版组。字体不会嵌入，精确 shaping、自动换行、justify、普通第三方 Text 导入、可选文字轮廓、图片、任意外部 marker 定义、root-level 或 mask+clip 组合、objectBoundingBox clipPath、内阴影/背景效果、光晕、spread/blend、stylesheet、角度渐变、多 paint 标准保真、复杂 filter graph 与内外描边保真仍不可用或明确降级。
- 限制：标准 SVG 不能保留 OpenDesign Boolean operands；导出使用可丢弃 resolved path 并报告 boolean-flattened，重新导入为可编辑 Vector，不伪造已丢失的源层。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040028034-Add-images-and-videos-to-designs)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/13402894554519-Export-formats-and-settings)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360041488473-Apply-effects-to-layers)
- 专业参照：[官方说明](https://www.w3.org/TR/filter-effects-1/)

### 专业静态导出 — 降级可用

按倍率和透明背景设置，把选中图层、Frame 或 Slice 导出为 PNG、JPEG、WebP、SVG 或 PDF。

- ID：`export.static-formats`
- 实现方：DesignDocument 1.28.0 Slice/Export Settings + OpenDesign Raster Export v1 + leafer-editor 2.2.9 + Main RasterFileService; SVG v1 interchange service
- 表面：contract=degraded；runtime=degraded；human=degraded；agent=degraded；render=degraded；export=degraded
- 证据：自动化 14 项；实机 0 项
- 限制：节点可持久保存带后缀的有序 Figma-shaped 导出配置。人工与 Agent 事务可创建真实 Slice 并设置配置；Slice 位图交付通过同一 Leafer 导出器裁切周围场景内容。画布截图和 Slice 虚线 overlay 仍是非交付投影。
- 限制：批量目录导出、整页导出、PDF、Display P3/ICC、Slice SVG 裁切、SVG 文字转轮廓及绝对/重叠内容边界均明确不支持；WEBP 是 OpenDesign 扩展，不冒充 Figma 标准格式。
- 限制：macOS/Windows 共享路径自动化已完成；两平台打包产品的保存、覆盖、取消、透明与尺寸实测仍待完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/13402894554519-Export-formats-and-settings)
