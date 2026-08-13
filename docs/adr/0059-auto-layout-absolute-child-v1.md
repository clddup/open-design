# ADR-0059：Auto Layout Ignore Flow / Absolute Child v1

状态：已接受
日期：2026-08-13
范围：

- 文档协议：`DesignDocument 1.18.0`
- Layout Service：Auto Layout contract v6
- EditorRuntime、Inspector、Leafer 直接操作与内置 Agent

## 背景

徽标、悬浮按钮、关闭图标、装饰层和叠加控件需要保留在 Auto Layout Frame 内，但不应挤压 flow siblings。Figma 的公开语义把这一能力称为 “Ignore auto layout”，Plugin API 使用 `layoutPositioning: AUTO | ABSOLUTE`；absolute child 仍是 Auto Layout Frame 的直属 child，可使用明确几何和 constraints，但退出 flow sizing。

OpenDesign 采用同类用户行为，但文档、求解、事务、保存和恢复仍由自有契约持有，Leafer 只投影当前 revision。

## 决策

`DesignNode.layoutPositioning?: "absolute"` 是可选严格字段：省略表示普通 flow/default，避免在全部旧节点上持久化冗余 `auto`。它只允许出现在 Auto Layout Frame 的直属 child；`1.17.0 → 1.18.0` 只升级版本，不发明 absolute child。

- 切为 absolute 时保留当前局部 x/y/width/height，原子清除作为 parent-flow child 的 `layoutSizing` 与 `layoutLimits`，并可同时设置普通 Frame constraints；若该 child 自身也是 Auto Layout Frame，后续仍可为其自身 Hug/Fixed 求解重新设置 container limits；
- 切回 flow 时原子清除 `layoutPositioning` 与 constraints，以缺省 Fixed sizing重新加入 child order；不猜测历史 Fill/limits；
- Layout Service v6 显式接收 `positioning: flow | absolute`，Hug、Fill、Auto gap 与 Wrap 只消费 flow children；absolute child 不贡献 Frame Hug；
- Fixed 或 Hug parent 尺寸变化后，EditorRuntime 用普通 constraints 求解 absolute child；默认 Left/Top 保留局部位置；
- flow child 的直接画布 geometry 仍拒绝，absolute child 可直接 move/resize；Inspector 在同一 Layout 区显示“忽略自动布局”、X/Y/W/H 与 constraints，flow child 的 X/Y 禁用；
- `opendesign_arrange_layers action=set-layout-positioning` 是 Agent 唯一切换入口。通用 apply、insert 和 replace 不得直接写 positioning；模型只提交稳定 Page/node ID、意图和可选 constraints，宿主派生回流几何；
- disable Auto Layout 或 reparent 离开 flow 时清除失效 positioning；undo/redo、save/reopen、preview/apply 和 revision conflict 共用唯一事务链。

v1 继续沿用 translation-only 边界。Group/Boolean 可以退出 flow并保留手动几何，但不能使用 resize constraints；Instance 与 Auto Size Text 只允许不会改变尺寸的约束组合。

## 边界

本切片不实现旋转/倾斜 absolute child、负 gap、counter-axis Auto gap、Vertical Wrap、Wrap+Fill、baseline、grid、canvas spacing/reflow handles、SVG Auto Layout metadata、Instance resize 特例或 macOS/Windows 打包 GUI 实机证据。能力继续保持 `degraded`。

## 验证

- schema、迁移与 invariant 覆盖合法层级、translation-only、与 sizing/limits 的互斥；
- Layout Service 覆盖 flow 排除、Hug、Auto gap 和 Wrap；
- Runtime 覆盖保位切换、Fixed/Hug parent constraints、disable/reparent、undo/redo 和 save/reopen；
- Inspector、画布 move/resize、Agent strict action、通用旁路拒绝和零 revision 失败均有自动化；
- capability manifest、engine baseline、fixture 和生成验证共同固定 `DesignDocument 1.18.0` 与 Layout Service contract v6。
