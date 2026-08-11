# ADR-0018：Agent 设计方案、交付目标与视觉审查门禁

- 状态：已接受
- 日期：2026-08-10
- 更新：2026-08-11
- 关联：ADR-0007、ADR-0012、ADR-0013、ADR-0014、ADR-0015

## 背景

仅要求 Agent 在写入后截图，不能阻止低质量的首稿路径。模型仍可能跳过构图规划，把复合设计拆散到 Page 根层，或把生成图片铺满画布后叠加一个通用不透明矩形和文案。该问题不局限于海报：Web/UI 也可能退化为重复圆角卡片、边框和背景色的方块拼接。

单目标的 plan/review 门禁还允许另一种提前结束：用户要求一套页面或多个方案，模型只完成一个局部，满足一次写入、截图、审查、修改和最终截图后就口头宣布完成。完成判断必须覆盖用户请求的全部交付物，并能在中断后恢复，而不是依赖模型 prose。

## 决策

Agent 新建设计内容前必须先读取文档，再调用 `opendesign_define_design_plan`。当前模型契约为 `DesignPlanToolInput version: 3`；version 2 只为历史 tool input、journal 和旧 generation presentation 兼容保留。计划是 Main 持有的当前 Run 状态，不是第二份设计文档，也不改变 revision。

### 按用户需求建立 `1..N` 个 target

计划按用户实际请求声明 `1..N` 个稳定交付 target：

- 单个 Logo、海报、页面或其他单项设计只建立一个 target。
- 用户明确要求一套页面、多个方案或多项物料时，逐项建立对应 target。
- target 是可独立验收的交付物；按钮、标题、装饰和内部区域只是该 target 的 region/layer，不得被滥拆为 target。
- Agent 不得擅自扩张单项需求，也不得把明确的一套需求折叠为一个局部。

所有 target 共享 deliverable、视觉系统、输出模式和 raster policy；每个 target 分别固定 `targetId`、label、objective、目标 Page、Frame/Artboard 的 Page 坐标及尺寸、构图方向、信息层级、间距节奏、asset integration、带稳定 `nodeId` 和局部 bounds 的主要区域、可编辑图层、实现步骤与验收项。target、Frame 和 region ID 在一个计划中全局唯一。

Page Mutation Target 只能计划该 Page；Document Mutation Target 可以计划当前检查结果中同一 Design File 的多个 Page。跨 Design File/Project target 仍不属于本决策的已实现范围。

所有 deliverable 默认使用 `editable-composition`。`single-raster` 只允许一个 target，且计划必须携带当前用户消息中的精确摘录，摘录本身明确要求单张扁平图片。图片生成和放置必须复用计划声明的 role；生成结果不能自行成为完成证据。

新图层必须位于所属 target 的计划 Frame 内，首个创建事务必须按计划位置和尺寸创建轴对齐的 Page-root Frame，后续 Page-root 散落写入被拒绝。每个声明区域必须使用原 `nodeId`，以计划 bounds 创建为画板直属、轴对齐的 `Group` 或 `Frame`；同一 ID 不得重复，也不得冒用任何 target 的画板 ID。一个操作不能跨 target 移动、组合或删除必需根节点。

`artboard.mode=existing` 不得仅把 `artboardEstablished` 置真后等待本 Run 自己创建后代。Main 必须消费同一 Run 最近一次 `inspect_document` 返回的当前 Renderer revision，校验目标确为计划 Page 内的 Frame，并从每个节点的真实 `parentId`/`childIds` 建立完整后代集合。后续插入和图片放置可以进入画板直属层或任意既有/本 Run 新增后代容器；错 Page、缺失/非 Frame、断裂父链、循环和过期 inspection 必须在写入前明确失败并允许重新 inspect/改正计划。设计锁是人工直接操作约束，不会把已授权 Page 内的锁定既有容器从 Agent 数据写入范围中移除。

### 持久交付账本与宿主验收

Main 为计划建立持久 `DesignDeliveryLedger v1` 并写入 Global Task。每个 target 分别按以下状态推进：

```text
pending → drafted → captured → reviewed → refined → verified
```

宿主只依据成功设计写、权威 document revision、确定性 Frame capture 和结构化 review 推进状态。Main 在首次实质写入后的新截图到达后冻结下一次设计写入，直到 Agent 调用 `opendesign_record_visual_review`。Review 必须分别描述 composition、hierarchy、typography、asset integration、form/surface、effects，并给出至少两项具体修改。

