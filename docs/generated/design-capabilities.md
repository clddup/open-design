<!-- Generated from packages/design-capabilities/src/manifest.json. Do not edit by hand. -->

# OpenDesign 专业设计能力

能力清单版本：`1` · 更新日期：2026-08-18 · 文档协议：`1.36.0` · 画布基线：`leafer-editor@2.2.9`

当前状态：可用 0 项，降级可用 21 项，不可用 1 项。只有必需表面全部可用，并同时具备自动化与实机证据时，能力才允许标记为“可用”。

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
- 实现方：DesignDocument 1.36.0 + EditorRuntime
- 表面：contract=available；runtime=available；human=degraded；agent=available；render=available；export=unavailable
- 证据：自动化 7 项；实机 0 项
- 限制：画布直接操作时的自动归属仍未补齐；图层面板中的显式跨容器重挂载目前以指针拖放为主。
- 限制：当 Group 级可见性、不透明度、混合、效果或蒙版无法在解组后保持视觉一致时，解组会明确拒绝。

### 精确排列 — 降级可用

通过人工 UI 与 Agent 共用的 planner 对齐多层对象、固定两端均分横向或纵向间隙、设置正数/零/负数的一维精确间距，并整理行、列或不等尺寸/稀疏二维网格。

- ID：`transform.precise-arrangement`
- 实现方：@opendesign/geometry-service contract v4 + EditorRuntime
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=unavailable
- 证据：自动化 6 项；实机 0 项
- 限制：单层相对父级对齐、Smart Selection 画布间距手柄与回流编辑、翻转/原点、吸附、参考线、标尺和像素网格取整仍未补齐。
- 限制：排列产品链与隔离的 PathKit 矢量 provider 保持明确分离；本能力不据此宣称任何矢量产品能力。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-dimensions-rotation-and-position)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)

## 矢量

### 可编辑 Path、Pen 与节点编辑 — 降级可用

使用 Pen 创建可编辑三次曲线轮廓、继续调整已有节点和贝塞尔手柄，或精确保留 SVG Path 数据，并通过同一 Path 投影渲染。

- ID：`vector.path-rendering`
- 实现方：DesignDocument 1.10.0 + Geometry Service contract v13 point/path selection-delete/transform/Connect/Disconnect/Cut + EditorRuntime vector planner + Leafer Pen/point/path/Lasso/transform/Cut overlay + controlled SVG metadata v2
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 17 项；实机 0 项
- 限制：Pen 已支持点击放点、拖拽镜像三次曲线手柄、首点闭合、Enter/Escape 完成开放路径、Backspace 回退、切换工具收尾、精确 bounds 和单次可撤销事务；当前只创建单条非分叉轮廓。
- 限制：Enter 或双击可让一个或多个已选 Vector 图层进入非分支多轮廓节点编辑；每层拥有独立 trace、稳定 point/path 选区和只读状态。Q 套索可圈选完整包含的节点与 line/cubic segment；Delete 对节点执行重连，对 segment 则真实断开并确定性生成开放 runs。同一 Vector 多节点变换及既有节点/手柄、Connect/Disconnect、Open/Close/Reverse、Cut、tight bounds 与单事务手势继续可用。
- 限制：Cut 模式（X）支持节点/路径真实断点和跨多个 Vector 图层的有限 document-space 分割；闭合边界通过同侧 connector 与连续边界缝合处理穿孔和凹形多交点 component，开放 contour 按每个真实横穿交点拆成 retained/extracted 开放 runs，不补 connector、region 或隐式 Fill。point/path Lasso、segment Delete、同一 Vector Connect/Disconnect 与单 Vector 多节点变换共用稳定拓扑和原子手势。跨 Vector 统一变换框、Space 中途平移、segment Bend/per-segment appearance、嵌套/重叠 region、只切孔洞、跨层 Connect、分支网络、flatten、outline stroke、像素基线和打包交互证据仍未完成。
- 限制：受控 OpenDesign SVG metadata 只在通过 schema、拓扑且与标准渲染 path 精确匹配时保留 editable network；没有 metadata 的外部 SVG 保持为精确 path 数据，不猜测可编辑拓扑。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/pen.rs)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/path_edit.rs)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-ui/src/widgets/canvas_path_overlay.rs)

