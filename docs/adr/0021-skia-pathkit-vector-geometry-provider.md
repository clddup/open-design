# ADR-0021：固定 Skia PathKit 作为矢量几何计算 provider

- 状态：已接受（provider 基础完成，产品链路尚未完成）
- 日期：2026-08-11
- 补充：ADR-0003、ADR-0009、ADR-0011、ADR-0012
- 固定依赖：`pathkit-wasm 1.0.0`

## 背景

OpenDesign `DesignDocument 1.3.0` 已拥有正式 Path/Vector SVG path 数据，Leafer 也能稳定投影曲线路径、填充、描边、效果和 mask。但专业 Logo、图标和插画还需要曲线布尔、轮廓描边、几何归一化，以及后续 Pen/节点编辑和 SVG 往返。继续在 React、Agent prompt 或 Leafer adapter 中手写 Bézier/PathOps 会形成重复算法，并在自交、相切、孔洞、fill rule 和浮点边界上产生不可维护的差异。

Figma 的产品语义提供了行为参考，而不是实现依赖：Pen 与 vector edit mode 编辑点和 Bézier 手柄；union、subtract、intersect、exclude 默认形成保留源图层的非破坏 boolean group；flatten/outline 是显式破坏性命令。OpenDesign 不能把一次 Path 字符串合并冒充完整的 Figma 式 vector network 或 boolean group。

## 调研

### Paper.js 0.12.18

Paper.js 使用 MIT License，提供 Path/CompoundPath、曲线布尔、intersections、flatten、hit test 和 SVG 导入导出。它同时拥有 Project、Layer、Item 和渲染场景模型，解包约 12.3 MB。即使只短暂使用，也容易把 Paper 私有 Item/Project 误当成第二份编辑状态；因此不选为当前低层 provider。

### CanvasKit 0.41.1

CanvasKit 使用 BSD-3-Clause，持续维护并覆盖完整 Skia 绘制、文字和图片能力，但 npm 解包约 25.5 MB。标准 CanvasKit 构建的 PathOps 历史上曾被移除并要求自定义构建。OpenDesign 已有 Leafer 生产渲染后端，不为路径运算并行引入第二套完整渲染栈。

### Skia PathKit 1.0.0

`pathkit-wasm` 是 Google Skia 独立发布的 PathOps WASM 包，使用 BSD-3-Clause，npm 解包约 380 KB、WASM 约 324 KB。它支持 SVG/cubic path、union/difference/intersect/xor、simplify、stroke outline、fill rule 和 tight bounds，没有文档、图层、选择、历史或渲染场景所有权。这个职责形状与 OpenDesign 的纯 Geometry provider 边界一致。

## 决策

固定 `pathkit-wasm 1.0.0`，只通过 `@opendesign/geometry-service/vector-path` 子入口暴露 OpenDesign-owned `VectorGeometryProvider`。公共输入输出只包含普通 path 字符串、fill rule、操作枚举、stroke 参数、bounds、provider identity 和结构化失败；PathKit module、Path 对象、enum、WASM 指针和私有命令不进入 Design Contracts、EditorRuntime、Renderer 状态、Agent schema 或持久化文档。

Provider 初始化必须显式提供浏览器 `locateFile` 或已授权宿主读取的 `wasmBinary`。geometry-service 根入口继续只加载轻量排列契约；未进入矢量工作流时，Renderer/Main/Agent 基础 bundle 不得包含 PathKit loader 或 WASM。后续 Pen/Boolean UI 使用动态子入口和受控 asset URL 加载，不允许 Renderer 获得任意文件系统能力。

每次操作创建短生命周期 PathKit path，并在所有成功、失败和提前返回路径中调用 `delete()`。服务限制单路径、总字符数、输入数量、stroke width 和 miter limit，拒绝非有限参数与非 SVG path 字符。空 intersection 是合法的 `empty` 结果，不伪装为 parser failure。

`combine()` 的输入顺序定义为从底层到顶层：subtract 使用第一个路径作为基底并依次减去其余路径；union/intersect/exclude 依次归并。坐标统一、层级、外观继承、非破坏 boolean group、空结果产品行为和事务仍由后续 OpenDesign planner 决定，不能泄漏给 PathKit。

## 当前完成范围

当前只完成 provider 选型与实际 WASM contract：

- cubic union、subtract、intersect、exclude；
- compound/hole 与 honest empty result；
- self-intersection simplify；
- open stroke 到闭合 outline；
- tight bounds、fill rule、确定性字符串结果；
- 非法 path、非有限 stroke 和预算限制；
- 独立子入口证明基础桌面 bundle 不增长。

这不等于 Pen、节点编辑或 boolean operations 已可用。capability manifest 中相关能力继续保持 `unavailable`，直到版本化 vector-network/boolean-group schema、迁移、EditorRuntime planner、人工 UI、Agent tool、Leafer 投影、保存重开、undo/redo、SVG 往返和双平台产品证据全部完成。

## 后续门禁

1. 在 macOS/Windows 原生 CI 对同一 PathOps corpus 校验结构结果、耗时、峰值内存和 WASM 加载。
2. 设计 OpenDesign-owned 多轮廓/vector-network 与非破坏 boolean-group schema，不采用 PathKit 私有表示。
3. 先实现 EditorRuntime boolean planner 和单事务 undo/redo，再开放人工命令与 Agent tool。
4. Pen/vector edit mode 另行实现点、边、手柄、开放/闭合和 hit testing；PathKit 只提供几何计算，不接管交互状态。
5. 完成 flatten、outline stroke 与 SVG import/export 往返后，使用 `OD-PENGUIN-01` 和 `OD-BRAND-01` 做结构与像素验收。

## 参考

- [Figma Vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- [Figma Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- [Figma Boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [Skia PathKit](https://skia.org/docs/user/modules/pathkit/)
- [Paper.js PathItem](https://paperjs.org/reference/pathitem/)
