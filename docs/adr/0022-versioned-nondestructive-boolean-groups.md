# ADR-0022：版本化非破坏 Boolean Group 语义

- 状态：已接受（contract/runtime/派生渲染与基础产品入口完成，完整专业工作流待完成）
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

PathKit 的派生结果不进入 `DesignDocument`。`boolean-resolver` 根据 operand 顺序、geometry、fill/stroke、visibility 与 transform 递归计算短生命周期 result path，并以精确 fingerprint 缓存；无关 revision 复用，源几何变化只失效对应 Boolean 及祖先。Leafer 为每个成功结果创建稳定 `__opendesign_boolean_result__:<id>` Path，源 operand 保持 identity 但在正常模式隐藏，synthetic hit 映射回原 Boolean ID。空结果保持不可见空 Path，失败返回明确 fidelity warning，不绘制逐层叠加 fallback。

源层编辑 scope 是由当前选区确定性推导的短生命周期交互状态，不写入文档、revision、history 或第二份场景。Enter、双击或图层树选择进入 direct operand，Shift+Enter、Escape 或 Done 返回 Boolean，Tab 在同级 operand 间移动。scope 中权威 synthetic result 保持可见，operand 只增加不可持久化的选择色轮廓；直接操作继续写回源节点 transform/size。拖拽中的 Leafer 状态按 animation frame 生成仅替换受影响节点的浅层临时文档，并调用同一 resolver 更新 synthetic preview；松手后仍只通过一个正式 `DesignTransaction` 提交。组锁定时 scope 保持可检查，但 adapter 根据继承锁阻止变换。Inspector 禁用 opacity、blend、mask、fill、stroke 与 effects，并继续开放名称、可见性、锁定、transform、size 和适用的 corner radius。

浏览器 PathKit 通过受控动态子入口按需加载。加载期间画布和结构投影保持响应；成功后在同一文档 revision 上只 reconcile Boolean、synthetic result 与当前 edit scope 的 operands。provider 加载失败和不支持几何通过上下文 warning 暴露，允许进入源层或重试 provider，不再把整个 Canvas 标为不可用；dispose 后忽略迟到 provider。WASM 路径由 Vite 受控 asset URL 提供，不进入 `DesignDocument` 或 Renderer 文件权限。

## 迁移

读取 `1.3.0` 文档时只把 `schemaVersion` 确定性升级为 `1.4.0`，不发明 Boolean 节点或派生几何。`1.0.0`、`1.1.0`、`1.2.0` 继续按既有 appearance、Path 与 Image placement 顺序迁移到最新协议。未知版本继续拒绝。

## 当前证据

- contract 校验 operation、统一外观与无派生 path 的持久化形状；
- Runtime 测试覆盖层级顺序、顶/底外观继承、源层世界 transform、几何可编辑与单层外观拒绝；
- 保存重开、undo/redo、operation 切换、解组、锁定、mask、非法 operation 和 stale revision；
- 图层树使用独立 Boolean 图标和可折叠 children；工具栏菜单、Inspector operation 控件和解组入口复用同一 planner，尺寸字段在派生 bounds 模式下禁用；
- macOS `⌥⇧U/S/I/E` 与 Windows `Alt+Shift+U/S/I/E` 创建或切换四类 operation，快捷键不劫持文本输入；
- `opendesign_edit_hierarchy` 通过 `create-boolean`、`set-boolean-operation`、`ungroup-boolean` 对显式稳定 ID 执行 preview 和单次原子 apply，不读取发送时或实时选区，也不允许模型提交派生 path；
- 源层 edit scope 覆盖 Enter/双击/图层树进入、Shift+Enter/Escape/Done 退出、Tab sibling 导航、受控外观 Inspector、最小二 operand 删除保护和锁定只读状态；
- adapter 测试证明 edit scope 只更新 operand outline、不刷新无关节点，拖拽逐帧更新 synthetic result、松手只提交源 operand，provider 失败可见且可重试；
- 真实 PathKit 测试覆盖 Rectangle、Ellipse、Path/Vector 原始局部坐标、嵌套 Boolean、fill+stroke、inside/center/outside stroke、精确两段 dash、transform、空结果与不支持样式；
- resolver cache 测试证明颜色或无关节点变化复用结果，operand transform 只重新计算对应祖先；
- Leafer 使用独立 synthetic Path，保留源节点层级与选择身份；测试覆盖按需加载、失败 warning、dispose 后迟到结果、无关增量不 `set()`、精确重算与删除清理；
- Vite 8 构建产生独立 `browser-vector-path` chunk 与 `pathkit.wasm`，Main/Preload/Agent 不包含该实现。

## 后续门禁

1. 完成 SVG 往返、flatten、outline stroke、像素基线和双平台打包产品 smoke 后再提升 capability 状态。

## 参考

- [Figma Boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [Figma selection and nested layers](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects)
- [Figma REST API node types](https://developers.figma.com/docs/rest-api/file-node-types/#boolean_operation)
- [Skia PathKit](https://skia.org/docs/user/modules/pathkit/)
