# ADR-0028：Agent 设计生成过程与文档事实分离

- 状态：Accepted
- 日期：2026-08-11
- 文档协议：不变（`DesignDocument 1.8.0`）
- 关联：ADR-0009、ADR-0016、ADR-0018、ADR-0020
- 参考：OpenPencil `449f31dd8b7df12965f65d9da774597332fc153d`、Figma First Draft / Version History

## 背景

用户需要看到设计逐步成形，而不是长时间等待后突然出现一整版结果。单纯在聊天区显示“正在设计”不能证明画布实际发生了什么；反过来，把 Provider 的流式 token、未闭合 JSON 或未校验节点直接写进文档，又会产生无效层级、脏历史、失败残留和第二份事实状态。

OpenPencil 的固定源码并不是把 Provider 的半截输出逐 token 写入正式文档。`batch_design` 保持一次 batch 的原子应用，过程感来自 orchestrator 的多批 apply、scaffold/cleanup 阶段、节点 reveal、stagger 和 Agent cursor。Figma 的生成结果同样以可编辑设计和历史 checkpoint 为事实边界。OpenDesign 采用“有效阶段 + 可丢弃展示”的原则，但不复制 OpenPencil 的文档、renderer、Agent runtime 或任意路径工具。

## 决策

### 正式阶段只来自已校验事务

模型仍只提交 typed design commands。Renderer 在执行较大的 Agent 事务时，从当前 revision 开始按原命令顺序寻找最短优选前缀，并对每个候选调用 `EditorRuntime.preview()`：

- 三条及以下的事务保持一个原子提交，避免拆开 asset/node 等本应共同成立的小事务；
- 较大事务优先先提交一个命令，后续每批优先三个命令；候选前缀若破坏层级、Boolean operand、asset 引用或其他文档 invariant，就继续扩展，直到该阶段本身是合法文档；
- 每个成功阶段都是普通 Agent `DesignTransaction` 和单调 revision，不存在绕过 Runtime 的画布写入；
- 同一工具调用的阶段共享一个 `historyGroupId`，完成后只形成一个 undo；中途取消或阶段失败会通过 `rollbackHistoryGroup()` 恢复开始前文档，不保留可见半成品；
- pan、zoom、选区和窗口尺寸不是文档 revision，不能让进行中的 Agent 写目标失效。

这是一组可见、各自有效的提交，不是把一个非法事务“播放”出来。Provider partial JSON、推理文本和未执行的工具声明永远不能成为阶段来源。

### Leafer reveal 是可丢弃展示

Renderer 只从已提交的 `document.changed` 事件派生 reveal，并且必须同时满足：revision actor 是 Agent、`ChangeSet` 含当前 Page 的新增节点。新增节点按活动 Page 树的父级优先顺序排列，再交给 Leafer adapter 展示：

```text
有效 Agent revision
  → ChangeSet 新增节点
  → 父级优先的 reveal schedule
  → 短暂线框
  → 节点淡入为当前 revision 的最终外观
```

reveal ID、时间、线框、临时 opacity 和 animation frame 不进入 `DesignDocument`、revision、history、selection、Project 文件或 Conversation journal。Leafer 场景仍只是当前 revision 的投影；展示结束后不留下另一份节点状态。

普通批次使用短 lead、wireframe 和 fade。密集批次把最多 48 个视觉节拍压缩在约 1.6 秒的 stagger span 内，不能按一千个节点逐个等待几十秒。当前只对新增节点做 reveal；现有节点的属性更新会随有效阶段出现，但尚不做 transform/paint tween。

### Accepted typed plan 先形成结构骨架

`DesignPlanToolInput version: 2` 在正式写入前声明画板 Page 坐标、尺寸，以及主要区域的稳定 `nodeId`、角色和画板局部 bounds。Renderer 会临时记录 Provider 的 `tool.requested`，但只有 Main 对同一 Run/tool call 返回字段完全匹配的 `tool.completed { status: "accepted" }` 后，才允许 Leafer 在独立 `sky` 层展示骨架。失败、畸形或不匹配结果不会显示未经信任的结构。

骨架使用与 selection 蓝框不同的低透明紫色区域、细虚线和固定屏幕尺寸标签；它不命中、不抢选区，也不会限制用户 pan/zoom。计划画板创建后，骨架切换到权威 Frame transform；声明区域只有在对应 ID 的正式 `Group/Frame` 下出现实际非容器内容后才逐区移除，空容器和嵌套空容器不能冒充完成。Main 同时要求区域根是画板直属、轴对齐并匹配计划 bounds，因此临时结构和正式层级使用同一组稳定 ID/几何。

骨架 ID、标签、填充、虚线和完成状态与 reveal 一样只属于当前 Run 的可丢弃展示。它们不进入文档、revision、history、selection、保存、结构化导出或截图，也不成为另一份可写设计状态。

### 生命周期与可信截图

- 用户启用 Reduced Motion 时不运行节点 reveal；已接受计划仍可显示静态结构骨架，避免丢失进行中状态。
- Design File/Page 切换、Run 终态、手动停止、Renderer/adapter 错误和 adapter dispose 都必须结束展示、恢复投影 opacity 并移除线框/骨架。
- 用户在生成期间仍可 pan/zoom；viewport 变化不取消 reveal，也不改变事务作用域。
- `capture_canvas` 在编码前强制结束展示并等待一次绘制帧，确保模型看到可复核的最终 revision，而不是半透明节点或 Agent 线框。
- SVG 等结构化导出继续直接读取权威文档，不序列化展示状态。

## 当前范围与后续阶段

本 ADR 当前完成两个阶段：

1. 文档有效的渐进提交、新增节点 wireframe/fade、取消回滚、单次 undo、终态/错误/切页清理、Reduced Motion 和截图收口；
2. Main accepted typed plan 驱动的 Frame/区域骨架、稳定区域 ID/几何约束、真实内容逐区替换、viewport 同步，以及停止/截图/失败/切页/dispose 清理。

以下仍是明确计划，不作为已实现能力宣传：

1. 展示绑定 Run/Conversation 的 Agent cursor、当前语义阶段和作用域，不借用用户 selection chrome；
2. 对 transform、geometry、paint 和 text update 提供按属性类型设计的过渡，而不是全量 cross-fade；
3. 根据节点量、视口可见性、机器性能和用户设置调整节奏，并完成 macOS/Windows 实机运动与帧时间验收；
4. 为跨多个工具调用的同一 Run 提供更高层 checkpoint/undo 分组，同时保留每个 Design File 的 revision 与冲突语义。

## 后果

- 用户可以在画布上看到 Agent 产物从结构到节点逐步出现，而不是只看到聊天 loading 和最终跳变。
- 正式文档在每个可见阶段都合法，取消后回到开始前状态；视觉过程不会污染保存、导出、截图或历史。
- 过程感不再依赖提示词要求模型“每画一个点提交一次”，也不要求 Provider 支持特定流式格式。
- 当前体验仍不是模拟人手逐点绘制。复杂任务先显示结构骨架，再表现为多个有效批次及其节点 reveal；Agent cursor、属性 tween 和 Run 级 checkpoint 尚未完成。
