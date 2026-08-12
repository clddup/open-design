# ADR-0045：版本化 Component 与 Instance 解析模型

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：`DesignDocument 1.11.0`
- Service contract：`Component Service v1`
- 关联：ADR-0003、ADR-0006、ADR-0011、ADR-0015、ADR-0023

## 背景

复制图层无法表达设计系统语义：修改导航、按钮或卡片后，副本不会同步；Agent 也只能反复重建图层。旧文档虽保留 `componentsById` 等占位字段，却没有 Main、Instance、Override、循环引用、导出或失效引用语义，不能描述为组件能力。

组件也不能成为 Leafer 私有对象或第二份可写文档。OpenDesign 必须继续拥有节点身份、revision、事务、history、选择与持久化，渲染后端只消费当前 revision 的投影。

## 决策

### Main 是真实节点树，Instance 是派生投影

`componentsById` 保存稳定 `componentId → rootNodeId` 定义，root 必须是当前 Design File 内的 Frame 或 Group。Main 及其后代仍是普通、真实、可编辑 `nodesById` 节点，是组件结构与默认外观的唯一事实源。

`instance` 是正式节点，但只持久化自身 transform、可见性、锁定、外观壳层、`componentId` 与 override 列表，不复制 Main 后代。`@opendesign/component-service` 在指定 revision 解析源树，输出稳定派生 subtree；内部 projection ID 由 `instanceId + sourcePath` 确定。Canvas、hit testing、SVG/位图导出都消费这个解析结果，派生节点不得写回文档、history 或保存文件。

### Override 使用稳定 sourcePath

Override 的身份是从顶层 Main 进入嵌套组件的稳定源节点 ID 路径，不使用 child 数组索引或 Leafer ID。首个版本允许：名称、可见性、透明度、blend、mask、effects 和节点属性 patch。文字内容、fills/strokes 与嵌套 Instance 的 `componentId` 交换都通过该属性 patch 表达。后续同一路径更新会合并已有 patch，不会覆盖用户先前的文字或外观 override。

结构插入、删除、重排和变换不属于 Instance override；用户应修改 Main 或 Detach。解析器对 missing component/source、失效 path、schema 破坏和 component cycle 结构化失败，Runtime 不提交 revision。

### 嵌套、Detach 与生命周期

嵌套 Instance 递归解析，并在交换后的目标上重新检查 cycle。Detach 在一个原子 `replace_subtree` 中把当前解析结果物化为普通节点，保留顶层 Instance ID 作为新 root，内部生成新稳定 ID；Main 定义不受影响，整个动作可 undo/redo。

直接删除 Main 或包含 Main 的 Page 会被 Runtime 拒绝；图层 UI 也提前禁用 Main root 删除。复制 Instance 或含 Instance 的 Page 继续引用原组件。复制 Main 图层只复制普通节点，不隐式创造新组件定义。

### 人工、Agent 与作用域

Assets 列出当前文件组件并可放置 Instance；Layers 区分 Main 与 Instance；Inspector 提供 Create component、Create instance、Go to main、source-layer override、nested swap、Reset 与 Detach。Instance 可移动/旋转/倾斜，首版本不允许直接 resize 或进入内部文本编辑；内部源层从 Inspector 选择。

Agent 使用专用 `opendesign_manage_components`，不能通过通用 apply 写 `put_component/delete_component`。当前 Page 内操作遵守原 Mutation Target，不要求 Page 结构审批；跨 Page 放置或修改仍需要一次性 Page structure access。Inspection 只返回工作集实际引用的组件及嵌套依赖，不泄漏 Design File 其他 Page 的组件树。

组件身份变更属于结构操作，不冒充视觉 refinement；放置 Instance 或修改可见外观时，若 Run 存在 DesignPlan，则进入同一交付账本与视觉复核流程。

### 迁移与兼容

`1.10.0` 中没有 legacy Instance 时可确定性迁移到 `1.11.0`。若旧文档已含语义不明的占位 Instance，则拒绝迁移，不猜测 componentId、override 或源树。`1.11.0` 保存重开保持同一 Main/Instance/Override 结构。

## 验证

自动化覆盖 schema/迁移、Main 同步、override 合并/reset、nested swap/cycle、Detach、删除保护、Page 复制、revision conflict、人工 UI、Agent typed tool/作用域/inspection、增量 Canvas 投影与选择去重、SVG/位图导出、autosave、保存重开和 undo/redo。

## 当前限制

能力标记为 `degraded`：Variant Set、正式 Boolean/Text/Instance-swap Component Properties、跨 Design File Library 发布/更新、破坏性源编辑后的 orphan 迁移、画布直接选择内部 override 目标，以及 macOS/Windows 打包 GUI 实机证据尚未完成。Token/Variable 是后续独立协议，不塞进本切片。

## 后果

- 组件与画布后端解耦，替换 Leafer 不改变文件或事务语义。
- Agent 与人工操作共享同一解析器和原子历史，不再用复制图层模拟实例。
- 首个同文件组件主流程可用，但不会把 Variants、Library 或 Token 提前描述成完成。
