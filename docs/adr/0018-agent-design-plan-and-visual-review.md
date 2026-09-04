# ADR-0018：Agent 设计方案、交付目标与视觉审查门禁

- 状态：已接受
- 日期：2026-08-10
- 更新：2026-08-18
- 关联：ADR-0007、ADR-0012、ADR-0013、ADR-0014、ADR-0015

## 背景

仅要求 Agent 在写入后截图，不能阻止低质量的首稿路径。模型仍可能跳过构图规划，把复合设计拆散到 Page 根层，或把生成图片铺满画布后叠加一个通用不透明矩形和文案。该问题不局限于海报：Web/UI 也可能退化为重复圆角卡片、边框和背景色的方块拼接。

单目标的 plan/review 门禁还允许另一种提前结束：用户要求一套页面或多个方案，模型只完成一个局部，满足一次写入、截图、审查、修改和最终截图后就口头宣布完成。完成判断必须覆盖用户请求的全部交付物，并能在中断后恢复，而不是依赖模型 prose。

## 决策

Agent 新建设计内容前必须先读取文档，再调用 `opendesign_define_design_plan`。本 ADR 建立的 fidelity 当前由 ADR-0096 的 `DesignPlanToolInput version: 6` 继续承载；version 2/3/4/5 只为历史 tool input、journal、恢复和旧 generation presentation 兼容保留。计划是 Main 持有的当前 Run 状态，不是第二份设计文档，也不改变 revision。

### 设计 brief 忠实度是计划和审查的共同契约

仅验证目标数量、结构和视觉质量，不能阻止 Agent 在视觉重设计中凭空增加产品能力、替换信息架构或改写交互含义。Plan v5 因此增加 `briefFidelity`：

- `requiredContent` 固定最新用户请求必须出现的内容与交付要求；
- `preservedSemantics` 固定 inspection 中默认保留的产品功能、信息架构、标签和交互语义；
- `prohibitedAdditions` 明确禁止未经请求的新能力、新入口或语义替换；
- `assumptions` 只记录继续执行所必需且可审查的假设。

视觉风格、构图、氛围、参考产品或“更高级”等审美要求不授权新增、删除、重命名或重定义产品能力，只有用户明确要求才能改变这些语义。空白概念设计可以没有既有 `preservedSemantics`，但仍必须声明所需内容和禁止的越界扩张。

`opendesign_record_visual_review` 同步要求 `briefFidelity` 结论，逐次对照最新用户请求和当前 Plan 检查遗漏、错误替换与擅自发明；发现偏差必须进入可执行 `refinements`。影响 brief 的 Plan amendment 会保留已落地 `targetId/pageId/frameId/region nodeId`，同时把材料 target 降回 `drafted` 并清除旧 capture/review 证明，要求重新截图、审查、精修和验证。宿主不尝试用关键字规则猜测产品语义，避免把单个反馈固化成特例。

### Page 作用域不牺牲 Design File 全局 ID 正确性

Node、Component 等稳定 ID 在整个 Design File 内唯一，但 Page Mutation Target 的 inspection 不得为了让模型避碰而泄漏其他 Page 的结构和内容。每次可信 inspection 因此返回 `idAllocation v1`，其中 `newNodeIdPrefix` 是从可信 Run ID 派生的有界、Run-scoped namespace。模型在 Plan、compact first slice 和后续事务中创建的 Frame、region、layer、Component 与图片节点都必须使用该前缀；既有 inspection ID 保持原样。

Main 在 Renderer 写入前验证 create Plan 的画板/区域/组件声明以及 material insert/replace/image 节点。缺失或错误前缀返回 `design_workflow.new_node_id_namespace_required`，不会让跨 Page 隐藏节点的冲突下沉为 `design.duplicate`。旧 Renderer inspection 没有 `idAllocation` 时保持只读恢复兼容，但当前生产 inspection 必须返回与当前 Run 匹配的 namespace；从另一个 Run 复制的前缀视为无效 inspection。

语义步骤需要在窗口被原生文件选择器遮挡、最小化或暂时失焦时继续提交和响应取消。主 BrowserWindow 因此关闭 Chromium `backgroundThrottling`；该设置不增加固定动画 delay，generation reveal/cursor 仍是有界展示状态并在 Run 终态清理。这样 Renderer 的双帧 paint checkpoint 与 250ms fallback 不再因窗口计时器被节流而放大到 90 秒 Main idle timeout。

