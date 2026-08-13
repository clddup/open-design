# ADR-0057：Auto Layout Min/Max 与 Padding Minimum v1

状态：已接受
日期：2026-08-13
范围：

- 文档协议：`DesignDocument 1.16.0`
- Layout Service：Auto Layout contract v4
- EditorRuntime、Inspector 与内置 Agent

## 背景

Fixed/Hug/Fill 与 Horizontal Wrap 已能表达基础内容流，但专业响应式组件还需要在内容变化、父容器 resize 和 Fill 分配时限制可接受尺寸。例如按钮需要最小点击宽度，正文列需要最大阅读宽度，卡片需要最小高度。Figma 把 min/max 作为轴向 sizing 的附加边界；OpenDesign 采用同类公开语义，但仍由自有文档、Layout Service 和事务持有事实。

## 决策

`DesignNode.layoutLimits` 是严格、非空、可选的 `{ minWidth, maxWidth, minHeight, maxHeight }`，每项为 `0..1_000_000`，且同轴 `min <= max`。它只允许出现在 Auto Layout Frame 或直属 flow child；同一嵌套 Frame 同时作为父 flow child与自身 flow container 时，共用一组 limits。`1.15.0 → 1.16.0` 只升级版本，不发明限制。

Fixed/Hug/Fill 先产生候选尺寸，再应用 limits：

- Fixed child 与 Wrap child 先 clamp 后参与排布；
- Hug Frame 按 clamp 后的可见 child 求内容尺寸，再 clamp Frame；
- Fill main axis 使用确定性 bounded water-filling，先固定低于均分值的 max，再重算均分，最后固定高于均分值的 min；min 总和大于可用空间时允许确定性 overflow；
- cross-axis Fill 同样 clamp；
- Frame 的左右或上下 padding 总和是不可压缩的硬下限，优先于 Frame max；
- Auto Height Text 在 limits/Fill 改变宽度后由固定 Text Layout provider 重测，再让祖先 Hug 有界收敛。

关闭 flow 或 reparent 离开 flow 时清理失效 child limits；节点自身仍是 Auto Layout Frame 时保留。Planner、通用文档 invariant 与 Agent 旁路共同失败封闭，非法作用域或反转区间零 revision。

Inspector 在 Layout 区显示 Min/Max Width/Height，空值表示未设置，清空最后一项删除 `layoutLimits`。Agent 使用 `opendesign_arrange_layers action=set-layout-limits`，只提交稳定 Page/node ID 与 limits/null，子层最终几何由宿主 preview 后以单一事务应用。

## 边界

本切片不实现 Vertical Wrap、Wrap+Fill、auto gap、baseline、aspect ratio、ignore-layout/absolute child、grid、canvas reflow handles、SVG Auto Layout metadata、Instance resize 特例或 macOS/Windows 打包 GUI 实机证据。能力继续保持 `degraded`。

## 验证

- schema、公共 guard、迁移与 invariant 覆盖空对象、未知字段、值域、反转区间和非法作用域；
- Layout Service 覆盖 Fixed/Hug clamp、padding minimum、bounded Fill、Wrap 与 malformed request；
- Runtime 覆盖 nested convergence、Auto Height Text、preview/apply、undo/redo/reopen、disable/reparent 清理；
- Inspector 覆盖四项输入、键盘/blur 提交与清空；
- Agent strict schema、执行结果和通用 apply 旁路拒绝均有自动化；
- capability manifest、engine baseline、fixture 和生成文档共同记录 `DesignDocument 1.16.0` 与 Layout Service contract v4。
