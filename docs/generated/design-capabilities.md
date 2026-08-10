<!-- Generated from packages/design-capabilities/src/manifest.json. Do not edit by hand. -->

# OpenDesign 专业设计能力

能力清单版本：`1` · 更新日期：2026-08-11 · 文档协议：`1.4.0` · 画布基线：`leafer-editor@2.2.9`

当前状态：可用 0 项，降级可用 11 项，不可用 7 项。只有必需表面全部可用，并同时具备自动化与实机证据时，能力才允许标记为“可用”。

## 基础工作流

### 文档生命周期 — 降级可用

打开、保存、重开并版本化原生设计文件，聊天记录不充当设计事实。

- ID：`document.lifecycle`
- 实现方：OpenDesign Workspace + EditorRuntime
- 表面：contract=available；runtime=degraded；human=degraded；agent=unavailable；render=available；export=unavailable
- 证据：自动化 3 项；实机 0 项
- 限制：Agent 工具不能创建、重命名、复制、排序、归档或删除 Project、Design File 与 Page。

### 画布导航与选择 — 降级可用

在生产 Leafer 画布中平移、缩放、命中、框选、多选并变换对象。

- ID：`canvas.navigation-selection`
- 实现方：@opendesign/leafer-engine / leafer-editor@2.2.9
- 表面：contract=available；runtime=available；human=available；agent=degraded；render=available；export=unavailable
- 证据：自动化 2 项；实机 0 项
- 限制：macOS 与 Windows 上的真实 Electron 平移、缩放、选框稳定性和大节点量性能尚未完成验收。

### 图层层级 — 降级可用

创建并检查语义化 Frame、Group、嵌套图层、可见性、锁定、兄弟图层堆叠顺序、跨容器重挂载和有序事务；人工命令与 Agent 共用同一套层级 planner。

- ID：`layers.hierarchy`
- 实现方：DesignDocument 1.4.0 + EditorRuntime
- 表面：contract=available；runtime=available；human=degraded；agent=available；render=available；export=unavailable
- 证据：自动化 7 项；实机 0 项
- 限制：画布直接操作时的自动归属仍未补齐；图层面板中的显式跨容器重挂载目前以指针拖放为主。
- 限制：当 Group 级可见性、不透明度、混合、效果或蒙版无法在解组后保持视觉一致时，解组会明确拒绝。

### 精确排列 — 降级可用

通过人工 UI 与 Agent 共用的 planner 对齐多层对象、固定两端均分横向或纵向间隙，并设置正数、零或负数的一维精确间距。

- ID：`transform.precise-arrangement`
- 实现方：@opendesign/geometry-service contract v2 + EditorRuntime
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=unavailable
- 证据：自动化 5 项；实机 0 项
- 限制：单层相对父级对齐、二维 Tidy up、Smart Selection 画布间距手柄、翻转/原点、吸附、参考线、标尺和像素网格取整仍未补齐。
- 限制：排列产品链与隔离的 PathKit 矢量 provider 保持明确分离；本能力不据此宣称任何矢量产品能力。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-dimensions-rotation-and-position)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)

## 矢量

### SVG Path 渲染 — 降级可用

持久化并渲染可移植 SVG Path 数据及其填充、描边、渐变、效果、蒙版和混合模式。

- ID：`vector.path-rendering`
- 实现方：DesignDocument 1.4.0 + Leafer Path adapter
- 表面：contract=available；runtime=available；human=unavailable；agent=available；render=available；export=unavailable
- 证据：自动化 6 项；实机 0 项
- 限制：当前支持单路径 SVG 数据，但没有 Pen、节点/手柄编辑、多轮廓矢量网络或 SVG 往返。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)

### Pen 与节点编辑 — 不可用

通过节点和贝塞尔手柄创建、编辑开放、闭合、分支与曲线矢量几何。

