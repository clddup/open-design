# ADR-0022：版本化非破坏 Boolean Group 语义

- 状态：已接受（contract/runtime 完成，派生渲染与产品入口待完成）
- 日期：2026-08-11
- 补充：ADR-0003、ADR-0009、ADR-0012、ADR-0015、ADR-0021
- 文档协议：`DesignDocument 1.4.0`

## 背景

PathKit 只解决短生命周期 PathOps，不定义源图层、外观继承、层级、编辑状态、持久化或撤销。若把一次 `combine()` 的 path 字符串直接替换源图层，虽然画面可能暂时正确，却会丢失专业设计平台最关键的非破坏编辑能力，并让 provider 输出成为第二份难以失效的文档事实。

Figma 的公开产品语义作为行为参考：Boolean operation 把多个图层组成一个共享属性的 Boolean Group；union、subtract、intersect、exclude 均保留可选择和修改的源图层。Union、Intersect 与 Exclude 初始使用图层层级顶部对象的 fill、stroke 和 effects，Subtract 使用底部对象；组内单层继续允许修改尺寸、位置、旋转和圆角，但 fill、stroke、effects 与 opacity 由组统一控制。当前 Figma 还使用源层的 fill 与 stroke 共同计算结果几何。Figma API 将 `BOOLEAN_OPERATION` 建模为拥有 vector 外观、children 与 `booleanOperation` 的独立节点。

## 决策

`DesignDocument 1.4.0` 新增 OpenDesign-owned `boolean` 节点，而不是扩展普通 Group 或持久化 PathKit 对象。Boolean 节点包含：

- `operation`: `union | subtract | intersect | exclude`；
- 至少两个有序 operand children；当前协议允许 Rectangle、Ellipse、Text、Path、Vector 与嵌套 Boolean，Frame、Group、Image 和 Instance 不可作为 operand；
- 统一的 fills、strokes、stroke 属性和 fill rule；
- 通用 transform、size、opacity、blend、effects、visibility、lock 与 extensions。

源层保留原始几何和外观。正常 Boolean 模式下，组的外观用于最终结果，组内源层的 fill、stroke、effects 与 opacity 不能单独修改；几何、transform、visibility、lock 和名称仍可编辑。解组删除 Boolean 外观并恢复源层各自保存的外观。排序是语义输入：children 从底到顶；Subtract 以第一个 operand 为基底，其余依序相减。

创建 planner 只接受同 Page、同 parent、未锁定且当前可确定性转路径的 Rectangle、Ellipse、Path、Vector 或嵌套 Boolean。Text 已进入持久化语义，但在 Text/Font service 能提供确定性 glyph outline 前，人工与 Agent 创建 planner 明确拒绝 Text，不用系统字体猜测轮廓。带 mask 的 operand 当前也拒绝，以免静默改变画面。

创建、operation 切换和解组均生成普通 `DesignOperation[]`，由唯一 `EditorRuntime.apply(DesignTransaction)` 原子应用。创建时 Union/Intersect/Exclude 复制顶层 operand 外观，Subtract 复制底层 operand 外观；之后 operation 切换不重置用户已修改的组外观。planner 保持源层世界 transform、兄弟顺序和单次 revision，保存重开、undo/redo、锁定与 stale `baseRevision` 使用现有 Runtime 语义。

PathKit 的派生结果不进入 `DesignDocument`。后续 resolver 根据当前 revision、operand 顺序、geometry、fill/stroke 和 transform 递归计算短生命周期 result path，并交给 Leafer 可丢弃投影。当前 Leafer 只建立结构 Boolean Group、隐藏正常模式下的源 operand 并报告明确 warning；在 result projection 完成前，Human、Agent、Render 与 Export capability 均保持 `unavailable`，不绘制逐层叠加的错误 fallback。

## 迁移

读取 `1.3.0` 文档时只把 `schemaVersion` 确定性升级为 `1.4.0`，不发明 Boolean 节点或派生几何。`1.0.0`、`1.1.0`、`1.2.0` 继续按既有 appearance、Path 与 Image placement 顺序迁移到最新协议。未知版本继续拒绝。

## 当前证据

- contract 校验 operation、统一外观与无派生 path 的持久化形状；
- Runtime 测试覆盖层级顺序、顶/底外观继承、源层世界 transform、几何可编辑与单层外观拒绝；
- 保存重开、undo/redo、operation 切换、解组、锁定、mask、非法 operation 和 stale revision；
- 图层树使用独立 Boolean 图标和可折叠 children；属性面板只读展示 operation，尺寸字段在派生 bounds 模式下禁用；
- Leafer 在派生 geometry 未接入时隐藏 operands 并产生 `unsupported-node` warning。

## 后续门禁

1. 实现 Rectangle/Ellipse/Path/Vector/嵌套 Boolean 到统一 PathKit 输入的递归 resolver，包括 fill+stroke geometry、transform 与空结果。
2. 使用受控 WASM asset 动态初始化；基础桌面 bundle 继续不包含 PathKit，provider 生命周期可取消并释放。
3. Leafer 为 Boolean Group 投影独立 result Path，同时保留源节点 ID、选择和 edit mode，不建立第二份可写状态。
4. 人工菜单、工具栏和 macOS/Windows 快捷键与 Agent typed tool 复用同一 planner。
5. 完成 SVG 往返、flatten、outline stroke、像素基线和双平台产品 smoke 后再提升 capability 状态。

## 参考

- [Figma Boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [Figma REST API node types](https://developers.figma.com/docs/rest-api/file-node-types/#boolean_operation)
- [Skia PathKit](https://skia.org/docs/user/modules/pathkit/)
