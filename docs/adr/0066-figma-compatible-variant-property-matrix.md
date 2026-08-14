# ADR-0066：Figma-compatible Variant Property Matrix v3

- 状态：已接受
- 日期：2026-08-14
- 文档协议：`DesignDocument 1.23.0`
- Component Service：contract v2（不变）
- 关联：ADR-0063、ADR-0064、ADR-0065

## 背景

Component Set v1 与成员生命周期 v2 已能建立、扩展和解散 Set，但 Variant properties 仍只能在 Combine 时一次性写入。用户和 Agent 不能建立 Size × State 等二维属性、修正 property/value 名称、重排 Inspector 顺序或直接编辑成员组合。

Figma 当前公开行为允许新增、重命名、重排和删除 Variant properties，重命名和重排 values，并要求每个成员组合唯一但不要求完整笛卡尔积；top-left Variant 继续决定 default。Variant properties 在其他 component property 类型之前。删除唯一 Variant property 会删除 Component Set。

## 决策

### 显式持久化 property 顺序

`DesignDocument 1.23.0` 在 `VariantSetDefinition` 增加必需的 `propertyOrder`。它必须恰好包含 `componentPropertyDefinitions` 的全部 key 一次。`variantOptions` 继续是每个 property 的 value 顺序。

不能依赖 JavaScript object key 顺序表达产品事实：canonical fingerprint 会规范化对象，单纯重排 key 无法稳定产生 revision、diff、history 或跨语言互操作。`1.22.0` 及更早文档按已有 definition key 顺序确定性迁移，不猜测视觉布局或名称语义。

### 一个矩阵事务族

EditorRuntime 新增以下 Set 级 planner：

- add / rename / reorder / remove Variant property；
- rename / reorder Variant value；
- set one member's complete Variant properties。

每个 planner 从当前 Set、成员和 Instance 事实构造完整下一状态，并以现有 `put_component`、`put_variant_set`、`update_properties` 或 v2 dissolve 操作生成一个事务。成员 Component identity 与真实 root layer name 同步为有序的 `Property=Value, …` 语法，Layers、inspection 与保存事实不会继续显示旧组合。没有 Renderer 私有 matrix 状态或第二份 Component registry。

新增 property 必须为每个成员提供值；成员组合编辑必须提交完整 property collection。属性和值名称有界、trimmed，property 禁止 `#`，组合必须唯一。删除 property 若使剩余组合冲突则原子拒绝；删除唯一 property 复用 Set dissolve，保留 Component Main 和当前 Instance 视觉成员。

### Instance 迁移

矩阵编辑前先用 Component Service v2 记录所有相关 Instance 的 resolved member。宿主先对稀疏 assignments 应用语义变换（rename/remove/value rename），再在投影文档中验证解析结果。若稀疏 assignment 不再指向原成员，只补足该成员新的完整 Variant values；无法恢复时整笔失败。

这保证 rename、property add/remove 和 member combination edit 不会在下一次 Canvas、导出或保存重开时才暴露失效 assignment。Boolean/Text/Instance-swap assignments 与 advanced sourcePath override 不受影响。

### Inspector 与 Agent

选中真实 Set root 时，Inspector 在现有对象身份和成员操作之后显示紧凑矩阵：property/value rename 与顺序控制、property composer、每个成员的完整组合字段。所有字段使用桌面面板密度、键盘 Enter/blur 提交、明确 accessible label；失败继续走统一 editor error，成功走 history/undo。

`opendesign_manage_components` 增加对应 typed actions。Agent 必须使用 inspection 返回的 Set/root/member IDs、`propertyOrder`、definitions 与成员 properties；模型不直接输出底层 put/update 命令。Main 的 Page scope、material target、preview、revision 和审批边界不变。

## 迁移与兼容

- `1.22.0` Variant Set 以 definition key 顺序补 `propertyOrder`；无 Set 文档只升级版本。
- `1.23.0` 保存、autosave、undo/redo、diff 与 change set 把 `propertyOrder` 作为正式字段。
- Figma Plugin API 的 definitions 仍投影为公开 map；OpenDesign 显式顺序字段留在自身协议，未来 Plugin/REST adapter 负责把顺序转换到目标 API 支持的操作序列。

## 验证

自动化覆盖 schema/migration/invariant、property/value add/rename/reorder/remove、组合冲突、成员值编辑、Instance resolved member 保持、last-property dissolve、单 revision/diff/undo、Inspector 键盘流、Agent strict schema/execution、inspection、保存重开及 Canvas/SVG/位图继续解析同一成员。

## 后果

Component Set 获得可维护的二维 Variant matrix，而不是 JSON key 或图层名称约定。Slot、画布拖拽矩阵重排、非 Variant component property 的统一显式顺序、跨文件 Library、Variables 与 Figma Plugin/REST import-export 仍是后续切片。