- ID：`vector.pen-node-editing`
- 实现方：Not implemented
- 表面：contract=unavailable；runtime=unavailable；human=unavailable；agent=unavailable；render=degraded；export=unavailable
- 证据：自动化 0 项；实机 0 项
- 限制：工具栏 Pen 仍禁用；PathKit 不提供 OpenDesign 所需的节点、边、手柄、命中测试或矢量网络交互语义。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)

### 布尔运算 — 降级可用

非破坏性的 union、subtract、intersect 与 exclude，且源图层保持可编辑。

- ID：`vector.boolean-operations`
- 实现方：DesignDocument 1.4.0 + EditorRuntime Boolean planner + recursive Skia PathKit resolver + Leafer derived projection
- 表面：contract=available；runtime=available；human=degraded；agent=available；render=available；export=unavailable
- 证据：自动化 13 项；实机 0 项
- 限制：递归 resolver 会把 Rectangle、Ellipse、Path、Vector 与嵌套 Boolean 转换为包含 fill+stroke 的 PathKit 几何，应用局部 transform、保留真实空结果，并在不持久化 provider 输出的前提下投影稳定的 Leafer synthetic Path。
- 限制：工具栏/菜单、macOS 与 Windows 快捷键、Inspector operation 控件、解组命令和 Agent hierarchy typed actions 已复用同一套经过 preview 的原子 planner。Enter、双击、图层树选择、Shift+Enter、Escape 与 Tab 已提供短生命周期的源 operand 编辑、派生结果实时预览、锁定只读状态、受控外观字段和上下文失败恢复。文字轮廓、SVG 往返、像素基线和 macOS/Windows 打包产品证据仍不可用；超过两段的 dash pattern、带 mask 的 operand 和开放路径的非居中描边会明确失败，不做静默近似。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)

## 外观与合成

### 填充、效果与蒙版 — 降级可用

应用多重填充与描边、渐变、阴影、光晕、模糊、混合模式、蒙版和高级描边。

- ID：`appearance.paints-effects-masks`
- 实现方：DesignDocument 1.4.0 + PropertiesPanel + Leafer adapter
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=unavailable
- 证据：自动化 6 项；实机 0 项
- 限制：复杂组合仍需 Electron 视觉基线，专业取色器和共享颜色样式尚未完成。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360041488473-Apply-effects-to-layers)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450253-Masks)

## 图片

### 图片导入、生成与放置 — 降级可用

读取明示图片引用、粘贴或拖放图片、生成位图素材，并把内容寻址 asset 放入画布。

- ID：`image.import-generation-placement`
- 实现方：AgentAttachmentHost + ImageGenerationHost + EditorRuntime
- 表面：contract=available；runtime=available；human=degraded；agent=available；render=available；export=unavailable
- 证据：自动化 5 项；实机 0 项
- 限制：图片生成需要独立全局配置；画布直接放置手柄、移除背景和资源管理 UI 尚未完成。

### 图片裁剪与调整 — 降级可用

非破坏性裁剪、选择焦点位置、替换来源并应用图片调整或滤镜。

- ID：`image.crop-adjustments`
- 实现方：DesignDocument 1.4.0 + OpenDesign Image service crop geometry + Leafer projection
- 表面：contract=degraded；runtime=degraded；human=degraded；agent=degraded；render=degraded；export=unavailable
- 证据：自动化 7 项；实机 0 项
- 限制：检查器与专用 Agent 工具已共用非破坏 placement 和来源替换语义，但画布直接裁剪控件、调整滤镜、导出保真及 macOS/Windows 原生交互证据仍未完成。
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

创建、渲染、变换和编辑使用单一共享字体样式与对齐方式的文字图层。

- ID：`text.single-style`
- 实现方：DesignDocument 1.4.0 + Leafer TextEditor
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=unavailable
- 证据：自动化 5 项；实机 0 项
- 限制：字体可用性、跨平台 shaping、溢出和视觉保真仍需 macOS/Windows 验收。

### 专业富文本排版 — 不可用

按文字 run 与段落设置列表、缩进、装饰、OpenType、可变字体和共享文字样式。

