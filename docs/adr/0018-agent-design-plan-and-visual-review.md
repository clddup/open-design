# ADR-0018：Agent 设计方案、画板与视觉审查门禁

- 状态：已接受
- 日期：2026-08-10
- 关联：ADR-0007、ADR-0012、ADR-0013、ADR-0014、ADR-0015

## 背景

仅要求 Agent 在写入后截图，不能阻止低质量的首稿路径。模型仍可能跳过构图规划，把复合设计拆散到 Page 根层，或把生成图片铺满画布后叠加一个通用不透明矩形和文案。该问题不局限于海报：Web/UI 也可能退化为重复圆角卡片、边框和背景色的方块拼接。底层已经支持 Path、渐变、混合、阴影、光晕、模糊、图片与文字；缺失的是写入前的可执行设计意图，以及截图后的结构化视觉批评。

## 决策

Agent 新建设计内容前必须先读取文档，再调用 `opendesign_define_design_plan`。计划是 Main 持有的当前 Run 临时状态，不是第二份设计文档，也不改变 revision。它固定：

- deliverable、目标 Page、一个明确 Frame/Artboard 及尺寸；
- 构图方向、信息层级、间距节奏与 asset integration；
- palette、typography、form language、surface/depth、effects 与明确反模式；
- 可编辑图层、raster asset roles、实现步骤与渲染验收项。

所有 deliverable 默认使用 `editable-composition`。`single-raster` 只在计划携带当前用户消息中的精确摘录，且摘录本身明确要求单张扁平图片时接受。图片生成和放置必须复用计划声明的 role；生成结果不能自行成为完成证据。新图层必须位于计划 Frame 内，首个创建事务必须按计划尺寸创建该 Frame，后续 Page-root 散落写入被拒绝。

Main 在首次实质写入后的新截图到达后冻结下一次设计写入，直到 Agent 调用 `opendesign_record_visual_review`。Review 必须分别描述 composition、hierarchy、typography、asset integration、form/surface、effects，并给出至少两项具体修改。Runtime 完成门禁固定顺序为：

```text
inspect → define plan → material draft → capture → visual review
        → concrete refinement → final capture → completion
```

生成图片参与新建的可编辑 composition 时，最终结果还必须包含有意义的可编辑文字、矢量、形状、控件或信息层；不能只放置一张 raster 后结束。UI 同样必须在计划中说明 grid、density、typographic hierarchy、state、form 与 depth，重复 card/rectangle 不能被当作完整视觉语言。

## 结果

- 方案与审查成为可验证工具轨迹，不再只是模型 prose。
- Main 在执行前阻止无方案的新建设计、未声明图片角色、错误 Page/Frame、根层散落和截图后未审查的继续写入。
- 原始 DesignDocument 仍只有 `EditorRuntime` 一个可写事实源；计划和 review 随 Run 终态释放。
- 该门禁提高过程质量，但不声称自动证明审美优秀。真实 macOS/Windows 像素基线、专业人工验收和后续独立 design critic 仍是更高层证据。

## 验证

- Tool contract 测试覆盖 plan/review 字段、边界、反模式与图片 role。
- Main coordinator 测试覆盖无计划拒绝、计划 Page、首个 Frame、嵌套图层、根层散落、图片 role、单图用户证据、截图后 review 冻结及终态清理。
- Completion guard 测试覆盖 plan、两次 capture、中间 review/refinement、仅生图未写画布和 raster 主导的可编辑 composition 拒绝。