### 直线与箭头 — 降级可用

创建并直接编辑有方向的直线，独立设置起终点装饰和专业描边，并通过 SVG 保持可编辑交换。

- ID：`vector.line-arrow`
- 实现方：DesignDocument 1.10.0 + Leafer Arrow / LineEditTool + SVG controlled markers
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 8 项；实机 0 项
- 限制：当前切片支持单段可编辑直线、Shift 45 度约束、Alt 中心绘制、独立的无/线性箭头/三角/反向三角/圆点/菱形端点、端帽/连接/虚线控制和原生端点拖动；折线连接器、正交路由、吸附、标签挂接及 macOS/Windows 打包交互证据仍未完成。
- 限制：SVG 往返使用精确的本地 OpenDesign marker 定义；普通外部 line 可导入为 Line，未知、外部、缺失或被修改的 marker 会明确失败，不会被扁平化或盲目信任。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/reference/display/Line.html)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/plugin/in/arrow/)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/reference/property/editable.html)

### 规则多边形与星形 — 降级可用

创建、缩放、调整外观并交换语义化 Polygon 与 Star 节点，不将其扁平化为普通 Path。

- ID：`vector.regular-shapes`
- 实现方：DesignDocument 1.10.0 + Leafer Polygon/Star + controlled SVG regular-shape metadata
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 9 项；实机 0 项
- 限制：Polygon 支持 3–60 个顶点；Star 支持 3–60 个顶点和归一化内径。Shift 将绘制边界约束为正方形，Alt/Option 从中心绘制。Leafer cornerRadius 可渲染实时圆角图形，但 Figma 式 corner smoothing 尚未进入 OpenDesign 协议。
- 限制：零圆角 Polygon/Star 可参与确定性 Boolean geometry，并通过受控 SVG 精确往返。圆角规则图形在精确 outline 完成前会明确拒绝 Boolean 创建与 SVG 导出；普通外部 SVG polygon 继续导入为 Vector，不猜测为语义图形。
- 限制：尚未记录 macOS/Windows 打包程序的直接操作证据与真实 Leafer 像素基线。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/StarNode/)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/en/reference/display/Polygon.html)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/en/reference/display/Star.html)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/svg_import/nodes.rs)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-ui/src/svg_export.rs)

### Pen 与节点编辑 — 降级可用

通过节点和贝塞尔手柄创建、编辑开放、闭合、分支与曲线矢量几何。

- ID：`vector.pen-node-editing`
- 实现方：DesignDocument 1.10.0 Vector Network + Geometry Service contract v13 point/path selection-delete/transform/Connect/Disconnect/Cut + EditorRuntime planner + Leafer native overlays
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 10 项；实机 0 项
- 限制：Pen 当前创建单条非分支轮廓；已有节点编辑支持多 Vector collection、Open/Close/Reverse、Connect/Disconnect、point/path Lasso 与 segment Delete、单 Vector 多节点变换，以及点击/document-space Cut。跨 Vector 节点变换、segment Bend/per-segment appearance、嵌套/重叠 region、只切孔洞、分支网络、flatten、outline stroke 与打包证据仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- 专业参照：[官方说明](https://github.com/ZSeven-W/openpencil/blob/449f31dd8b7df12965f65d9da774597332fc153d/crates/op-editor-core/src/path_edit.rs)

### 布尔运算 — 降级可用

非破坏性的 union、subtract、intersect 与 exclude，且源图层保持可编辑。

- ID：`vector.boolean-operations`
- 实现方：DesignDocument 1.10.0 + EditorRuntime Boolean planner + recursive Skia PathKit resolver + Leafer derived projection
- 表面：contract=available；runtime=available；human=degraded；agent=available；render=available；export=unavailable
- 证据：自动化 13 项；实机 0 项
- 限制：递归 resolver 会把 Rectangle、Ellipse、零圆角 Polygon/Star、Path、Vector 与嵌套 Boolean 转换为包含 fill+stroke 的 PathKit 几何，应用局部 transform、保留真实空结果，并在不持久化 provider 输出的前提下投影稳定的 Leafer synthetic Path。
- 限制：工具栏/菜单、macOS 与 Windows 快捷键、Inspector operation 控件、解组命令和 Agent hierarchy typed actions 已复用同一套经过 preview 的原子 planner。Enter、双击、图层树选择、Shift+Enter、Escape 与 Tab 已提供短生命周期的源 operand 编辑、派生结果实时预览、锁定只读状态、受控外观字段和上下文失败恢复。文字轮廓、SVG 往返、像素基线和 macOS/Windows 打包产品证据仍不可用；超过两段的 dash pattern、带 mask 的 operand 和开放路径的非居中描边会明确失败，不做静默近似。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)