- ID：`text.rich-typography`
- 实现方：Not implemented
- 表面：contract=unavailable；runtime=unavailable；human=unavailable；agent=unavailable；render=degraded；export=unavailable
- 证据：自动化 0 项；实机 0 项
- 限制：需要 Text/Font service 和正式富文本 schema 后才能开放。

## 响应式布局

### Auto Layout — 不可用

通过方向、换行、padding、gap、对齐、hug、fill、fixed、min/max 和 absolute child 响应式布局 Frame。

- ID：`layout.auto-layout`
- 实现方：Not implemented
- 表面：contract=unavailable；runtime=unavailable；human=unavailable；agent=unavailable；render=unavailable；export=unavailable
- 证据：自动化 0 项；实机 0 项
- 限制：当前没有 OpenDesign 自有布局 schema 与 solver；Leafer Flow 状态不能作为文档事实。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)

## 设计系统

### 组件、实例与 Variants — 不可用

创建主组件、实例、嵌套实例、override、组件属性与 Variant Set。

- ID：`components.instances-variants`
- 实现方：Not implemented
- 表面：contract=unavailable；runtime=unavailable；human=unavailable；agent=unavailable；render=unavailable；export=unavailable
- 证据：自动化 0 项；实机 0 项
- 限制：当前 component、variant 和 instance 字段只是占位，不具备可用语义。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants)

### Variables、Collections 与 Modes — 不可用

定义类型化 variable、collection、mode、alias、scope、binding 和确定性模式切换。

- ID：`variables.collections-modes`
- 实现方：Not implemented
- 表面：contract=unavailable；runtime=unavailable；human=unavailable；agent=unavailable；render=unavailable；export=unavailable
- 证据：自动化 0 项；实机 0 项
- 限制：Token collection 字段仍是无类型占位，不能绑定到设计属性。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes)

## 交付

### 可编辑 SVG 交换 — 降级可用

把受支持的 SVG 结构导入为可编辑 OpenDesign 矢量，并以显式保真报告导出 Path、Vector、基础图形和已解析 Boolean 结果。

- ID：`delivery.svg-interchange`
- 实现方：@opendesign/import-export-service SVG v1 + EditorRuntime planners + cancellable Renderer worker + Main path-free file bridge + run-scoped Agent import/export hosts + PathKit geometry
- 表面：contract=available；runtime=available；human=degraded；agent=degraded；render=degraded；export=degraded
- 证据：自动化 21 项；实机 0 项
- 限制：文件菜单与属性检查器可把 SVG 导入冻结的 Page/Frame/Group 目标，并通过可取消 Renderer worker 导出冻结的显式选区根。Agent 只能把当前 Run 内容寻址的 SVG 句柄导入检查所得目标的明确局部坐标，并通过同一 worker 导出稳定 Page/root ID。Main 会校验授权与 Renderer 结果；模型既不接收 SVG 源码，也不接收本地路径。macOS/Windows 打包产品 smoke 仍待完成。
- 限制：当前子集覆盖 Group、Rectangle、Ellipse、Path/Vector、transform、纯色与线性/径向渐变和居中描边；文字、图片、效果、蒙版、stylesheet、角度渐变、多 paint 与内外描边保真仍不可用。
- 限制：标准 SVG 不能保留 OpenDesign Boolean operands；导出使用可丢弃 resolved path 并报告 boolean-flattened，重新导入为可编辑 Vector，不伪造已丢失的源层。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040028034-Add-images-and-videos-to-designs)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/13402894554519-Export-formats-and-settings)

### 专业静态导出 — 不可用

按倍率和透明背景设置，把选中图层、Frame 或 Slice 导出为 PNG、JPEG、WebP、SVG 或 PDF。

- ID：`export.static-formats`
- 实现方：Not implemented
- 表面：contract=unavailable；runtime=unavailable；human=unavailable；agent=unavailable；render=degraded；export=unavailable
- 证据：自动化 0 项；实机 0 项
- 限制：画布截图只是诊断预览，不能作为专业导出产物。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma)
