<!-- Generated from packages/design-capabilities/src/manifest.json. Do not edit by hand. -->

# OpenDesign 专业设计能力

能力清单版本：`1` · 更新日期：2026-08-10 · 文档协议：`1.2.0` · 画布基线：`leafer-editor@2.2.9`

当前状态：可用 0 项，降级可用 9 项，不可用 8 项。只有必需表面全部可用，并同时具备自动化与实机证据时，能力才允许标记为“可用”。

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
- 实现方：DesignDocument 1.2.0 + EditorRuntime
- 表面：contract=available；runtime=available；human=degraded；agent=available；render=available；export=unavailable
- 证据：自动化 7 项；实机 0 项
- 限制：画布直接操作时的自动归属仍未补齐；图层面板中的显式跨容器重挂载目前以指针拖放为主。
- 限制：当 Group 级可见性、不透明度、混合、效果或蒙版无法在解组后保持视觉一致时，解组会明确拒绝。

### 精确排列 — 降级可用

通过人工 UI 与 Agent 共用的 planner 对齐多层对象、固定两端均分横向或纵向间隙，并设置正数、零或负数的一维精确间距。

- ID：`transform.precise-arrangement`
- 实现方：@opendesign/geometry-service contract v1 + EditorRuntime
- 表面：contract=available；runtime=available；human=available；agent=available；render=available；export=unavailable
- 证据：自动化 5 项；实机 0 项
- 限制：单层相对父级对齐、二维 Tidy up、Smart Selection 画布间距手柄、翻转/原点、吸附、参考线、标尺和像素网格取整仍未补齐。
- 限制：geometry-service 当前只提供确定性排列；尚未选择或宣称支持路径布尔、flatten、outline 或 Bézier kernel。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-dimensions-rotation-and-position)
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)

## 矢量

### SVG Path 渲染 — 降级可用

持久化并渲染可移植 SVG Path 数据及其填充、描边、渐变、效果、蒙版和混合模式。

- ID：`vector.path-rendering`
- 实现方：DesignDocument 1.2.0 + Leafer Path adapter
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
- 限制：工具栏 Pen 仍禁用；需要后续 geometry service 和正式矢量网络 schema。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)

### 布尔运算 — 不可用

非破坏性的 union、subtract、intersect 与 exclude，且源图层保持可编辑。

- ID：`vector.boolean-operations`
- 实现方：Not implemented
- 表面：contract=unavailable；runtime=unavailable；human=unavailable；agent=unavailable；render=unavailable；export=unavailable
- 证据：自动化 0 项；实机 0 项
- 限制：当前没有 boolean group schema 或 geometry kernel；手工扁平化不能冒充等价能力。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)

## 外观与合成

### 填充、效果与蒙版 — 降级可用

应用多重填充与描边、渐变、阴影、光晕、模糊、混合模式、蒙版和高级描边。

- ID：`appearance.paints-effects-masks`
- 实现方：DesignDocument 1.2.0 + PropertiesPanel + Leafer adapter
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
- 限制：图片生成需要独立全局配置；画布内直接替换、移除背景和资源管理 UI 尚未完成。

### 图片裁剪与调整 — 降级可用

非破坏性裁剪、选择焦点位置、替换来源并应用图片调整或滤镜。

- ID：`image.crop-adjustments`
- 实现方：Partial ImagePaint transform semantics
- 表面：contract=degraded；runtime=degraded；human=unavailable；agent=unavailable；render=degraded；export=unavailable
- 证据：自动化 1 项；实机 0 项
- 限制：ImagePaint 的 offset/scale/fit 不是完整的裁剪、焦点、替换或调整工作流。
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
- 实现方：DesignDocument 1.2.0 + Leafer TextEditor
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

### 专业静态导出 — 不可用

按倍率和透明背景设置，把选中图层、Frame 或 Slice 导出为 PNG、JPEG、WebP、SVG 或 PDF。

- ID：`export.static-formats`
- 实现方：Not implemented
- 表面：contract=unavailable；runtime=unavailable；human=unavailable；agent=unavailable；render=degraded；export=unavailable
- 证据：自动化 0 项；实机 0 项
- 限制：画布截图只是诊断预览，不能作为专业导出产物。
- 专业参照：[官方说明](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma)