## 外观与合成

### 填充、效果与蒙版 — 降级可用

应用多重填充与描边、渐变、阴影、光晕、模糊、混合模式、蒙版和高级描边。

- ID：`appearance.paints-effects-masks`
- 实现方：DesignDocument 1.10.0 + PropertiesPanel + Leafer adapter + SVG filter/mask adapter
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 7 项；实机 0 项
- 限制：可编辑 SVG 边界现可保留最多八个普通零 spread 投影、一层 layer blur、效果顺序/可见性、圆角 Frame clipsContent，以及有序的 alpha/luminance/outline/clipping 同级蒙版段；内阴影、背景模糊、光晕、阴影 spread/blend、任意组合蒙版图、Electron 视觉基线、专业取色器和共享颜色样式仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360041488473-Apply-effects-to-layers)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450253-Masks)

## 图片

### 图片导入、生成与放置 — 降级可用

读取明示图片引用、粘贴或拖放图片、生成位图素材，并把内容寻址 asset 放入画布。

- ID：`image.import-generation-placement`
- 实现方：AgentAttachmentHost + ImageGenerationHost + EditorRuntime
- 表面：contract=available；runtime=available；human=degraded；agent=available；render=available；export=unavailable
- 证据：自动化 9 项；实机 0 项
- 限制：图片生成需要独立全局配置；当前文件图片资源已支持预览、搜索、使用次数、定位、画布拖放、导入、全文件替换/relink 与安全删除，但字体、跨文件 Library、来源谱系、移除背景、大列表虚拟化及 macOS/Windows 原生交互证据仍未完成。

### 图片裁剪与调整 — 降级可用

非破坏性裁剪、选择焦点位置、替换来源并应用图片调整或滤镜。

- ID：`image.crop-adjustments`
- 实现方：DesignDocument 1.10.0 + OpenDesign Image Service v2 + Leafer projection
- 表面：contract=degraded；runtime=degraded；human=degraded；agent=degraded；render=degraded；export=unavailable
- 证据：自动化 8 项；实机 0 项
- 限制：检查器与专用 Agent 工具共用非破坏 placement 和来源替换语义。画布直接裁剪已支持拖动、缩放、重置、Enter 提交、Escape 取消和 stale session 恢复；调整滤镜、完整导出保真及 macOS/Windows 原生交互证据仍未完成。
- 专业参照：[官方说明](docs/adr/0089-direct-image-crop-session.md)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040675194-Crop-an-image)

### AI 图片编辑 — 不可用

基于一张或多张源图，通过蒙版、局部重绘、扩图、背景替换、重打光或风格统一生成可追溯变体。