完整 `DesignChangeSet` 继续进入可信 journal、诊断、undo/history 与 UI diff，但 Provider 不需要在每个步骤后重新读取每个新增节点的完整 before/after 样式、文字和几何。Agent Runtime 的模型投影会识别版本化 change set，只返回 document/revision、稳定 added/changed/removed ID 列表、各类 change detail 数量、semantic committed steps、warnings 和 delivery 状态。该投影不改可信 tool result、持久证据或工具执行语义，只删除下一轮模型已经通过自己的命令和稳定 ID 知道的重复节点快照，避免多次 apply 把上下文与 Provider 处理时间线性放大。

### 按用户需求建立 `1..N` 个 target

计划按用户实际请求声明 `1..N` 个稳定交付 target：

- 单个 Logo、海报、页面或其他单项设计只建立一个 target。
- 用户明确要求一套页面、多个方案或多项物料时，逐项建立对应 target。
- target 是可独立验收的交付物；按钮、标题、装饰和内部区域只是该 target 的 region/layer，不得被滥拆为 target。
- Agent 不得擅自扩张单项需求，也不得把明确的一套需求折叠为一个局部。

所有 target 共享 deliverable、视觉系统、输出模式和 raster policy；每个 target 分别固定 `targetId`、label、objective、目标 Page、Frame/Artboard 的 Page 坐标及尺寸、构图方向、信息层级、间距节奏、asset integration、带稳定 `nodeId` 和局部 bounds 的主要区域、可编辑图层、实现步骤与验收项。target、Frame 和 region ID 在一个计划中全局唯一。

Page Mutation Target 只能计划该 Page；Document Mutation Target 可以计划当前检查结果中同一 Design File 的多个 Page。跨 Design File/Project target 仍不属于本决策的已实现范围。

所有 deliverable 默认使用 `editable-composition`。`single-raster` 只允许一个 target，并且必须声明 `final-single-image` 角色且不包含组件候选；是否属于单张扁平图片交付由 Agent 根据当前用户需求判断，不再复制用户原话并由宿主做脆弱的字符串匹配。图片生成和放置必须复用计划声明的 role；生成结果不能自行成为完成证据。

新图层必须位于所属 target 的计划 Frame 内。`artboard.mode=create` 的首个创建事务必须按计划位置和尺寸创建轴对齐的 Page-root Frame，并同时包含至少一个非容器的真实可编辑内容层；不能先把空画板写进正式文档，再承诺由后续调用填充。create target 的每个声明区域必须使用原 `nodeId`，以计划 bounds 创建为画板直属、轴对齐的 `Group` 或 `Frame`；当该区域首次进入事务时，同一事务必须在其子树内包含至少一个非 `Group/Frame` 的真实内容层。Main 只为 create target 编译画板/区域结构节点的 Page、parent 和父级局部几何。

`artboard.mode=existing` 的 region 则是逻辑规划、进度和视觉审查区域，不是要求既有文档物化的第二套图层树。模型不得为了匹配 region ID/bounds 而创建、移动、缩放或重挂载真实容器；Main 也不得把同名新节点强制改写为画板直属精确 Group/Frame。existing target 只要求写目标经真实祖先链到达权威 Frame，并在最终结构中存在实际材料内容。两种模式下同一计划 ID 都不得重复或冒用 target 画板 ID；画板建立后只平移真实顶层 Frame 时，纯新增事务可在 Renderer 重新验证稳定 ID、尺寸、轴对齐和当前祖先链后安全 rebase，resize、rotate/skew、reparent、delete、跨 Page 或覆盖既有节点仍要求重新 inspect。一个操作不能跨 target 移动、组合或删除必需根节点。

`artboard.mode=existing` 不得仅把 `artboardEstablished` 置真后等待本 Run 自己创建后代。Main 必须消费同一 Run 最近一次 `inspect_document` 返回的当前 Renderer revision，校验目标确为计划 Page 内的 Frame，并从每个节点的真实 `parentId`/`childIds` 建立完整后代集合。后续插入和图片放置可以进入画板直属层或任意既有/本 Run 新增后代容器；错 Page、缺失/非 Frame、断裂父链、循环和过期 inspection 必须在写入前明确失败并允许重新 inspect/改正计划。设计锁是人工直接操作约束，不会把已授权 Page 内的锁定既有容器从 Agent 数据写入范围中移除。Renderer 对 existing target 不显示待物化 region 紫框，只保留真实 Frame 范围和语义执行状态，避免逻辑区域被误认为选区或必须补造的图层。

### 持久交付账本与宿主验收

Main 为计划建立持久 `DesignDeliveryLedger v1` 并写入 Global Task。每个 target 分别按以下状态推进：

