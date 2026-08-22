# ADR-0131：Figma-style 可组合蒙版作者工作流

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.41.0`（不变）
- 渲染后端：`leafer-editor` 2.2.9
- 关联：ADR-0014、ADR-0031、ADR-0130

## 背景

OpenDesign 从 `DesignDocument 1.4.0` 起已在通用节点保存 ordered sibling `maskMode`，Leafer 画布、capture、PNG/JPEG/WebP 与受控 SVG 子集也消费该事实。但人工入口只是 Inspector 中一个底层枚举，用户需要自行理解同级顺序与传播范围；Agent 只能拼低层 `update_properties`。这不构成专业蒙版作者工作流，也容易让一个裸蒙版意外影响容器内后续图层。

Figma 的公开行为是非破坏性的同级蒙版：任意可渲染图层可以作为 source，作用于同一容器内位于其上方的后续 siblings；Alpha 使用像素透明度，Vector 使用可见填充/描边轮廓，Luminance 使用亮度。创建命令会把所选内容放入一个限制传播范围的 mask object，蒙版和被遮内容仍可独立移动、缩放和编辑。

## 决策

### 复用一个通用文档事实

本切片不增加图片私有 mask 字段，也不升级文档协议。Rectangle、Ellipse、Line、Polygon、Star、Path、Vector、Text、Image、Frame、Slot、Group 与 Instance 继续使用节点级 `maskMode`；Boolean 的合成 Group 和无绘制内容的 Slice 在作者入口失败关闭。

产品与 Agent 边界使用 Figma 术语 `alpha / vector / luminance`。现有文档中的 `outline` 是已验证的 Leafer path-mask 存储值，作者边界把 `vector` 确定映射为 `outline`；SVG 专用的历史 `clipping` 只在受控导入/Inspector 中保留，不作为新建蒙版类型暴露给 Agent。后续 Figma 文件 adapter 可以在隔离边界做同一映射，不把第三方类型泄漏到 Runtime。

### Runtime 原子规划蒙版对象

`planCreateMaskGroup` 接受显式 Page、同父级稳定 node IDs、新 Group ID 与类型。Runtime 按当前权威 sibling 顺序选择最底层为 source，不信任请求数组顺序；一次 transaction 创建中性 Group、保持所有 child world transforms、移动所选 siblings，并设置 source 的 `maskMode`。已有嵌套 mask、锁定、混合 parent、不在 Page、不可渲染 source、重复 ID、命令上限和 stale revision 均明确拒绝。

单选普通图层时，只有存在后续 sibling 才允许直接设为 mask；单选 active source 或只含一个直接 active source 的 mask Group 时解除 mask。解除只把 source 设为 `none`，保留 Group 和所有内容，不以解组改变结构或几何。create、change type 与 remove 都各产生一笔 revision 和一个 undo entry。

### 人工与 Agent 共用语义入口

人工入口位于紧凑的图层顺序下拉菜单，并支持 Figma 快捷键：macOS `Control+Command+M`，Windows `Ctrl+Alt+M`。同一命令根据权威选区显示 Use as mask 或 Remove mask；图层树用独立 mask 图标标识 active source。Inspector 将内部 `outline` 展示为 Vector，并保留 Alpha、Luminance 与受控 SVG Clipping。

`opendesign_edit_hierarchy` 增加 `create-mask / set-mask-type / remove-mask`。所有目标必须来自 inspection 的稳定 ID；create-mask 还必须使用 Run 分配的新 Group ID。Main 把 mask source、source siblings 和新 Group 分别纳入 material target/created-node 检查，Renderer 在当前 revision preview 后通过唯一 EditorRuntime 应用，不读取 send-time 或 live selection。

### 渲染与导出边界

生产画布、exact-revision capture 与 PNG/JPEG/WebP 继续通过同一 Leafer projection 消费 sibling mask；Image source 同样投影为 pixel、grayscale 或 path mask，不生成派生文档资源。SVG 继续只往返其已声明的受控 mask graph；Image/Text source、任意组合 graph 和双平台像素基线仍返回明确 fidelity 限制，不冒充完整格式兼容。

## 后果

- 蒙版成为 Shape、Text、Image 和容器共用的通用合成能力，不与“AI 去背景”或某一图片工具绑定。
- 首次创建的结构已经限制传播范围，用户无需手动先 Group 再调整底层枚举。
- 直接单层 mask 保留 Figma 能力，但只有当前容器中存在明确后续 sibling 才可执行；新建多层工作流优先使用 contained Group。
- AI 去背景、局部擦除、图片派生 asset 谱系、复杂多源 mask graph、mask outline canvas view 与完整 Figma 文件导入导出仍是后续切片。

## 验证

- EditorRuntime 覆盖 sibling 顺序、world transform、Group containment、direct/group toggle、Vector 映射、失败关闭、undo/redo 与保存事实。
- Desktop Controller 与 App 覆盖工具栏状态、macOS 快捷键、一个 revision/undo 和解除后保留 Group。
- Agent schema 与 trusted execution 覆盖 create/change/remove、稳定 ID、revision、live selection 隔离和原子结果。
- Leafer mapping 覆盖独立 Image source 的 Luminance 投影；既有专业 fixture 与 SVG 测试继续覆盖 ordered mask runs。

## 参考

- [Figma Masks](https://help.figma.com/hc/en-us/articles/360040450253-Masks)
- [Figma Plugin API `isMask`](https://developers.figma.com/docs/plugins/api/properties/nodes-ismask/)
- [Figma Plugin API `MaskType`](https://developers.figma.com/docs/plugins/api/MaskType/)
