# ADR-0156：Figma-compatible Auto Layout 画布间距手柄

- 状态：Accepted
- 日期：2026-08-25
- DesignDocument：不变（`1.47.0`）
- Layout Service：不变（contract `11`）
- 扩展：ADR-0053、ADR-0056、ADR-0058、ADR-0093、ADR-0153

## 背景

OpenDesign 已能在 Inspector 和 Agent 中设置 Auto Layout padding、固定/自动 gap 与 Wrap counter gap，但用户必须离开画布才能调整最常用的空间参数。Figma 在选中 Auto Layout Frame 后通过画布上的粉色 spacing controls 调整 padding 与 gap；`Shift` 使用 big nudge，`Option/Alt` 同步对边 padding，`Option/Alt + Shift` 同步四边 padding。

这类交互不能在 pointer move 时连续写入文档，也不能把 Leafer overlay 当成第二份设计事实。手柄必须只是当前 document/revision 的可丢弃投影，pointer up 才能通过现有 Auto Layout planner 形成一次可撤销事务。

## 决策

### 画布投影

选中单个、未锁定、轴对齐且已启用 Auto Layout 的 Frame，并处于 Select 工具时，`@opendesign/leafer-engine` 在 editor sky 中投影：

1. linear、Wrap 与 Grid Frame 的 top/right/bottom/left padding 手柄；
2. Horizontal/Vertical linear flow 的固定 gap 手柄；
3. Horizontal Wrap 每个 row 的固定主轴 gap 手柄，以及相邻 rows 的固定 counter gap 手柄。

手柄只在指针进入所选 Frame 或拖动期间显示。其屏幕命中区、线宽和数值标签不随 zoom 变细，不进入 `DesignDocument`、history、save、capture 或 export。超过 512 个 flow children 时保留四边 padding，省略密集 gap 手柄；Inspector 继续是完整数值入口。

当前公共 Grid 文档只明确通过右栏字段编辑 row/column gap，因此本切片不自行发明 Grid gap 画布手柄。旋转/斜切 Frame 也暂不显示轴向手柄，避免把屏幕方向错误映射为 Frame-local spacing。

### 手势语义

- 普通拖动按 Frame-local 1 px 取整；`Shift` 按 10 px big nudge 取整。
- padding 拖动只改当前边；`Option/Alt` 同时设置对边；`Option/Alt + Shift` 同时设置四边，并继续使用 big nudge。
- 所有值遵守当前非负、有界 Auto Layout 契约。
- `primaryAlignment: space-between` 不显示固定主轴 gap 手柄；Wrap `counterAxisAlignContent: space-between` 不显示固定 counter gap 手柄。画布拖动不得静默把 Auto spacing 改成固定 spacing。
- pointer cancel、Escape、选区/工具切换、document/revision 变化和无位移拖动都产生零写入。

拖动期间只更新可丢弃手柄与数值预览。pointer up 发出 `{ frameId, expectedRevision, semantic change }`，不传 child 坐标或 Leafer 对象。Renderer 再读取当前权威 Frame，校验 exact revision，并调用既有 `planSetFrameAutoLayout → EditorRuntime.apply`；成功只产生一个 revision 和一个 undo entry。

### 未纳入本切片

Figma 的单击手柄数值输入、绑定 number variable 后的 detach 提示、旋转 Frame 手柄、Grid row/column gap 手柄、Smart Selection 普通对象间距/reflow 以及 Auto spacing 的 Between/Around/Evenly 扩展继续独立实现。它们不能通过复用当前拖动回调伪装完成。

## 后果

- 高频 padding/gap 修改可以留在画布完成，并与 Inspector、Agent、保存和布局回流共享同一事实。
- overlay 不增加模型请求、截图、审查或动画延迟，也不会降低 Agent 首个真实页面速度。
- exact-revision 请求阻止长拖动覆盖用户或 Agent 的并发修改；过期手势提示用户基于当前 Frame 重试。
- 当前没有持续的 React pointer-move 文档投影；这避免高频 Runtime/React 重算。后续若增加真实内容 live preview，必须留在 Leafer disposable projection 中，并继续只在 pointer up 写一次事务。

## 验证

- 纯几何测试覆盖 Horizontal、Vertical、Wrap、Grid padding、固定/自动 gap、锁定、旋转与不安全 child transform。
- Leafer adapter 测试覆盖 editor-sky 投影、Shift big nudge、Alt 对边、Alt+Shift 四边、一次 semantic callback、Escape、no-op 和 stale revision。
- Renderer controller 测试覆盖 exact revision、单事务、单 undo、Runtime reflow 与过期请求零写入。

## 参考

- [Figma Learn：Use the horizontal and vertical flows in auto layout](https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout)
- [Figma Learn：Guide to auto layout](https://help.figma.com/hc/en-us/articles/360040451373-Explore-auto-layout-properties)
- [Figma Plugin API：itemSpacing](https://developers.figma.com/docs/plugins/api/properties/nodes-itemspacing/)
- [Figma Plugin API：counterAxisSpacing](https://developers.figma.com/docs/plugins/api/properties/nodes-counteraxisspacing/)
