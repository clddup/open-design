# ADR-0058：Auto Layout Auto Gap v1

状态：已接受
日期：2026-08-13
范围：

- 文档协议：`DesignDocument 1.17.0`
- Layout Service：Auto Layout contract v5
- EditorRuntime、Inspector 与内置 Agent

## 背景

固定 gap 能表达紧凑列表和节奏稳定的组件，但导航、工具栏、分栏标题等响应式结构还需要把容器剩余空间自动分配到子项之间。Figma 的公开语义把这种模式称为 Auto gap，并在 Plugin API 中映射为主轴 `SPACE_BETWEEN`。OpenDesign 采用同类用户行为，但继续由自己的文档、纯函数 Layout Service 和事务持有事实。

## 决策

`AutoLayoutFlow.primaryAlignment` 从 `start | center | end` 扩展为 `start | center | end | space-between`。数值 `gap` 继续保存 Packed 模式的稳定值；`space-between` 表示 Auto gap，因此切换回固定模式不会丢失先前的数值 gap。`1.16.0 → 1.17.0` 只升级协议版本，不把任何既有对齐猜成 Auto gap。

Auto gap 的确定性求解规则为：

- Fixed 主轴把扣除 padding 和子项尺寸后的非负剩余空间平均分给相邻间隙；不足时 gap 为 `0`，子项允许按稳定顺序溢出但不重叠；
- 单个或零个可见子项的 Auto gap 为 `0`，单个子项位于主轴起始 padding；
- Hug 主轴没有可分配的额外空间，按 `0` gap 计算 Hug 尺寸；
- 主轴 Fill 先按既有 bounded water-filling 消费可用空间，Auto gap 只分配 Fill 后仍剩余的空间；
- Horizontal Wrap 用 `0` gap 确定贪心分行，再按每一行自己的子项总宽和可用宽度独立求 Auto gap；单项行从起点开始；`counterGap` 仍是显式数值，不被主轴 Auto gap 改写；
- hidden child 继续退出流，Min/Max、padding minimum、nested convergence 与 Auto Height Text 重测沿用同一 Runtime 链。

Inspector 在既有 Auto Layout 区提供“固定 / 自动”间距模式。自动模式禁用数值 gap 并隐藏无效的主轴 Packed 对齐；切回固定模式恢复数值输入并确定性使用 `start`。Agent 继续使用 `opendesign_arrange_layers action=set-auto-layout`，以 `primaryAlignment=space-between` 提交语义，不提交派生坐标。

## 边界

本切片不实现 Wrap 的 counter-axis Auto gap、Vertical Wrap、Wrap+Fill、baseline、负数固定 gap、ignore-layout/absolute child、grid、canvas spacing handles、SVG Auto Layout metadata、Instance resize 特例或 macOS/Windows 打包 GUI 实机证据。能力继续保持 `degraded`。

## 验证

- schema 与迁移覆盖新主轴值、counter-axis 拒绝和 `1.16.0` 无发明升级；
- Layout Service 覆盖横/纵 Fixed、Hug、单项、overflow、Fill 后剩余空间与逐 Wrap row 求解；
- Runtime 覆盖增删、隐藏、resize、重排、undo/redo 和保存重开；
- Inspector 覆盖固定/自动切换、禁用态与保留数值 gap；
- Agent strict schema、真实坐标派生、单 revision/history 与通用 apply 旁路拒绝均有自动化；
- capability manifest、engine baseline、fixture 和生成文档共同记录 `DesignDocument 1.17.0` 与 Layout Service contract v5。
