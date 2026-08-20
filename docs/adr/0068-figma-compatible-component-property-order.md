# ADR-0068：Figma-compatible Component Property Order v4

- 状态：已接受
- 日期：2026-08-14
- 文档协议：`DesignDocument 1.25.0`
- Component Service：contract v4
- Figma compatibility baseline：`@figma/plugin-typings 1.133.0`，commit `83bfe81d9616ab759702f657eb18ef153f83e8ae`
- 关联：ADR-0045、ADR-0063、ADR-0064、ADR-0066、ADR-0067

## 背景

Component Properties v1 已支持 Boolean、Text、Instance swap 与 Slot，但普通属性在 Inspector、Agent inspection 和 Component Service 中仍依赖 `componentPropertyDefinitions` 的 object key 顺序。该顺序不是正式产品事实：canonical JSON 会规范化 object，跨语言读写也不保证用对象成员顺序表达用户排序，因此仅重排 key 不能可靠地产生 diff、revision、history 或保存重开结果。

Figma 当前公开行为允许 Component author 重排普通 Component properties，并明确要求 Variant properties 始终显示在其他 property 类型之前；两类属性只能在各自类别内排序。OpenDesign 已在 ADR-0066 为 Variant Set 持久化 `propertyOrder`，普通属性需要对称但独立的正式语义。

## 决策

### Component 自己拥有普通属性顺序

`DesignDocument 1.25.0` 在每个 `ComponentDefinition` 增加必需的 `componentPropertyOrder`。它只管理该 Component 的 Boolean、Text、Instance-swap 与 SLOT definitions，必须无重复并恰好包含 `componentPropertyDefinitions` 的全部 key。

Variant property 顺序继续只由 `VariantSetDefinition.propertyOrder` 管理。Instance 的有效展示和解析顺序固定为：

1. active Component Set 的 Variant properties；
2. 解析得到的 active Component 的 ordinary properties。

Component Set 不增加第二份 ordinary property order。每个成员 Component 保有自己的定义与顺序；Combine、Duplicate Variant、加入/移出 Set 和 Dissolve 保留成员已有顺序。切换 Variant 后，普通属性顺序由新的 active member 决定，不从 Set 或 Renderer 猜测。

### 一个原子 Runtime 事务族

现有 add、rename、remove planner 分别在末尾追加、原位替换和同步删除顺序项。新增 `planReorderComponentProperties` 只接受与当前定义完全相同的 property 集合；缺失、额外、重复、未变化或 missing Component 都明确失败。

成功重排只提交一个正式 `put_component`，因此使用既有 base revision、preview、diff、history、undo/redo、autosave 和保存重开语义，不建立 Renderer 私有顺序或专用历史。Component change set 把 `componentPropertyOrder` 作为独立 changed field。

文档不变量在 Runtime 入口验证 order 与 definitions 完全对应。Component Service v4 按显式顺序构建有效属性；若接收到半套或损坏的 order，不因非空断言崩溃，而是返回结构化 `invalid-component-property` issue 并失败关闭。

### Human UI 与 Agent 使用同一事实

Main Inspector 的 ordinary property authoring 列表直接按 `componentPropertyOrder` 渲染，并与 Variant matrix 共用一个独立 CSS Module 的键盘可访问 Up/Down 控件。Variant 区仍位于 ordinary properties 之前，不能跨类别拖动；当前切片不新增装饰性画布排序状态。

`opendesign_manage_components` 增加 `reorder-properties` typed action。Agent 必须提交 inspection 返回的 `componentId`、稳定 `componentRootNodeId` 和完整 `componentPropertyOrder`；Main 与 Renderer 同时校验 Page scope 和 inspected root，stale root 不进入 Runtime。inspection 明确返回 `componentPropertyOrder`，模型不通过 object key 或图层名称推断顺序。

## 迁移与兼容

- `1.24.0` 及更早文档按已有 `componentPropertyDefinitions` key 顺序确定性补齐 `componentPropertyOrder`，不按名称、类型、图层位置或 Figma 类别猜测。
- `1.25.0` 文档缺少、重复或不能完整覆盖 definitions 的 order 明确拒绝；不在读取时静默修复当前版本损坏事实。
- Figma Plugin API 的 definitions 仍投影为公开 map；OpenDesign 的显式顺序保留在自有协议，未来 Plugin/REST adapter 负责把顺序转换为目标 API 支持的操作序列，不把 Figma typings 泄漏到 Core。

## 验证

自动化覆盖 schema version、`1.24.0` 确定性迁移、严格 invariant、add/rename/remove 同步、重排集合校验、单 revision/diff/undo、保存重开、Variant-before-ordinary 解析顺序、Inspector accessible controls、Agent strict schema/typed execution/stale root、inspection，以及 Canvas/SVG/位图继续消费同一 Component Service 结果。

## 后果

普通 Component Property 顺序成为可迁移、可审计和可撤销的 OpenDesign 文档事实，不再依赖 JavaScript 对象偶然行为。Slot-in-Slot 的永久 composition boundary 见 ADR-0106；on-canvas matrix reordering 与 Variables 后续已经完成。能力仍为 `degraded`：跨文件 Library、Plugin/REST import-export、派生 nested Instance 直选/编辑与 macOS/Windows 打包 GUI 实机证据仍未完成。