- ID：`image.ai-editing`
- 实现方：Not implemented
- 表面：contract=unavailable；runtime=unavailable；human=unavailable；agent=unavailable；render=unavailable；export=unavailable
- 证据：自动化 0 项；实机 0 项
- 限制：当前全局 adapter 只能生成新图；后续编辑必须创建带来源追踪的派生 asset，绝不能覆盖原始 asset。
- 专业参照：[官方说明](https://developers.openai.com/api/docs/guides/image-generation)

## 文字

### 单样式文字 — 降级可用

创建、渲染、变换和编辑固定、自动宽度或自动高度文字，使用单一共享字体样式、对齐、明确换行以及固定框溢出控制。

- ID：`text.single-style`
- 实现方：DesignDocument 1.33.0 + Text Layout Service v4 + leafer-editor@2.2.9 Text/TextEditor + controlled SVG text metadata v8
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 15 项；实机 0 项
- 限制：family/style-name/weight/slant 精确身份、运行时字体可用性、全文件精确替换、显式 Auto Size 重排及 unresolved Figma 导出失败已通过单次 revision/undo 可用；字体二进制资源、可变字体轴、精确跨平台 shaping 及 macOS/Windows 视觉验收仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/27378154668951-Adjust-text-dimensions-and-resizing)
- 专业参照：[官方说明](https://www.leaferjs.com/ui/guide/display/Text.html)

### 专业富文本排版 — 降级可用

通过唯一版本化 Runtime、真实范围 Inspector、Agent 工具、native/HarfBuzz 投影及 Figma/SVG/位图结构往返创建 Figma-compatible UTF-16 字符与段落 runs。

- ID：`text.rich-typography`
- 实现方：DesignDocument 1.33.0 + Text Paragraph Service v2 / Text List Service v1 / Text Editing Session Service v2 / Text Run Layout v4 + leafer-editor 2.2.9 + harfbuzzjs 1.4.0 + SVG metadata v8
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=available
- 证据：自动化 21 项；实机 0 项
- 限制：富文本 runs 已覆盖精确 face、字号、字距、行高、大小写、装饰、fills、可选 Text/Paint Style ID、逐段 indent/spacing，以及语义化 ordered/unordered 列表、五级缩进、list spacing、节点级 hanging marker、确定性嵌套计数、换行 hanging indent 与 LTR/RTL logical-start 投影。Text Editing Session v2 会暂存非空范围修改和折叠光标输入样式，只在真实 UTF-16 输入后物化样式；可丢弃 edit-DOM marker 不进入 content/history，Inspector 焦点与 IME DOM identity 保持稳定，每次编辑 session 只提交一条 commit_text_edit Runtime transaction/reflow/revision。输入前缀列表与结构键继续可用。custom list marker、高级 decoration 几何、OpenType 控件、可变字体轴、本地 Style 修改向绑定 range 的实时传播、字体随文件打包/授权迁移、路径文字、更新 bidi 数据、原生 IME/undo smoke 和 macOS/Windows 打包视觉证据仍不可用。
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/TextNode/)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/TextStyle/)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/TextListOptions/)
- 专业参照：[官方说明](docs/adr/0084-figma-compatible-text-lists.md)
- 专业参照：[官方说明](docs/adr/0085-figma-compatible-text-list-editing-session.md)
- 专业参照：[官方说明](docs/adr/0087-figma-compatible-caret-typing-style.md)

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

响应式布局 Frame，并添加不改变 child 几何且不导出的 Uniform、Columns 或 Rows Layout Guide。

- ID：`layout.auto-layout`
- 实现方：DesignDocument 1.35.0 Auto Layout Grid v2 + Layout Guide + @opendesign/layout-service Auto Layout contract v8 + EditorRuntime
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=degraded
- 证据：自动化 18 项；实机 0 项
- 限制：Auto Layout Grid v2 已支持显式 Fixed/Fill/Hug 行列轨道、row-major flow 自动增减 Fill 行、独立双 gap、Manual 或 row-major 排布、child cell/span/alignment、跨 span 的行列重排与完整 movement map、Runtime 确定回流、Inspector、Agent 与 Figma 公共 Plugin API 投影。Uniform、Columns 与 Rows Layout Guide 仍是不参与布局的视觉辅助。Fill 以外的自动行模板、自动列、dense/column flow、Guide style/变量、吸附、交叉轴 Auto gap、垂直 wrap、Wrap+Fill、baseline、旋转 absolute child、画布 cell 拖拽手柄、SVG Grid metadata，以及 macOS/Windows 打包 GUI 实机证据仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450513-Create-layout-guides)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/properties/nodes-primaryaxisalignitems/)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutpositioning/)