```text
pending → drafted → captured → reviewed → refined → verified
```

宿主只依据成功设计写、权威 document revision、确定性 Frame capture 和结构化 review 推进状态。Main 在首次实质写入后的新截图到达后冻结下一次设计写入，直到 Agent 调用 `opendesign_record_visual_review`。Review 必须分别描述 composition、hierarchy、typography、asset integration、form/surface、effects，并给出至少两项具体修改。

Material write、capture 与 review 记录权威 document revision。只有成功写入后、且 `capture_canvas.observedRevision` 不早于最近 material revision 的未消费截图才能进入 review。计划 Frame 建立后固定渲染该 Frame，否则渲染绑定 Page；Renderer 使用 captured revision 的独立 Leafer 投影，不读取活动 tab 的 viewport。baseline capture 可以辅助规划，但不能冒充 post-write capture；pan、zoom、选区、全屏、窗口尺寸和切换 Design File 不改变 document revision、Run mutation target 或审查图片。

最终 capture 后，Main 从同一 Renderer/EditorRuntime 隐式读取精确 captured revision 的权威结构。两种模式共同验证计划 Frame 位于正确 Page；create target 继续验证每个计划 region 是画板直属 Group/Frame 且其子树含非空实际设计节点，existing target 则验证真实画板后代中存在材料内容，不要求逻辑 region ID/bounds 物化。

空 Frame、空 Group、错误挂载或旧 revision 不能进入 `verified`。任一 target 未 verified 时 completion guard 返回准确下一步并在同 Run 继续，不要求用户反复发送“继续”；全部 verified 才允许完成。UI 从可信 tool result/durable task 显示 `N/M verified` 和当前 target，而不是从模型自由文本猜测进度。

中断任务的 ledger 保留在 WorkspaceStore。后续同 Conversation、同 Design File 的新 Run 在检查当前文档后可以复用稳定 target/Page/Frame，从首个未完成项恢复；缺失根节点回到 pending，不能证明仍是当前 revision 的旧状态安全降级为 drafted。已完成目标进入模型上下文时只保留有界结构摘要，原始 journal 不删除。Provider 超时后由 Main 自动创建替代 Run 不在本决策的当前实现内。

Renderer 只在收到 Main 对同一 tool call 的 `accepted` 结果后，才把计划投影为可丢弃的 Frame/区域骨架；version 3 在活动 Page 显示当前未完成 target，version 2 历史结果继续兼容。未经确认的 Provider tool request 不能单独触发画布展示。正式区域根及其实际内容到达后逐区替换骨架，具体生命周期见 [ADR-0028](0028-agent-generation-presentation.md)。

生成图片参与新建的可编辑 composition 时，最终结果还必须包含有意义的可编辑文字、矢量、形状、控件或信息层；不能只放置一张 raster 后结束。UI 同样必须在计划中说明 grid、density、typographic hierarchy、state、form 与 depth，重复 card/rectangle 不能被当作完整视觉语言。

Review 前置条件失败使用稳定 `design_workflow.material_write_required / capture_required / capture_revision_invalid / delivery_verification_required / delivery_structure_incomplete` 恢复指令。模型不得原样重试同一 review。普通可恢复门禁反馈进入 journal/日志但默认不堆叠为右侧红色失败卡；Run 最终无法恢复时，终态和诊断继续对用户可见。

Renderer 与 Main 共同消费一个 workflow failure classifier；同一错误的恢复阶段、是否为普通可恢复反馈和 Timeline 呈现不得再由多套正则分别判断。历史 `component_strategy_incomplete` 仍可从 journal 读取并显示正确恢复阶段，但 ADR-0072 已停止在新最终 capture 中逐节点抛出该错误；当前检查一次返回 `blocking:false` 组件质量报告。组件工具的 `create-component` 统一使用 `rootNodeId` 表示被提升的既有 Frame/Group，并要求精确的 `action / label / pageId / rootNodeId / componentId / name`；action-specific 校验失败必须向模型返回缺失字段、意外字段与完整最小调用形状，不能只返回顶层 schema mismatch。`apply_transaction` 使用同一原则：模型可见 schema 允许省略的无操作外观字段必须在可信边界确定性补齐，仍然无效的 command 必须返回 `commandId / nodeId / path / message`，不能让模型围绕泛化的“arguments do not match”盲重试。

