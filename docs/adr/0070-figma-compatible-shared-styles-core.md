# ADR-0070：Figma-compatible Shared Styles Core v1

- 状态：已接受
- 日期：2026-08-15
- 文档协议：`DesignDocument 1.27.0`
- Style Service：contract v1
- Figma compatibility baseline：`@figma/plugin-typings 1.133.0`，commit `83bfe81d9616ab759702f657eb18ef153f83e8ae`
- 关联：ADR-0005、ADR-0009、ADR-0015、ADR-0045、ADR-0063～0069

## 背景

Components 与 Variables 已经是 OpenDesign 自有、版本化的设计系统事实，但 Paint、Text、Effect 与 Layout Guide 仍只能复制为节点上的具体属性。没有 Shared Styles，重复视觉决策无法稳定复用，Agent 也只能制造相似但失联的图层；直接开始跨文件 Library 会缺少必要的本地发布单元。

Figma 的公开 Plugin API 将本地 Style 定义为 `PaintStyle | TextStyle | EffectStyle | GridStyle`。Style 有稳定 ID/key、名称与说明；PaintStyle 可同时用于 fill/stroke，节点通过 `fillStyleId/strokeStyleId/textStyleId/effectStyleId/gridStyleId` 消费。名称中的 `/` 表示 UI folder 路径，不需要第二份 folder registry。

## 决策

### 文档事实与引用

`DesignDocument 1.27.0` 增加：

- `stylesById`：四类本地 Style 的唯一 registry；
- `styleOrderByType.PAINT/TEXT/EFFECT/GRID`：每类独立、确定的本地顺序；
- 节点上的 Figma-shaped 五类稳定 Style ID 引用。

四类 Style 共用 `id/key/name/description/hiddenFromPublishing/extensions`。Paint 保存 paints，Text 保存当前 OpenDesign 正式支持的 font family/size/weight、line height 与 letter spacing 子集，Effect 保存 effect list，Grid 保存 layout guides。节点仍保存具体 fallback 外观；Style 引用不是第二份节点状态，也不允许改变 Style 类型。

Style registry、类型/顺序/引用完整性与纯投影语义位于独立 `@opendesign/style-service`。该包只依赖 `@opendesign/design-contracts`。生产投影顺序固定为：

`Component materialization → Shared Style materialization → Variable materialization → Leafer/SVG/raster`

因此 Main/Instance 共享同一个 Style，节点或 Style paint 上的 Variable 仍在最终外观上解析。Leafer 场景和导出文档均为当前 revision 的可丢弃投影，不能反写权威文档。

### 编辑、删除与直接属性修改

Style create/update/reorder、create-from-selection、apply/detach/delete 只能由 EditorRuntime typed planner 生成正式 `DesignTransaction`。它们复用 base revision、preview、diff、history、undo/redo、autosave 与保存重开。

解绑 Style 时，Runtime 先把当前 resolved 外观物化到节点 fallback，再清除引用。删除 Style 在同一事务先对全部消费者执行上述解绑，再删除定义。用户直接修改受 Style 控制的具体字段时，也先物化该 Style 的完整字段组，再应用用户修改并 detach；不允许投影静默覆盖用户输入，也不允许未修改字段回退到陈旧 fallback。

### Human 与 Agent

Human 使用 Local Styles 工作台管理四类 Style，并在 Fill、Stroke、Typography、Effects 与 Layout Guides 属性处通过紧凑 picker 应用、创建、更新和解绑。空态、无选区、键盘提交、长 folder 名、错误与 undo 都必须可理解；不把普通属性包装成营销式卡片。

Agent 使用独立 typed Styles tool，只能使用 inspection 返回的稳定 Style/node ID 和受支持 payload。模型不能通过通用 apply 直接写 registry。检查结果返回类型、folder path、顺序、消费者、当前引用和 fallback/resolved 摘要。

## 迁移与兼容

`1.26.0` 及更早文档确定性迁移为空 Style registry；`1.27.0` 缺少正式字段时严格拒绝。Style 名称中的 `/` 仅用于 folder 展示。核心协议不依赖 Figma 私有 `.fig`；隔离 interop 包负责公开 Plugin/REST 形状转换和保真报告。

首版不宣称 remote Library、发布/导入、团队权限、Style suggestions、完整 TextStyle 段落属性、所有 Figma Paint/Effect/Grid 变体或双向 `.fig` 保真已经完成。这些能力不得以 fallback 或散落兼容判断进入核心文档模型。

## 验证

自动化覆盖 schema/migration、四类 payload、ID/key/order/type/reference invariant、Style Service 投影、Component Main/Instance、Style→Variable 顺序、create/update/move/apply/detach/delete、单 revision/diff/undo/save/reopen、Leafer、SVG/位图、Figma interop、Local Styles UI、Inspector、Agent strict schema/execution/inspection，以及 capability/fixture/architecture/verification facts。

## 后果

OpenDesign 获得 Components、Variables 与 Shared Styles 三类可组合的本地设计系统事实，为后续跨文件 Library 提供稳定前置。代价是文档协议、Runtime diff/history、投影与 UI/Agent 都扩展一类正式实体；这些复杂度集中在公共契约与 Style Service，而不是按报错向画布或 Provider 增加例外。

参考：

- https://developers.figma.com/docs/plugins/api/BaseStyle/
- https://developers.figma.com/docs/plugins/api/figma/
- https://developers.figma.com/docs/plugins/api/properties/nodes-fillstyleid/
- https://help.figma.com/hc/en-us/articles/360038746534-Create-color-text-effect-and-layout-guide-styles
