# ADR-0126：跨 Design File Shared Style Library

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.38.0`
- Library Service：contract 1，统一 Component、Variant Set 与 Shared Style release
- Style Service：contract 2，local/imported Style 统一解析
- 关联：ADR-0069、ADR-0070、ADR-0090、ADR-0124

## 背景

ADR-0124 已建立同 Project 跨 Design File Library 的不可变 release、per-file enable、更新审阅和 imported Component/Variant source store。Shared Styles 仍只能在当前文件内使用，导致品牌 Paint、Text、Effect 与 Grid 需要复制，复制后又失去来源和更新关系。

跨文件 Style 不能复制进 `stylesById` 冒充 Local Style，也不能建立 Renderer 私有缓存。前者会污染 Local Styles 的排序、编辑和发布语义，后者会绕过权威文档、revision、history 与保存重开。

## 决策

### imported Style 是独立的正式文档事实

`DesignDocument 1.38.0` 增加 `libraryStylesById`。每项 `LibraryStyleSource` 保存稳定本地 Style ID、不可漂移的 Library/源 Project/源 Design File/源 Document/源 Style 身份、当前 release ID 和完整 Style 定义。

Imported Style 不进入 `stylesById` 或 `styleOrderByType`，因此不显示为 Local Style，也不能通过本地 Style 创建、重排或“从选区更新”工具修改。Style Service 通过同一 lookup 解析 local 与 imported Style；Component → Style → Variable、Leafer、SVG、位图、detach 和 Inspector 不建立第二条投影路径。

Local/imported ID 或 key 冲突、source identity 漂移和 Style 类型变化均失败关闭。通用 Agent transaction 不接受 Library source 命令；导入和更新只能由经过 Project Library 选择与能力校验的宿主流程规划。

### 同一 release 承载 Components、Variant Sets 与 Styles

原 Component release planner 移入独立 `@opendesign/library-service`。一个不可变 release 同时保存 Components、Variant Sets 与 Paint/Text/Effect/Grid Styles；只包含 Styles 的 Library 也可以发布。release identity 只由可发布内容决定，Style 内容变化会产生新 release，无关 Page 内容不会。

默认不发布 `hiddenFromPublishing` Style；若已发布 Component 的 source subtree 实际引用该 Style，则把它作为隐藏依赖随同 release 携带。Component 引用了 imported 或缺失的 Style 时拒绝发布，避免生成无法独立解析的 bundle。

### 首次应用、更新与删除继续使用唯一 Runtime

首次应用 Library Style 时，宿主在同一 `DesignTransaction` 中先写入 `put_library_style_source`，再写节点 `set_style_reference`，因此只产生一个 revision 和一个 undo。接受更新时，Runtime 原子更新当前文件已消费的 imported Component、Variant 与 Style source；保存消费文件成功后，catalog 才记录 accepted。

禁用 Library 只从 Assets 和 Inspector picker 隐藏候选，不删除已缓存 source 或现有引用。解除 Style 引用时先物化当前 resolved 外观；被节点、Text run 或 Component source 引用的 imported Style 不能删除。新 release 移除的 Style 进入 stale diagnostics，不做破坏性自动清理。

### 用户与 Agent 表面

Assets 中每个已启用 Library 分别列出 Components 与 Styles。Inspector Style picker 同时搜索 Local Styles 和 enabled Library Styles，并显示 Library 来源；共享 `@opendesign/ui` Combobox 提供键盘导航和按 Style/Library 名称过滤。

Agent inspection 可只读看到当前文档已导入的 `libraryStylesById`，但不能把 imported Style 当成本地定义编辑。跨文件 Library 的检索、启用和首次应用仍是人工 Project 能力，不从 Conversation 组织关系或当前选区隐式授权。

## 当前边界

当前只覆盖同 Project 的 Design File Library。跨文件 Variables、Workspace 聚合、远端团队 Library、发布权限、Style suggestions 与完整 Figma Plugin/REST/DTCG 互操作仍未实现。

## 后果

- Components、Variant Sets 与 Styles 共享一个 release/catalog/update 生命周期，不新增兼容分支或第二套缓存。
- Imported Style 进入保存、history 和完整性校验，但不污染 Local Styles 管理区。
- 禁用、更新、detach、undo/redo 与保存重开保持 Figma 类引用心智，同时继续服从 OpenDesign 的唯一事务事实。
- Library Service 成为格式无关的发布/更新编排层；Component Service 与 Style Service 继续只负责各自解析语义。
- `scripts/architecture-baseline.json` 明确登记 Library Service 只依赖 Component Service 与 Design Contracts，EditorRuntime 单向消费该 planner；依赖 DAG 不形成循环。

## 验证

- 契约与迁移测试覆盖 `1.37 → 1.38`、strict current schema、Library Style diff/change-set 与旧文件空 store 初始化。
- Runtime/Style 测试覆盖首次应用单事务、local/imported 统一解析、内容更新、detach 物化、删除引用保护、身份/类型/key 冲突、undo/redo 和保存重开。
- 发布测试覆盖 hidden Style 排除、Component 隐藏依赖闭包、Style-only Library 与 Style 内容变化产生新 release。
- Project/UI 测试覆盖发布、启用、Assets 分类、Inspector 搜索/来源、更新接受顺序、禁用保留现有引用和 imported Style 不可本地编辑。
- `pnpm architecture:check` 覆盖新增 workspace package、依赖方向和无环性。
