# ADR-0128：跨 Design File Variable Library

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.39.0`
- Library Service：contract 2，统一 Component、Variant Set、Shared Style 与 Variable release
- Variable Service：contract 1，local/imported Variable 统一解析
- 关联：ADR-0069、ADR-0070、ADR-0124、ADR-0126

## 背景

ADR-0124 与 ADR-0126 已建立同 Project 跨 Design File Library 的不可变 release、显式启用、更新审阅，以及 imported Component/Variant/Style source。Variables 仍只能在当前文件定义，导致颜色、间距、文案和主题模式不能在多个 Design File 中保持稳定引用。

跨文件 Variable 不能复制进本地 `variableCollectionsById` / `variablesById` 冒充 Local Variables，也不能只存在 Renderer 缓存。前者会失去来源与更新语义，后者会绕过权威文档、revision、history、保存重开和 Agent inspection。

## 决策

### imported Variable 是独立文档事实

`DesignDocument 1.39.0` 增加 `libraryVariableCollectionsById` 与 `libraryVariablesById`。每项保存稳定本地 ID、不可漂移的 Library/源 Project/源 Design File/源 Document/源实体身份、当前 release ID 和完整 Collection/Variable 定义。

Imported Collections/Variables 不进入 Local Variables 的顺序和管理区，不能通过本地创建、编辑、移动或删除命令修改。Variable Service 统一解析 local/imported Collection、Variable、mode 与 alias chain；Component、Style、Leafer、SVG、位图和 inspection 不建立第二条解析路径。Local/imported ID 或 key 冲突、source identity 漂移、Variable 类型变化、缺失 Collection 和 alias 闭包均失败关闭。

### 同一 release 发布完整依赖闭包

Library release contract 3 同时承载 Components、Variant Sets、Shared Styles、Variable Collections 与 Variables；只包含 Variables 的文件也可以发布。默认发布未隐藏 Collection 中未隐藏的 Variables。已发布 Component 实际使用的隐藏 Collection/Variable，以及公开 Variable 所需的跨 Collection alias 依赖，必须随 release 形成完整闭包；引用 imported 或缺失 Variable 时拒绝发布。

旧 release contract 2 确定迁移为空 Variable stores，不猜测不存在的变量来源。release identity 纳入 Collection、mode、Variable metadata、typed values 与 alias，因此任一可发布 Variable 内容变化会产生新 release，无关 Page 内容不会。

### 首次绑定与更新保持原子

Assets 的 Library 分区展示已发布 Variable Collections 与 Variables。Inspector picker 同时搜索 Local Variables 和已启用 Library Variables，并明确显示来源。首次选择 Library Variable 时，宿主在一笔 `DesignTransaction` 中依次写入所需 Collection、alias closure、Variable source，再建立节点 binding，因此只产生一个 revision 和一个 undo。

接受 Library 更新时，Runtime 原子更新当前消费文件已经导入的 Component、Variant、Style 与 Variable source；消费文件保存成功后 catalog 才记录 accepted。新 release 删除的 imported Variable/Collection 只进入 stale diagnostics，不静默删除现有 binding。禁用 Library 只隐藏新候选，已导入 source、binding、mode override 和解析结果继续有效。

### Agent 与权限边界

Agent inspection 可只读看到当前 Design File 已导入的 Library Variable source 与解析结果，但 `designSystemIds` 仍只列可由本地 Variable 工具管理的定义。Agent 不得编辑 imported source，也不能从 Conversation、Project 归档字段或当前选区隐式启用 Library；跨文件 Library 的检索、启用和首次导入继续由受信任的 Project UI 发起。

## 当前边界

当前只覆盖同 Project 的 Design File Library。Workspace 聚合、远端团队 Library、发布权限、DTCG/Figma Plugin/REST 互操作、更多 Variable binding 字段和 Library suggestion 仍未实现。

## 后果

- Component、Variant、Style 与 Variable 共用一个 release/catalog/update 生命周期，不增加兼容分支或 Renderer 私有缓存。
- Imported Variables 进入持久化、diff、history、undo/redo 和完整性校验，但不污染 Local Variables 管理区。
- 首次绑定、更新、禁用、保存重开和 Agent inspection 继续服从唯一 `EditorRuntime` 与既有 Project 权限边界。

## 验证

- 契约与迁移覆盖 `1.38 → 1.39`、release contract `2 → 3` 和新 imported stores。
- Library Service 覆盖 Variable-only 发布、hidden dependency、跨 Collection alias closure、内容更新和 stale diagnostics。
- Runtime/Variable Service 覆盖首次绑定单事务、local/imported 统一解析、mode override、ID/key/identity/type 冲突、undo/redo 和引用删除保护。
- Project/UI 覆盖发布 fingerprint、Assets 分类、Inspector 搜索/来源、首次绑定、更新接受顺序、禁用保留和 Agent 只读 inspection。