Material write、capture 与 review 记录权威 document revision。只有成功写入后、且 `capture_canvas.observedRevision` 不早于最近 material revision 的未消费截图才能进入 review。计划 Frame 建立后固定渲染该 Frame，否则渲染绑定 Page；Renderer 使用 captured revision 的独立 Leafer 投影，不读取活动 tab 的 viewport。baseline capture 可以辅助规划，但不能冒充 post-write capture；pan、zoom、选区、全屏、窗口尺寸和切换 Design File 不改变 document revision、Run mutation target 或审查图片。

最终 capture 后，Main 从同一 Renderer/EditorRuntime 隐式读取精确 captured revision 的权威结构，验证：

- 计划 Frame 位于正确 Page；
- 每个计划 region 是画板直属的 Group/Frame；
- 每个 region 子树至少包含一个非空实际设计节点。

空 Frame、空 Group、错误挂载或旧 revision 不能进入 `verified`。任一 target 未 verified 时 completion guard 返回准确下一步并在同 Run 继续，不要求用户反复发送“继续”；全部 verified 才允许完成。UI 从可信 tool result/durable task 显示 `N/M verified` 和当前 target，而不是从模型自由文本猜测进度。

中断任务的 ledger 保留在 WorkspaceStore。后续同 Conversation、同 Design File 的新 Run 在检查当前文档后可以复用稳定 target/Page/Frame，从首个未完成项恢复；缺失根节点回到 pending，不能证明仍是当前 revision 的旧状态安全降级为 drafted。已完成目标进入模型上下文时只保留有界结构摘要，原始 journal 不删除。Provider 超时后由 Main 自动创建替代 Run 不在本决策的当前实现内。

Renderer 只在收到 Main 对同一 tool call 的 `accepted` 结果后，才把计划投影为可丢弃的 Frame/区域骨架；version 3 在活动 Page 显示当前未完成 target，version 2 历史结果继续兼容。未经确认的 Provider tool request 不能单独触发画布展示。正式区域根及其实际内容到达后逐区替换骨架，具体生命周期见 [ADR-0028](0028-agent-generation-presentation.md)。

生成图片参与新建的可编辑 composition 时，最终结果还必须包含有意义的可编辑文字、矢量、形状、控件或信息层；不能只放置一张 raster 后结束。UI 同样必须在计划中说明 grid、density、typographic hierarchy、state、form 与 depth，重复 card/rectangle 不能被当作完整视觉语言。

Review 前置条件失败使用稳定 `design_workflow.material_write_required / capture_required / capture_revision_invalid / delivery_verification_required / delivery_structure_incomplete` 恢复指令。模型不得原样重试同一 review。普通可恢复门禁反馈进入 journal/日志但默认不堆叠为右侧红色失败卡；Run 最终无法恢复时，终态和诊断继续对用户可见。

设计事务违反 `EditorRuntime` invariant 时，`AgentEvent 3.6` 的可恢复 `tool.failed` 保留每项 `commandId / nodeId / path / message`、稳定 fingerprint、是否可原样重试，以及固定 `inspect-and-revise` 恢复动作。失败事务保持原 revision，不生成部分历史；成功执行当前文档 inspection 后才解除设计写冻结。可信 Run binding、协议或基础设施损坏仍按不可恢复终态处理。

## 结果

- 方案、交付账本与审查成为可验证工具轨迹，不再只是模型 prose。
- Main 阻止无方案新建、未声明图片角色、错误 Page/Frame 几何、区域漂移、根层散落、空壳交付、跨 target 写入和未审查 refinement。
- 原始 DesignDocument 仍只有 `EditorRuntime` 一个可写事实源；计划和 review 是 Run 状态，持久 ledger 只记录交付证据与恢复位置，不保存第二份可写节点树。
- 该门禁提高过程与完整性质量，但不声称自动证明审美优秀。真实 macOS/Windows 像素基线、专业人工验收和后续独立 design critic 仍是更高层证据。

## 验证

- Tool contract 测试覆盖 version 3 的一个/多个 target、target/Page/Frame/region 字段、重复/保留 ID、单图 target 上限、反模式与图片 role；version 2 历史输入继续可读。
- Main coordinator 测试覆盖无计划拒绝、Page/Document scope、一个与多个 target、existing Frame 权威 inspection/后代解析、既有锁定容器、区域层级/bounds、空 region 最终拒绝、根层散落、跨 target 操作拒绝、图片 role、capture target、revision 顺序、持久账本与中断恢复。
- Agent/Renderer/bridge 测试覆盖 invariant issue 的 command/node/path 保留、失败零 revision、模型结构化 tool result、journal/Timeline/诊断复制、重新 inspection 后恢复，以及相同失败输入不重复执行。
- Completion guard 测试覆盖 plan、两次 capture、中间 review/refinement、`N/M` 未完成拒绝、全部 verified 完成、仅生图未写画布和 raster 主导的可编辑 composition 拒绝。