Timeline 把模型文字与可信产品状态分开。包含真实 text block 的 assistant message 始终作为对话内容保留，即使后续仍发生工具调用；Provider 明确返回的 reasoning summary 按 Run 收集，无论它来自纯 reasoning message 还是同时带正文的 assistant message，都只投影成一个稳定、默认折叠的摘要入口，不能冒充执行进度或在每条正文下重复。“真实设计步骤”只来自已提交 semantic step revision。组件定义、Variables 与其他可能不改变像素的文档元数据 revision 使用各自准确标题，不得显示成“画布已更新”。

设计事务违反 `EditorRuntime` invariant 时，`AgentEvent 3.6` 的可恢复 `tool.failed` 保留每项 `commandId / nodeId / path / message`、稳定 fingerprint、是否可原样重试，以及固定 `inspect-and-revise` 恢复动作。TypeBox 的 discriminated union 错误必须按节点 `kind` / command `type` 展开到最接近的具体字段，不能只返回顶层 `Expected union value`；`update_properties` 在 Runtime 内先把 patch 合并到真实目标节点，再按完整 `DesignNode` 校验，因此给 `Group` 写 paint、给 Text 写非法 geometry 等错误会在 revision 前绑定到真正负责的 command/node/path。失败事务保持原 revision，不生成部分历史；成功执行当前文档 inspection 后才解除设计写冻结。可信 Run binding、协议或基础设施损坏仍按不可恢复终态处理。

Agent 的单节点 `insert_element` 必须把 `node.childIds` 视为空的派生字段，父子关系只由有序 child command 的 `parentId/index` 建立。为了兼容模型仍预声明未来 child ID 的输入，Renderer 在可信边界验证每个 ID 都对应更晚且 parent 匹配的 insert command，再规范为空；缺少对应命令、顺序错误或 parent 不一致会在 revision 前返回明确可恢复错误。模型 insert/replace 还可以省略确定性无操作外观：共享 Shape 的 `fills/strokes` 默认为 `[]`、`strokeWidth/cornerRadius` 默认为 `0`、Frame `clipsContent` 默认为 `false`、Image `cornerRadius` 默认为 `0`；模型显式值始终优先。`pointCount`、`innerRadius`、文字排版、图片资源与矢量几何等有业务含义的字段不得猜测。`replace_subtree` 的完整子树仍保留显式 `childIds` 契约。

## 结果

- 方案、交付账本与审查成为可验证工具轨迹，不再只是模型 prose。
- Main 阻止无方案新建、未声明图片角色、错误 Page/Frame 几何、create 区域漂移、根层散落、首次空画板/空区域 revision、空壳交付、跨 target 写入和未审查 refinement，同时不会把 existing 逻辑 region 误当成必须重构的物理图层。
- 原始 DesignDocument 仍只有 `EditorRuntime` 一个可写事实源；计划和 review 是 Run 状态，持久 ledger 只记录交付证据与恢复位置，不保存第二份可写节点树。
- 该门禁提高过程与完整性质量，但不声称自动证明审美优秀。真实 macOS/Windows 像素基线、专业人工验收和后续独立 design critic 仍是更高层证据。

## 验证

- Tool contract 测试覆盖 version 5 的 brief fidelity、Run-scoped new-node namespace、组件策略、一个/多个 target、target/Page/Frame/region 字段、重复/保留 ID、单图 target 上限、反模式与图片 role；version 2/3/4 历史输入继续可读。
- Main coordinator 测试覆盖无计划拒绝、Page/Document scope、一个与多个 target、计划节点全局 ID 唯一、existing Frame 权威 inspection/后代解析、既有锁定容器、existing 逻辑 region 不改写真实层级/几何、create 可信结构几何编译与区域层级/bounds、首次空画板/空区域拒绝且 ledger 保持 pending、空 region 最终拒绝、根层散落、跨 target 操作拒绝、图片 role、capture target、revision 顺序、持久账本与中断恢复。Renderer 测试另覆盖 insert childIds 规范化、顶层 Frame 平移后的纯新增 rebase，以及 resize 时拒绝沿用旧布局条件。
- Contract/Runtime/Agent/Renderer/bridge 测试覆盖模型无操作外观缺省、带 semantic steps 的 fill-only Shape 事务、discriminated union 具体字段、kind-incompatible property patch、准确 command/node/path、失败零 revision、模型结构化 tool result、journal/Timeline/诊断复制、重新 inspection 后恢复，以及相同失败输入不重复执行。
- Completion guard 测试覆盖 plan、两次 capture、中间 review/refinement、`N/M` 未完成拒绝、全部 verified 完成、仅生图未写画布和 raster 主导的可编辑 composition 拒绝。
