# ADR-0067：Figma-compatible Component Slots v1

- 状态：已接受
- 日期：2026-08-14
- 文档协议：`DesignDocument 1.24.0`
- Component Service：contract v3
- Figma compatibility baseline：`@figma/plugin-typings 1.133.0`，commit `83bfe81d9616ab759702f657eb18ef153f83e8ae`
- 关联：ADR-0045、ADR-0063、ADR-0064、ADR-0065、ADR-0066

## 背景

已有 Component Properties 能集中编辑文字、显隐与嵌套组件交换，但不能表达“卡片内容区允许实例使用者插入任意批准内容”这一类结构化扩展点。若继续用 advanced `sourcePath` override 或任意 Instance children 表达，会失去 Slot 身份、默认内容、清空/重置、数量提示、preferred values、Variant 切换和确定性恢复语义。

Figma 当前公开的 Slot API 把 Slot 定义为 Frame-like node，并提供 `SLOT` property、`SlotSettings`、`resetSlot()` 与非阻断的 limit violations。OpenDesign 采用这些公开语义，不采用私有 `.fig` 存储或把 Slot 塞进 `extensions`。

## 决策

### 正式 Slot 节点与统一 Frame-like 语义

`DesignDocument 1.24.0` 增加正式 `slot` NodeKind。它拥有 Frame 的外观、尺寸、裁剪、constraints 与 Auto Layout 字段，并增加 `properties.sourceSlotId`：

- Main source Slot 的值为 `null`；对应 Component `SLOT` definition 的 `defaultValue` 指向该稳定 Slot node ID。
- Instance override Slot 的值指向 Main source Slot ID，并作为该 Instance 的直接持久 child。

普通 Instance 继续不持久化整棵派生 Main subtree。它的 `childIds` 只允许明确的 Slot override root；任意其他 child、重复 source Slot、失效 source 或嵌套 Slot 都在 schema invariant、Runtime planner或 Component Service 解析边界失败封闭。

公共 `isFrameLikeNode` 统一 Frame 与 Slot 的容器语义。直接绘制、reparent、Vector Cut、SVG 导入、constraints、Auto Layout、裁剪诊断、Canvas、SVG/位图导出共同消费该语义；Artboard、Layout Guide、Component root 与 Component Set root 等确实要求 Frame 的边界保持严格。

### 唯一解析与合并顺序

Component Service v3 独占 Main → Instance Slot 合并：

1. Variant assignment 先解析唯一 active Component；
2. 查找 active Component 中按稳定 property name 绑定的 source Slot；
3. 没有 override 时投影 source Slot 及默认 contents；
4. 有 override 时以持久 override Slot 的 Frame-like 几何、外观和显式 contents 替换该 source Slot；
5. Slot contents 内的 nested Instance 继续递归解析，普通 advanced override 保持最终优先级。

解析结果返回 Slot 的 `displayNodeId`、source ID、是否 overridden、child count、settings 与结构化 limit violations。Canvas、Inspector、Agent inspection 和导出消费同一结果，不维护 Renderer 私有组件树。

### 生命周期与原子恢复

Main Inspector 只能把同一 Component 内、未带 Layout Guide 的普通 Frame 转成 source Slot。创建显式 override 时，Runtime 确定性克隆当前有效默认 contents 并分配新稳定 ID；后续内容是普通权威节点，可由人工或 Agent 的正式事务编辑。

- Clear 保留 override Slot root 并删除其 contents，表示明确空内容。
- Reset 删除完整 override subtree，实例重新继承 Main 默认内容。
- 删除 `SLOT` property 会在同一事务内清理所有实例 override subtree，并把 source Slot 转回普通 Frame。
- Detach 或删除 Component identity 会物化当前有效视觉树，并把所有 Slot 转为普通 Frame。
- Variant 切换按稳定 property name 把 override 的 `sourceSlotId` 迁移到新成员 Slot，保留 override root 与 contents ID；目标成员没有匹配 Slot 时整笔失败。
- Duplicate Variant 会把 SLOT definition 的 `defaultValue` 重映射到克隆后的 source Slot ID。

这些变化都通过既有 `DesignTransaction`、base revision、单 revision、diff、history 与 undo/redo，不建立 Slot 专用历史或恢复旁路。中途失败不提交部分树。

### Settings、指导性限制与 preferred values

正式 `SlotSettings` 支持：

- `stretchChildOnInsert`
- `displayEmptyByDefault`
- `minChildren` / `maxChildren`
- `allowPreferredValuesOnly`

`min/max/preferred-only` 与 Figma 一样是指导性 warning，不阻断人工或 Agent 编辑。preferred values 可引用同一 Design File 的 `COMPONENT` 或 `COMPONENT_SET`；当前不跨文件解析 Library key。

`stretchChildOnInsert` 在唯一 Runtime insert 边界把新直属 child 拉伸到 Slot 内框，不由 UI 重写几何。`displayEmptyByDefault` 由 Leafer editor-sky 的非持久粉色虚线指示层表达：不可命中、不进入 save/history/capture/export，pan/zoom/实例变换时同步，Slot 填入内容或关闭设置后立即移除。

### 人工与 Agent 共用 typed actions

Main Inspector 提供 Slot authoring、min/max、四项 settings、Component/Component Set preferred values 与 description。Instance Inspector显示 default/custom content、child count、limit warning，并提供 Edit contents、Clear 与 Reset to default。Layers 只显示真实持久 override subtree，不伪造派生 Main children。

`opendesign_manage_components` 增加 `create-slot-override`、`clear-slot`、`reset-slot`、`set-slot-settings`，并让 `add-property` 接受 `SLOT`。模型只提交稳定 Component/Instance/property/source IDs 和 typed settings；Page scope、material target、revision、preview、approval 与唯一 EditorRuntime 入口不变。

## 迁移与兼容

`1.23.0` 及更早文档只升级 schema，不猜测哪些 Frame 应成为 Slot。`slot` 节点、SLOT definition 与 Instance child invariant 必须整体有效；未知或半套 Slot state 明确拒绝。

隔离的 `@opendesign/figma-interop` 验证公开 `SlotNode`、`SlotSettings`、`SLOT` property 与 violation shape。核心 Runtime 不依赖 Figma typings；未来 Plugin/REST adapter 负责 ID、Library key 与 API 操作序列转换。

## 验证

自动化覆盖 schema/migration、Frame → Slot、默认内容、override clone、真实内容编辑、Clear/Reset、settings、preferred-only/min/max warnings、stretch insert、property removal cleanup、Variant migration、Variant duplicate remap、detach/remove materialization、单 revision/undo、Inspector、Agent strict schema/execution/inspection、Leafer projection、空 Slot editor overlay、SVG/位图导出与保存重开路径。

## 后果

Slot 是 OpenDesign 自有文档和组件解析中的正式能力，不是 Figma adapter 特判。能力仍为 `degraded`：v1 不支持 nested Slot、跨文件 Library preferred key、画布内部派生 Main child 直选、Component Set 画布矩阵拖拽重排、私有 `.fig` 解码、Figma Plugin/REST 导入导出和 macOS/Windows 打包 GUI 实机证据。
