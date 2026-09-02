# ADR-0276：Flatten 隔离像素合成与原子资产事务

## 状态

已接受。

## 背景

Figma 公开语义规定 Flatten 把所选层破坏性合并为一个 `VectorNode`；Vector region 可以继续持有 Paint，而图片在 Figma 中本身也是 Shape 的 Image Paint。公开 API 并未承诺多层 effect、opacity、blend 与 mask 会被转换为可继续逐项编辑的矢量外观，因此 OpenDesign 不能把后代合成属性错误提升到结果根、乘入每个 Paint 或直接忽略。

OpenDesign 已能精确物化普通 Geometry，并能为单根结果保留合成外壳。剩余问题是同一选择内部的绘制顺序、透明度、普通 effect 和 mask 必须先经过真实渲染器合成，同时不能让异步像素生成绕过 revision、history 或唯一 `EditorRuntime`。

## 决策

1. 统一 Flatten 入口先尝试既有 editable Vector materialization；只有选择确实包含多根或后代 compositing 时才进入像素路径。不存在 compositing 的 Geometry、Text outline 或拓扑失败不得被位图 fallback 掩盖。
2. 像素路径使用冻结的 `DesignDocument + revision + Page` 建立一次性 Leafer 投影，并把同父级根按真实 sibling 顺序克隆到隔离 wrapper。富文本派生 fragments 与原 Text proxy 作为一个根级复合层进入相同顺序，不读取 live selection、viewport、reveal 或编辑态。
3. 单根选择先在临时投影中中和根级 opacity/effect/blend/mask，只烘焙后代合成；结果 Vector 再继承该根的合成外壳。多根选择没有共同外壳，所选根的内部合成直接进入 PNG。
4. 只接受可证明闭合的 backdrop：后代 blend/effect blend 与 background blur 必须位于所选 subtree 内显式 `normal` 隔离祖先之下；多根根级 blend/background blur 必须连同其之前的全部 sibling backdrop 一起选择。未选 backdrop、没有包含完整 sibling 作用域的根级 mask，以及单根无法由图片 alpha 保真的 outline/clipping geometry mask 明确失败。
5. 合成结果使用透明 PNG，默认每个 document pixel 输出 2 个像素；若现有导出资源边界要求降采样到 1x 以下、编码字节超过统一 Raster Export 上限，或所选子树出现缺图、几何、组件、样式、变量、富文本布局等 fidelity warning，则失败，不静默降低质量或永久烘焙占位图。输出尺寸规划与固定 Leafer 版本的整数画布规则保持一致。PNG 作为新的本地 `DesignAsset`，由一个矩形 Vector Network 的 region-local Image Paint 消费。
6. `put_asset`、删除全部源根和插入结果 Vector 属于同一个 `DesignTransaction`。异步导出完成后仍使用开始时的 exact revision；期间文档变化返回 stale failure，PNG 不会成为孤立资产，也不会覆盖新内容。
7. 人工快捷键和 Agent 既有 `flatten` action 共用同一个 Renderer orchestration、EditorRuntime planner、结果语义和一次 undo；不增加 Agent 工具、文档字段、产品版本、内容 hash 或独立可写状态。
8. 固定 Leafer 2.2.9 的 `backgroundBlur` provider 虽为空实现，但 `@opendesign/leafer-engine` 在唯一 `UI.__draw` 适配边界补齐真实 backdrop effect：普通绘制读取当前 canvas，Leafer 已建立隔离 surface 时读取其 `originCanvas`；先复制已绘制 backdrop、按当前 world scale 应用 Chromium blur，再用真实节点 path 裁剪，最后由原绘制链叠加 fill/stroke/children。生产画布、exact-revision Capture/Export 与 Flatten 继续共用同一 Leafer 投影，不增加 DOM `backdrop-filter`、第二渲染器或 Flatten 私有算法。

## 影响

- 单根后代 opacity、普通 effect 与内部 mask，以及完整多根 opacity/effect/mask stack，可以生成一个视觉一致、可移动缩放、可保存重开的 image-filled Vector。
- 结果仍是一个 Vector 层，但被烘焙的内部像素不再逐层可编辑；这是破坏性 Flatten 的明确结果，不伪装成可逆层结构。
- 显式 `normal` 祖先内的后代 blend/effect blend/background blur，以及包含完整 sibling backdrop 前缀的多根 blend/background blur，可以烘焙；依赖未选 backdrop 的合成仍明确失败。
- Chromium 中固定 Leafer 2.2.9 的实像素探针确认：红色 backdrop 与蓝色 `multiply` 输出 `[0,0,0,255]`；外部绿色 backdrop 上的 `normal` 隔离蓝色子层，与脱离外部 backdrop 后的选择导出均输出 `[0,0,255,255]`。这证明当前闭包判定与隔离导出一致，但不替代真实 Figma baseline。
- Vite 8/Rolldown 构建后的 Chromium 实像素探针进一步确认：黑白分区 backdrop 上半透明红色圆角层的 blur 只进入真实 rounded path，圆角外像素保持 `[0,0,0,255]`；模糊区域左右采样分别为 `[157,29,29,255]` 与 `[227,99,99,255]`，后绘制 sibling 保持 `[0,255,0,255]`；同一场景的 live canvas 与 PNG Export 六个采样点逐项一致。这证明生产绘制顺序、path mask 与 Export 共用实现，但不替代真实 Figma baseline。
- 真实 Figma 像素 baseline 和 macOS/Windows 打包产品交互证据仍是后续缺口，因此总体 capability 继续为 `degraded`。

## 公开语义参照

- [Figma Plugin API：flatten](https://developers.figma.com/docs/plugins/api/properties/figma-flatten/)
- [Figma：Flatten layers](https://help.figma.com/hc/en-us/articles/30101373312279-Flatten-layers)
- [Figma Plugin API：VectorNetwork](https://developers.figma.com/docs/plugins/api/VectorNetwork/)
- [Figma Plugin API：Image](https://developers.figma.com/docs/plugins/api/Image/)
- [Figma Plugin API：BlendMode](https://developers.figma.com/docs/plugins/api/BlendMode/)
- [Figma Plugin API：isMask](https://developers.figma.com/docs/plugins/api/properties/nodes-ismask/)
