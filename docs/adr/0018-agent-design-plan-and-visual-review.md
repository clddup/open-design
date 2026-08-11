# ADR-0018：Agent 设计方案、画板与视觉审查门禁

- 状态：已接受
- 日期：2026-08-10
- 关联：ADR-0007、ADR-0012、ADR-0013、ADR-0014、ADR-0015

## 背景

仅要求 Agent 在写入后截图，不能阻止低质量的首稿路径。模型仍可能跳过构图规划，把复合设计拆散到 Page 根层，或把生成图片铺满画布后叠加一个通用不透明矩形和文案。该问题不局限于海报：Web/UI 也可能退化为重复圆角卡片、边框和背景色的方块拼接。底层已经支持 Path、渐变、混合、阴影、光晕、模糊、图片与文字；缺失的是写入前的可执行设计意图，以及截图后的结构化视觉批评。

## 决策

Agent 新建设计内容前必须先读取文档，再调用 `opendesign_define_design_plan`。当前契约为 `DesignPlanToolInput version: 2`。计划是 Main 持有的当前 Run 临时状态，不是第二份设计文档，也不改变 revision。它固定：

- deliverable、目标 Page、一个明确 Frame/Artboard 的 Page 坐标及尺寸；
- 构图方向、信息层级、间距节奏、asset integration，以及 1–16 个带稳定 `nodeId` 和画板局部 bounds 的主要区域；
- palette、typography、form language、surface/depth、effects 与明确反模式；
- 可编辑图层、raster asset roles、实现步骤与渲染验收项。

所有 deliverable 默认使用 `editable-composition`。`single-raster` 只在计划携带当前用户消息中的精确摘录，且摘录本身明确要求单张扁平图片时接受。图片生成和放置必须复用计划声明的 role；生成结果不能自行成为完成证据。新图层必须位于计划 Frame 内，首个创建事务必须按计划位置和尺寸创建轴对齐的 Page-root Frame，后续 Page-root 散落写入被拒绝。每个声明区域必须使用原 `nodeId`，以计划 bounds 创建为画板直属、轴对齐的 `Group` 或 `Frame`；同一 ID 不得重复，也不得冒用画板 ID。

Renderer 只在收到 Main 对同一 tool call 的 `accepted` 结果后，才把 version 2 计划投影为可丢弃的 Frame/区域骨架；未经确认的 Provider tool request 不能单独触发画布展示。正式区域根及其实际内容到达后逐区替换骨架，具体生命周期见 [ADR-0028](0028-agent-generation-presentation.md)。

Main 在首次实质写入后的新截图到达后冻结下一次设计写入，直到 Agent 调用 `opendesign_record_visual_review`。Review 必须分别描述 composition、hierarchy、typography、asset integration、form/surface、effects，并给出至少两项具体修改。Runtime 完成门禁固定顺序为：

```text
inspect → define plan → material draft → capture → visual review
        → concrete refinement → final capture → completion
```

生成图片参与新建的可编辑 composition 时，最终结果还必须包含有意义的可编辑文字、矢量、形状、控件或信息层；不能只放置一张 raster 后结束。UI 同样必须在计划中说明 grid、density、typographic hierarchy、state、form 与 depth，重复 card/rectangle 不能被当作完整视觉语言。

## 结果

- 方案与审查成为可验证工具轨迹，不再只是模型 prose。
- Main 在执行前阻止无方案的新建设计、未声明图片角色、错误 Page/Frame 几何、区域 ID/bounds 漂移、根层散落和截图后未审查的继续写入。
- 原始 DesignDocument 仍只有 `EditorRuntime` 一个可写事实源；计划和 review 随 Run 终态释放。
- 该门禁提高过程质量，但不声称自动证明审美优秀。真实 macOS/Windows 像素基线、专业人工验收和后续独立 design critic 仍是更高层证据。

## 验证

- Tool contract 测试覆盖 plan/review 字段、区域 bounds、重复/保留 ID、反模式与图片 role。
- Main coordinator 测试覆盖无计划拒绝、计划 Page、首个 Frame 的位置/尺寸、区域根的类型/直属层级/bounds、嵌套图层、根层散落、图片 role、单图用户证据、截图后 review 冻结及终态清理。
- Completion guard 测试覆盖 plan、两次 capture、中间 review/refinement、仅生图未写画布和 raster 主导的可编辑 composition 拒绝。