## 设计系统

### 组件、实例与 Variants — 降级可用

创建主组件、实例、嵌套实例、override、组件属性、Slot 与 Variant Set。

- ID：`components.instances-variants`
- 实现方：DesignDocument 1.36.0 + @opendesign/component-service contract v6 + isolated @opendesign/figma-interop
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=available
- 证据：自动化 14 项；实机 0 项
- 限制：已实现同一 Design File 内的 Main、链接/嵌套 Instance、兼容 Figma 公共语义且具有普通属性显式顺序的 Boolean/Text/Instance-swap/SLOT 属性、真实 Component Set Frame、唯一 VARIANT 解析、Set 生命周期、二维矩阵与画布重排、稳定 sourcePath 高级 override、Slot settings 与指导性限制、Component/Component Set preferred values、Clear/Reset/Detach 物化、Inspector、Agent typed actions 与 inspection、持久 override 图层、不可导出的空 Slot 画布指示、Canvas/SVG/位图投影、迁移、持久化、autosave 和 history。Canvas、Layers、Inspector 与键盘导航共享唯一 Runtime selection；派生层只使用 session-only Instance 与稳定 source path，持久 nested Instance 拥有自身派生 child，受支持 override 继续进入事务，直接派生 transform 和危险命令失败封闭。Slot-in-Slot 按 Figma 公开 composition model 永久失败封闭；跨文件 Library、私有 .fig 解码、Plugin/REST 导入导出、完整派生直接操作和 macOS/Windows 打包 GUI 实机证据仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/38231200344599-Use-slots-to-build-flexible-components-in-Figma)
- 专业参照：[官方说明](https://developers.figma.com/docs/plugins/api/SlotNode/)

### Variables、Collections 与 Modes — 降级可用

定义类型化 variable、collection、mode、alias、scope、binding 和确定性模式切换。

- ID：`variables.collections-modes`
- 实现方：DesignDocument 1.26.0 + @opendesign/variable-service contract v1 + isolated @opendesign/figma-interop
- 表面：contract=available；runtime=degraded；human=degraded；agent=degraded；render=degraded；export=degraded
- 证据：自动化 11 项；实机 0 项
- 限制：Variables v1 已支持 BOOLEAN 可见性、FLOAT 不透明度、STRING 文本内容和 COLOR SolidPaint 颜色绑定，并可在 Shared Style 投影后应用节点 paint binding。Timing/Easing 绑定、更多节点/Paint/Style 字段、渐变/效果、组件属性绑定、原型变量、扩展集合、跨文件 Library、DTCG/REST/Plugin 导入导出及 macOS/Windows 打包 GUI 证据仍未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables)
- 专业参照：[官方说明](https://developers.figma.com/docs/rest-api/variables/)

### 本地共享样式 — 降级可用

创建、应用、更新、排序、解绑和删除可复用的 Paint、Text、Effect 与 Grid 样式。

- ID：`styles.shared-local`
- 实现方：DesignDocument 1.27.0 + @opendesign/style-service contract v1 + isolated @opendesign/figma-interop
- 表面：contract=available；runtime=degraded；human=degraded；agent=degraded；render=degraded；export=degraded
- 证据：自动化 10 项；实机 0 项
- 限制：Shared Styles v1 已支持同一 Design File 内的 Paint、Text、Effect、Grid registry、按类型稳定顺序、Figma-shaped 节点引用、解绑/删除/直接编辑时 fallback 保真、Component → Style → Variable 投影、Local Styles UI、Inspector picker、Agent typed 操作、Leafer/SVG/位图、持久化、history 与有界的 Figma 公共 interop。远程 Library、发布/导入权限、Style suggestions、完整 Figma Text/Effect/Paint/Grid payload、私有 .fig 解码、Plugin/REST 双向导入导出及 macOS/Windows 打包 GUI 证据仍未完成。
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
