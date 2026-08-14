# ADR-0063：Figma-compatible Component Properties v1

- 状态：已接受
- 日期：2026-08-14
- 文档协议：`DesignDocument 1.21.0`
- Component Service：contract v2
- Figma compatibility baseline：`@figma/plugin-typings 1.133.0`，commit `83bfe81d9616ab759702f657eb18ef153f83e8ae`
- 关联：ADR-0003、ADR-0045、ADR-0046、ADR-0062

## 背景

OpenDesign 已有 Main、Instance、嵌套解析和稳定 `sourcePath` override，但用户或 Agent 若只想修改按钮文案、显隐或内部图标，仍需进入逐图层高级 override。这个模型能表达差异，却缺少 Figma 生态中可发现、可命名、可在 Instance Inspector 集中编辑的 Component Properties。

产品决定允许绑定 Figma 生态，但不能把兼容逻辑散落到 EditorRuntime、Renderer 或 Leafer，也不能把 Figma 私有 `.fig` 二进制结构当作 OpenDesign 权威文档。可验证的标准是 Figma 官方公开 Plugin API 与帮助文档；OpenDesign 继续拥有文档、事务、revision、history、权限和持久化。

## 决策

### 核心采用公开语义，不采用私有文件实现

`DesignDocument 1.21.0` 增加与 Figma Plugin API 同形的三层语义：

- `ComponentDefinition.componentPropertyDefinitions` 保存稳定 `Label#suffix` key 对应的定义；
- Main sublayer 的 `componentPropertyReferences` 把 `visible`、Text `characters` 或 nested Instance `mainComponent` 绑定到定义；
- Instance 的 `componentProperties` 只保存偏离默认值的 assignment。

v1 只支持官方公开的 `BOOLEAN`、`TEXT` 和 `INSTANCE_SWAP`。Instance swap 可以保存 `COMPONENT` / `COMPONENT_SET` preferred values，但当前只解析已经存在于文档中的目标。`VARIANT`、`SLOT`、Component Set authoring 和跨文件 Library 是后续独立协议，不用占位字段伪装支持。

`.fig` 私有二进制 schema、内部节点类型和未公开序列化规则不成为事实源。未来 Figma Plugin、REST 或文件导入导出必须进入独立 adapter，并显式报告不能无损映射的语义。

### 解析顺序与 Main 同步

Component Service v2 按确定顺序解析每个属性：

1. 读取 Main definition default；
2. 合并当前 Instance assignment；
3. 将 Boolean/Text/Instance-swap 值应用到绑定的 Main sublayer；
4. 最后应用现有稳定 `sourcePath` advanced override。

因此 consolidated property 是常用入口，advanced override 保持更高优先级。修改已绑定 Main sublayer 的 `visible`、Text `content` 或 nested Instance `componentId` 时，EditorRuntime 在同一事务内同步 definition default；实例未赋值时立即继承新默认值，已赋值实例保持自己的值。

Property 只能绑定 Component Main 的 sublayer，不能绑定 Main root。Text 只绑定 Text，Instance swap 只绑定 nested Instance。新增、重命名、删除、设置和重置都由 planner 产生一个原子事务；rename/remove 同时维护 definitions、references 和所有直接实例 assignments。Instance swap 在提交前解析完整候选文档并拒绝 component cycle、missing target 和类型不匹配。

Detach 物化当前有效视觉值，并清除只属于 Main 的 property references；删除 Component identity 也先清除 Main subtree references。Undo/redo、save/reopen、迁移、Canvas、SVG 和位图继续消费同一文档和解析结果。

### 人工与 Agent 共用入口

Main Inspector 显示 property definition、类型、绑定 source layer，并允许 add/rename/remove。Instance Inspector 先显示 Boolean checkbox、Text field 和 Instance swap selector，再折叠展示高级 sourcePath overrides；reset 只删除 assignment，不复制默认值。

`opendesign_manage_components` 增加 `add-property`、`rename-property`、`remove-property`、`set-property` 和 `reset-property`。模型只能使用 inspection 返回的稳定 Component、Instance、property 和 source node ID。Inspection 返回 definitions、有效 property values、原始 assignments、source references 与 advanced overrides，所有写入继续经过 scope、revision、preview 和唯一 EditorRuntime 事务入口。

### Figma interop 隔离

新增 `@opendesign/figma-interop`，只在该包以开发依赖固定 `@figma/plugin-typings 1.133.0`。包内编译和测试证明 OpenDesign definitions、effective values 与 references 可投影到官方公共类型。

`@opendesign/design-contracts`、Component Service、EditorRuntime、Renderer 和 Leafer 均不依赖 Figma typings；interop 包也没有凭据、网络、文件路径、Plugin host 或第二份可写文档状态。这样未来升级官方 typings 或添加 Figma adapter 时只改变隔离边界，不在核心散落 `if (figma)` 分支。

## 迁移与兼容

`1.20.0` 及更早可迁移版本为旧 Component 补空 `componentPropertyDefinitions`，为旧 Instance 补空 `componentProperties`，不猜测哪些图层应暴露属性。旧 sourcePath overrides 保持原样。

Property key 的 `#suffix` 是稳定身份；rename 只修改 `#` 前的标签并保留 suffix。未知 property、错误 assignment 类型、失效 preferred target、错误 reference field 或默认值不一致都属于文档 invariant 或解析错误，不静默丢弃。

## 验证

自动化覆盖三类 property authoring、Main default propagation、Instance assignment/reset、advanced override 优先级、nested swap cycle rejection、rename/remove 清理、detach、Component identity removal、undo/redo、save/reopen、`1.20 → 1.21` migration、官方 typings 形状、Inspector 人工流、Agent schema/execution 和 scoped inspection。

## 后果

- OpenDesign 的组件语义可直接映射 Figma 公共 API，同时保持自有权威文档和事务边界。
- 常用实例差异不再要求用户或模型操作内部 sourcePath，组件使用更接近成熟设计工具。
- 核心没有 Figma runtime 依赖，也没有私有 `.fig` 绑定；未来生态接入集中在 adapter。
- 能力仍为 `degraded`。本文原始切片未实现的 Component Set/VARIANT 已由 [ADR-0064](0064-figma-compatible-component-sets-and-variants.md) 完成，Slot 已由 [ADR-0067](0067-figma-compatible-component-slots.md) 完成；跨文件 Library、Plugin/REST import-export、破坏性源编辑 orphan migration、画布内部派生 Main child 直选和双平台打包 GUI 证据尚未完成。
