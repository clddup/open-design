# ADR-0064：Figma-compatible Component Set 与 VARIANT v1

- 状态：已接受
- 日期：2026-08-14
- 文档协议：`DesignDocument 1.22.0`
- Component Service：contract v2
- Figma compatibility baseline：`@figma/plugin-typings 1.133.0`，commit `83bfe81d9616ab759702f657eb18ef153f83e8ae`
- 关联：ADR-0045、ADR-0062、ADR-0063

## 背景

OpenDesign 已有 Main、Instance、稳定 override 和 Boolean/Text/Instance-swap Component Properties，但离散状态仍只能被建模为彼此无关的 Component。用户和 Agent 无法把 Default、Hover、Pressed、尺寸或主题等选择组织成一个可发现的集合，Instance 也没有统一的 VARIANT 属性入口。

产品采用 Figma 官方公开的 Component Set、variant properties 和 Plugin API 类型作为兼容基线，同时继续由 OpenDesign 拥有文档、事务、revision、history 与权限。私有 `.fig` 二进制格式、Figma runtime 和 OpenPencil 文档模型不进入核心。

## 决策

### 版本化集合与成员语义

`DesignDocument 1.22.0` 增加正式 `VariantSetDefinition`：稳定 ID、名称、真实 Frame root、default Component、VARIANT property definitions 与 extensions。Component 通过 `variantSetId` 加入集合，并保存完整 `variantProperties` 组合；普通 Component 的组合必须为空。

每个 Set 必须满足：

- root 是真实 Frame，直属 children 恰好是成员 Component roots，不允许装饰或隐藏垃圾 Group；
- property collection 在每个成员上完整一致，值来自声明 options，组合唯一；
- default values 与 default Component 一致，几何上最左上成员是 default；
- Set 非空，所有 ID、引用和层级在文档 invariant、保存和事务边界共同验证。

新增正式 `put_variant_set` / `delete_variant_set` 操作以及 Variant Set change set。删除仍被成员或 preferred value 引用的 Set 会失败；普通 Remove Component 不允许单独破坏 Set，未来 remove/dissolve 由 Set 级 planner 独立交付。

### Combine as variants 是一个事务

`planCombineComponentsAsVariants` 只接受同 Page、同 immediate parent、未锁定且尚未属于 Set 的两个以上 Component。v1 支持 Page root 或非 Auto Layout Frame parent。

Planner 创建一个透明 Component Set Frame，将成员重挂载进去并换算局部 transform，保持每个成员的 world geometry；随后在同一事务更新 Component membership 与 properties，并写入 Set definition。整个操作只有一个 revision 和一个 undo entry。非法 property matrix、重复组合、混合 parent、Auto Layout parent、旧 inspection root mapping 或超预算输入在 revision 前失败。

人工多选只有在全部选区都精确对应 eligible Component roots 时显示 `Combine as variants`。名称可从共同 `State=Value` 或 `Set / Value` 模式推导；无法可靠推导时使用通用 `State` 和稳定去重值，不猜测视觉相似性。成功后选择真实 Set root。

### Instance 解析与用户入口

Instance 继续引用一个具体 Component；该 Component 的 variant values 是无 assignment 时的初始值。Component Service 先合并 VARIANT assignment，选择集合内唯一匹配的 Component，再应用该成员的 Boolean/Text/Instance-swap properties，最后应用 advanced override。

Inspector 对 Instance 使用 select 呈现每个 VARIANT option，set/reset 复用现有 property 事务。Main 显示 Set 名称、当前组合和 default 标记；Set root 显示成员数量。Set 成员暂不显示普通 Remove Component，避免产生已知非法文档。

Canvas、SVG/位图导出只投影解析后的成员 subtree，不把 authoring Set Frame 放进 Instance。Undo/redo、JSON 保存重开、autosave 与 inspection 消费同一事实。Inspection 返回 Set definitions、member IDs、成员 properties，以及 Instance 的 initial `componentId` 和有效 `resolvedComponentId`。

### Agent 与互操作边界

`opendesign_manage_components` 增加 `combine-as-variants`。Agent 必须提供 inspection 中的 Component IDs 与 root node IDs；Renderer 在规划前验证两者仍精确映射，Main 用 roots 解析 active delivery artboard，不能跨目标组合。set/reset-property 直接支持 VARIANT，不增加第二套工具。

`@opendesign/figma-interop` 只把 Set property definitions 与成员 `variantProperties` 投影到固定官方 Plugin API typings。核心包不依赖 Figma 类型，当前也不宣称 Plugin/REST 导入导出或私有 `.fig` 解码。

## 迁移与兼容

`1.21.0` 及更早可迁移文档为每个 Component 补空 `variantProperties`；已有 `variantSetsById` 占位 map 保持为空。不根据图层名称、位置或重复外观自动制造 Set。

旧 Component/Instance 行为不变。损坏 Set、未知 option、无匹配组合、重复组合、孤立 member/root 或不完整 property collection 都明确失败，不回退到 default 或静默删除 assignment。

## 验证

自动化覆盖 schema/migration/invariant、combine world geometry、单事务与 change set、undo/redo、JSON 保存重开、set/reset、无匹配组合、成员移除门禁、Leafer selected-variant projection、SVG selected-variant export、Figma typings、Inspector selector、多选人工入口、Agent schema/execution、scoped inspection，以及 delivery target scope。

## 后果

- OpenDesign 获得正式 Component Set/VARIANT 数据模型，而不是名称约定或 Renderer 特判。
- 人工、Agent、Canvas、导出和持久化共享一个解析与事务入口。
- 能力仍为 `degraded`：本文原始切片未实现的 Set 生命周期与二维 property matrix 已由 ADR-0065/0066 完成，Slot 已由 [ADR-0067](0067-figma-compatible-component-slots.md) 完成；拖拽矩阵重排、跨文件 Library、Figma Plugin/REST import-export、直接选择画布内部派生 Main child 和双平台打包 GUI 证据尚未完成。
