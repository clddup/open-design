# ADR-0062：Agent 通用组件决策声明与权威结构验证

- 状态：已接受
- 日期：2026-08-14
- 文档协议：不变（`DesignDocument 1.20.0`）
- Component Service：不变（v1）
- Agent DesignPlan：v4
- 关联：ADR-0018、ADR-0045、ADR-0050

## 背景

OpenDesign 已有版本化 Component Main、Instance、override、Assets、Inspector 和专用 Agent tool，但旧 `DesignPlan v3` 不表达组件意图。模型可以在多个页面复制同一 Logo、导航、按钮或卡片的 primitive layers，几何与截图仍然通过；反过来，按固定类别或“出现两次”强制组件化又会把一次性布局 wrapper、偶发装饰和仅外观相似但语义不同的对象污染成无意义 Component。

Figma 的公开模型把 Main Component 作为结构与属性来源，把 Instance 作为保持链接并接收更新的复用对象；Variants 组织状态、尺寸等离散差异，Component Properties 暴露文本、显隐、Instance swap 等可控差异。它没有把“按钮、Logo 或出现次数”本身定义为组件资格。[Figma Components](https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma)、[Component Properties](https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties)、[Variants](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants)。

OpenPencil 也公开了 Component、Instance、override、Component Set/Variant、实例同步与 MCP/CLI 操作，可以作为节点类型和产品行为参考；其 roadmap 同时明确完整 Component Property authoring 尚未完成，因此不能作为“所有专业组件语义均已具备”的证明，也不会重新成为 OpenDesign runtime 或文件契约。[OpenPencil Components](https://openpencil.dev/user-guide/components)、[OpenPencil Roadmap](https://openpencil.dev/development/roadmap)。

## 决策

### DesignPlan v4 显式声明组件判断

新模型只接收 `DesignPlanToolInput version: 4`。除 v3 的 targets、视觉系统和 raster policy 外，计划必须包含：

```text
componentStrategy
├── summary
└── candidates[0..24]
    ├── decision: component
    │   ├── componentId
    │   ├── main { mode, targetId, nodeId }
    │   └── instances[] { targetId, nodeId }
    └── decision: ordinary
        └── occurrences[] { targetId, nodeId }
```

LLM 从当前设计意图判断候选，依据是同一或跨 target 的复用、稳定语义身份、集中更新价值、结构一致性与预期实例差异；不得按 Logo/按钮等类别或固定出现次数机械决定。一次性区域、layout wrapper、偶发装饰和语义不同的相似对象应声明为 ordinary，或在 summary 中解释为什么没有合理候选。single-raster 计划不得声明组件候选。

每个 decision、Component、Main、Instance 和 ordinary occurrence 使用稳定 ID。Main 必须不晚于其 Instances 所在 target；同一节点不能同时承担两个候选身份，target artboard 自身不能冒充语义对象。

### 宿主验证模型自己的声明

Main 不凭节点名称或像素相似度猜测组件。最终 refined capture 仍要求 exact-revision inspection，并按当前 target 验证：

- Component Main 节点位于交付 artboard 内，是 Frame/Group，且 `componentsById[componentId].rootNodeId` 精确绑定该节点；
- Instance 节点位于交付 artboard 内，kind 为 Instance，并继续引用声明的 componentId；复制出来的普通 Group/Frame 不能通过；
- ordinary 语义对象位于交付 artboard 内，并有独立 Frame/Group 根；不要求或制造 Component；
- 任一声明缺失、脱链、扁平化或越出 target 返回 `design_workflow.component_strategy_incomplete`，不得推进 verified ledger。

Inspection parser 只消费 Renderer 已按工作集裁剪的 `componentsById` 和 Instance `componentId`，不扩大 Page/Design File 读写作用域。所有组件写仍必须走 `opendesign_manage_components`、现有权限和唯一 EditorRuntime 事务入口。

### Amendment 与兼容

v2/v3 计划继续用于历史 journal、恢复和旧 fixture，不被追溯强加新门禁。v4 component strategy 的 target-local 投影发生变化时，对应已落地 target 回到 drafted 并重新 review/verify。材料写入开始后，已声明的语义节点 ID 不能从 amendment 消失；ordinary 可以保留同一根并升级为 Component Main，但已声明 Main/Instance 的角色和 componentId 不能静默改写。

## 结果与限制

- 组件化从提示词偏好变成“LLM 决策 → 稳定计划 → typed component tool → exact-revision 结构验收”的可信闭环。
- 规则适用于 UI、Logo、品牌、海报、演示图形和后续设计类型，不绑定对象类别。
- 当前门禁验证已声明候选，不声称已经能确定性发现模型故意遗漏的重复结构；结构相似度诊断与 design critic 仍是后续质量轨。
- Boolean/Text/Instance-swap Component Properties 已由 [ADR-0063](0063-figma-compatible-component-properties.md) 完成，Component Set/VARIANT 已由 [ADR-0064](0064-figma-compatible-component-sets-and-variants.md) 完成，Slot 已由 [ADR-0067](0067-figma-compatible-component-slots.md) 完成，均不塞入 Plan v4；跨文件 Library 与 Token/Variable 继续按 roadmap 独立演进。

## 验证

- Tool schema：v4 component/ordinary 正例、重复 occurrence、Instance 早于 Main、artboard 冒充对象和 single-raster 反例；v2/v3 历史输入继续读取。
- Inspection：解析受限 Component/Instance 身份；有效 Main、linked Instance、ordinary Group 通过；复制 Group、未绑定 Main、扁平 ordinary 节点失败。
- Amendment：ordinary 保留节点升级 Component 后 affected target 回到 drafted；删除材料语义节点或替换已声明 componentId 被拒绝。
- 既有 Component Service 的 Main 同步、override、nested swap、Detach、save/reopen、undo/redo、Canvas 和导出回归继续作为底层证据。
