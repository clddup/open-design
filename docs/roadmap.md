# OpenDesign 路线图

本路线图按架构依赖组织，不按临时反馈逐项追加。完整产品边界由 [`design-capability-baseline.md`](design-capability-baseline.md) 定义；每个实施切片必须同时覆盖公共语义、事务、人工 UI、Agent、渲染/导出、持久化和验证。

## 执行与验收模型

路线图中的能力只有在以下链路全部打通后才能标记完成。单独增加 schema、属性面板控件、Agent 提示词或 Leafer 映射都不构成产品交付。

```text
schema → migration → EditorRuntime → 人工 UI → Agent tool →
provider adapter → 渲染/导出 → 保存重开 → undo/redo → 自动化与实机验证
```

每个垂直切片必须保存可重放的输入、`.opendesign` 文件、关键事务或诊断 ID、渲染截图、导出产物、平台信息和验收结果。自动化结构测试证明数据链路，Electron 截图证明实际渲染，人工交互验收证明工具可用；三类证据不能彼此替代。

### 固定专业验收集

| 样张 ID         | 工作流          | 必须证明的能力                                                                                                                                       |
| --------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OD-PENGUIN-01` | 原创矢量吉祥物  | Path/Vector 可见；主体、翅膀、脚和织物使用自由轮廓；复合对象属于一个命名 Group；图层选择、保存重开、undo/redo 一致                                   |
| `OD-POSTER-01`  | 复杂活动海报    | 1440×1024 画板；企鹅主体、标题和副标题；多渐变、描边、阴影、光晕、模糊、blend、mask 与图片组合；Agent 完成两次视觉检查和中间修正；最终产物可专业导出 |
| `OD-BRAND-01`   | Logo 与品牌图形 | Pen 节点编辑、布尔运算、flatten、outline stroke、精确对齐；SVG 导入导出往返后结构和外观保持                                                          |
| `OD-UI-01`      | 多尺寸 UI 页面  | constraints、auto layout、grid、组件实例、Variant、Token/Variable、富文本与图片；改变容器尺寸和变量模式后得到确定性布局                              |
| `OD-SCALE-01`   | 大规模真实文档  | 万级节点、复杂图片和效果下的增量投影、选择、pan/zoom、Agent 连续 revision、资源释放、内存与帧时间基准                                                |

P0 阶段先验收 `OD-PENGUIN-01` 和 `OD-POSTER-01` 的当前可用子集。后续阶段扩展同一批样张，不为新能力重新创建无法比较的一次性演示。

## 项目级架构与模块治理（持续轨）

治理按完整业务所有权逐步执行，不按行数机械拆分，也不一次性重写画布、Agent 或 Runtime。`pnpm architecture:check` 已进入根 verify，固定 Electron 目录边界、20 个 workspace 包的生产依赖 DAG、新模块 800 行默认上限和 28 个历史大模块的只减不增预算；边界变更必须更新 ADR 与机器基线，不能为了通过门禁隐藏依赖。

- [x] Phase 1：从 Renderer `App.tsx` 提取完整 Import/Export feature 和共享诊断模块。feature 自己拥有 SVG/PNG/JPEG/WebP 设置、operation/feedback、互斥、AbortController、原生命令订阅、切出 editor/unmount 取消和诊断；操作开始时读取唯一 EditorRuntime 的最新 snapshot，不复制文档状态。`App.tsx` 当前从 3278 行降至 2882 行，定向 feature/App/Properties 测试覆盖行为。
- [x] Phase 2：Agent Conversation 已拆为纯 durable/live Timeline projection、受控 Composer view 与每 Conversation controller。Timeline 继续独占“贴近底部才跟随”的滚动语义；controller 独占 draft、附件、模型选择、submit/stop，并用 Conversation epoch 丢弃切换后迟到的附件选择、导入和提交结果。可见历史、模型上下文和文档 revision 仍是三条独立事实链，没有新增会话或文档镜像状态。`AgentTimeline.tsx` 从历史 1994 行降至 555 行，新模块均低于 800 行门禁；竞态、审批、取消、历史单调合并和自动滚动已有定向测试。
- [x] Phase 3：Page、Layer 与 editor command controllers 已提取到 `renderer/features/editor`。所有命令在执行时读取唯一 `EditorRuntime` 的最新 snapshot，并经同一 `runtime.apply` 写入 revision/history；Page controller 拥有 create/rename/duplicate/reorder/delete，Layer controller 拥有 capability derivation、duplicate/group/Boolean/reorder/reparent/arrange，view 只消费语义回调且没有 UI mirror store。`App.tsx` 从 2882 行降至 2222 行，定向 controller 测试和完整 Desktop 测试覆盖单事务、selection 与 undo 行为。
- [x] Phase 4：PropertiesPanel 已按 Appearance、Text、Image、Component、Export 的业务事务边界拆分。顶层只组合 selection、arrangement、operation feedback 与受控 section；section 接收当前权威 `DesignNode` 和语义 callback，Paint/Effect/Text/Image/Component override 不缓存文档副本，Export 设置仍由 `useImportExportWorkflow` 独占。`PropertiesPanel.tsx` 从 2973 行降至 374 行，8 个 section/shared 模块均低于 800 行门禁；原 PropertiesPanel 历史预算已移除，现有 Inspector/App 测试覆盖文本约束、图片 placement、Paint/Effect、Component override、SVG/raster export 与多选排列。
- [ ] Phase 5：按 inspection、plan/review、hierarchy/layout、vector、image、component、import/export tool family 拆分 `design-agent-tools`，公共 schema/version 与执行语义保持一致。
- [ ] Phase 6：拆分 Main bootstrap、窗口生命周期和 IPC registration；Preload 继续只暴露小型类型化能力，Windows/macOS 行为共用窄 adapter。
- [ ] Phase 7：按 command executor、diff/history 与领域 planner 协作边界收缩 EditorRuntime 聚合模块。
- [ ] Phase 8：拆分 Leafer mapping、interaction、reconcile、generation presentation 与资源生命周期；Leafer 仍只是可丢弃投影。
- [ ] Phase 9：按 parse、normalize、fidelity、filter/mask/text/vector 与 serialize family 收缩 SVG 聚合 service。

每阶段先锁定现有行为，迁移完整状态与取消/错误生命周期，补定向测试，再运行全仓 verify 并独立提交。Phase 1 只建立治理方法和首个切片，不代表剩余大模块已完成。规范见 [ADR-0046](adr/0046-project-module-boundaries-and-incremental-governance.md)。

## P0-A：macOS 与 Windows 一级平台可用

当前仓库已配置 `.github/workflows/native-desktop.yml`：macOS 与 Windows 原生 runner 分别执行共享 `pnpm verify`、目标平台 protected build/安装包、产物内容校验，并直接启动打包后的 `OpenDesign.app` / `OpenDesign.exe` 执行无窗口 Agent smoke；不启动开发 Electron 入口。原生 workflow [31384519288](https://github.com/clddup/open-design/actions/runs/31384519288) 已在两个平台通过并上传产物，macOS arm64 也已在本机生成未签名 DMG/ZIP。自动化 packaged smoke 不能替代干净安装、签名、升级/卸载和人工 GUI 产品 smoke，下面的完整 P0-A 发布门禁仍未完成。

- [x] 建立 macOS 与 Windows 原生 CI/发布矩阵；共享 `pnpm verify`，并分别在原生 runner 构建 protected bundle 和安装包。V8 bytecode 不跨操作系统复用。
- [x] macOS 产出 DMG/ZIP，Windows 产出 NSIS installer；Windows 使用 assisted installer 并允许用户选择安装目录。历史 workflow 已证明产物生成与包内容，但当前配置仍需最新 Windows 原生产物复验。
- [ ] 分别验证干净安装、安装目录选择、首次启动、升级覆盖、卸载和用户数据保留策略。
- [ ] 两个平台共同执行：窗口/菜单/快捷键、Leafer 画布鼠标与触控板/滚轮、文本输入、文件选择、Project 保存重开、Agent utilityProcess、`safeStorage`、附件、Provider 调用、取消和崩溃恢复 GUI smoke。当前只完成打包程序的无窗口 Agent smoke。
- [ ] 审计并移除只在 macOS 成立的路径、菜单、图标、快捷键和 shell 假设；平台差异通过窄 adapter 处理。
- [ ] Windows 安装后产品 smoke 未通过前，不得把桌面版描述为跨平台可发布。Linux 保留目标和构建边界，但当前不阻塞此里程碑。

完成条件：macOS 与 Windows 的同一 commit 都有 `verify + native package + install/start/product smoke` 证据，并写入 `verification.md`。

## P0-B：稳定 Leafer 迁移与 Agent 主流程

- [x] 修复 Agent 骨架/光标在用户观察生成过程时拖动画布产生双重 viewport 的实机时序：删除第四个独立 presentation canvas，把不可命中的 skeleton/cursor Group 放入 Leafer 内置 editor `sky` 且位于 Editor selection child 下方；按 `sky⁻¹ × tree/screen` 投影，并在真实 child render 前幂等复核 tree/sky 的最终 transform。自动化不替代 macOS/Windows 打包触控板和鼠标实机验收。
- [x] 为 host-only `put_asset + insert_element(image)` 内部事务补 Renderer 集成测试，验证单次 revision、Page/Selection scope 和一次 undo 同时移除 asset/node。
- [x] 为 Agent composer 的剪贴板粘贴和文件拖放补交互测试，验证 Renderer 通过窄 Preload API 提交 bytes，最终 run 只携带安全附件元数据；纯文本路径粘贴不被拦截或提前读取。
- [x] 让 HTTP(S) 图片读取的超时和取消覆盖完整 body stream，而不只覆盖 response headers；慢 body、流式超过 16 MB 和用户取消已有自动化回归。
- [x] 为生产模型流增加首响应、流空闲和总时限 watchdog；超时或 Agent 进程退出必须解除 Conversation 的 active Run，返回可重试错误并 abort Main-owned fetch。
- [x] 为生产 Provider 流增加 Main-owned 有界自动重连：HTTP 200 后 SSE body `terminated`、`Connection error`、提前 EOF 和其他明确 `retryable` 的连接失败，在首次请求后最多重连 5 次，并用同一条 `正在重新连接 N/5` 状态覆盖展示。每次 Provider turn 的语义事件先缓冲到 terminal，失败 attempt 的半截文字、推理和 tool call 全部丢弃，避免重复执行；取消、确定性 4xx/context 等不可重试失败和三类精确 watchdog timeout 不进入重连。见 ADR-0043。
- [x] 修复 Provider 流失败后 partial message 光标残留：`agent.error` 立即收口同 Run 的 message/tool/approval 活动态，Renderer 保留 run-to-conversation 关联直到随后的 `run.completed` 完成历史刷新；新 Run 只能保留自己的一个活动光标，无 run ID 的进程终态也会防御性回收孤儿活动项。
- [x] 启动时终结 JSONL 中未完成的 Run/pending tool，并同步恢复 Global Task；新 Run 和后续 Agent 活动更新 Conversation `updatedAt`，最近活动会话立即置顶且重启后顺序一致。
- [x] 修复生产设计工具 schema 被 model bridge 尺寸守卫静默拒绝的问题；完整工具契约必须穿过真实跨进程守卫测试，请求/响应拒绝与畸形 Agent 事件必须返回可见终态并解除 Run。
- [x] 将 `AgentRequest 3.6` 的发送时选区上下文与单一 Mutation Target 分离；默认写目标冻结为发送时活动 Page，用户之后改变选区或活动页面不缩小、不漂移该 Run 的事务目标；Main 另行注入可信 Model Profile 上下文预算，Renderer 不得伪造；SVG 附件使用独立 run-scoped handle，不冒充 Provider 图片或文档上下文。
- [x] 建立 Main-owned 结构化诊断 JSONL 与大小轮转；错误通过 Conversation/Run/Request/Tool Call ID 关联到右下角通知，并可一键复制。Agent 对话仅在用户贴近底部时自动跟随消息、流式增量和工具状态，上翻查看历史时不强制回底。
- [x] 将 Provider Catalog 升级到只管理对话模型的 v3，并建立独立 `GlobalImageGenerationSettings v1`：生图服务拥有自己的启用状态、adapter、Base URL、鉴权、凭据和用户模型 ID，不受 Conversation Provider/Model 影响；`generate_image` 结果进入内容寻址附件并由 `place_image` 通过唯一事务放入画布。旧 v2 生图选择确定性迁移后从 Catalog 剥离。
- [x] 建立跨设计类型的 Agent 质量流程门禁：新建 UI、海报、Logo、插画和品牌物料必须先提交 typed design plan，固定 Frame/Artboard、构图、排版、形态语言、surface/depth、asset role 与反模式；首张 capture 后必须提交 typed visual review 才能 refinement。Main 阻止无计划新建、Page-root 散落、未声明 raster role、默认整图替代可编辑 composition，以及未审查截图后的继续写入。
- [x] 建立第一阶段 Agent 画布生成过程：三条以内保持原子，大事务按 `EditorRuntime.preview()` 选择文档有效的连续阶段并共享单一撤销组；已提交 Agent 新节点按父级优先执行有界 wireframe/fade reveal。取消回滚、Run 终态/错误/切页清理、Reduced Motion 和 `capture_canvas` 最终态截图已有自动化证据；展示状态不进入文档、history、selection 或导出。
- [x] 建立第二阶段 Agent 画布结构过程（历史实现，生产展示已由 ADR-0049/0050 取代）：最初的 `DesignPlanToolInput version: 2` 声明单画板位置/尺寸和稳定区域 ID/bounds，version 3 继续兼容并在当前 Page 投影首个未完成 target；当时只有 Main 匹配接受的计划才能在 Leafer 内置 editor `sky` 的不可命中底层显示 Frame/区域 skeleton。该紫色 skeleton 现已从生产流程撤销，accepted Plan 改为一次事务分配真实 Frame roots；本条仅保留历史验证事实，不能解释为当前仍展示计划骨架。
- [x] 建立第三阶段 Agent 语义过程：accepted plan 后才显示独立紫色 Agent cursor 与本地化阶段标签；位置先锚定待完成区域，再只跟随已提交 Agent revision 的新增节点 focus point。typed tool name/结构化 progress 驱动 `structuring/building/assets/reviewing/refining/recovering`，不展示 Provider 自由文本；完成态清除旧百分比和 live/durable timeline progress detail。cursor 不命中、不借用 selection，支持 pan/zoom、离屏隐藏、180 ms 低频位移、Reduced Motion、`aria-live`、停止/截图/终态/错误/切页/dispose 清理，并继续与正式文档分离。
- [x] 将 material write → capture → visual review 门禁绑定到权威 revision，而不是视口或选区状态：baseline/pre-write、重复和早于最近 material revision 的截图分别返回稳定 `design_workflow.*` 恢复指令；系统提示禁止原样重试，live/durable 时间线默认折叠可自动恢复的门禁失败。pan、zoom、全屏、窗口尺寸和选择变化不改变 revision/mutation target。
- [x] 将视觉审查从活动 viewport 迁移为绑定 Run Mutation Target/计划 Frame 的确定性离屏 Leafer 渲染：Main 选择已建立的计划 Frame，否则选择绑定 Page；Renderer 按 captured revision 导出 content tree，不包含 selection/skeleton/cursor/reveal。用户在生成期间切换 Design File、pan、zoom、resize 或查看其他区域只能改变本地视图，不能改变 Agent 收到的审查画面、revision 或 mutation target。
- [x] 为离屏视觉审查补齐真实阶段进度和独立导出硬上限：创建 surface、创建 adapter、同步场景、开始/完成导出、导入附件分别上报阶段；Leafer JPEG export 30 秒未完成即释放临时 surface 并返回可恢复 capture failure，不再等待 Main 90 秒 idle watchdog。stale node 越界与已落地 Plan amendment 冲突改为结构化 inspect-and-revise，明确保留 target/Page/Frame/region 稳定 ID，并抑制原样重试与 Timeline 红卡堆叠。
- [x] 修复语义步骤在 Electron 暂停 `requestAnimationFrame` 时卡满 90 秒：前台仍等待真实绘制帧，窗口后台、遮挡或 GPU 暂停 RAF 时每帧最多等待 250ms 后继续；该 fallback 不写文档、不播放假步骤、不增加正常前台延迟，取消仍立即中止。
- [x] 打通单目标 Run 的多 Design File 后台执行：每个打开文件保持一个权威 `EditorRuntime`，Renderer 按可信 `documentId` 路由工具并在 Run 期间 retain 文件。A 的写入/capture 不刷新 B，也不把 A 的生成 overlay 投到 B；切回 A 直接显示最新 revision。跨文件多目标 Run 仍按 ADR-0006 保持未实现，不把此能力扩大宣传为跨文件原子事务。
- [x] 为 Project Design File 建立按稳定 Project/File/Document 身份绑定的自动保存：人工事务以 500 ms debounce 落盘，同一文件的保存串行化且保存期间产生的新 revision 会继续 drain；只有落盘响应身份/revision 匹配当前目标才 checkpoint。Agent 设计写入在工具成功返回模型前立即 flush 对应文件，后台 A 不保存或刷新当前 B；窗口关闭或应用退出前 flush 全部 pending 文件。Main 把资源销毁延后到 `will-quit`，macOS 在异步 flush 后恢复原退出意图，Windows 走同一生命周期状态机。失败保持 dirty，并通过 `design_autosave_failed` 诊断通知用户。独立打开的外部 `.opendesign` 文件仍使用显式 Save/Save As，不静默覆盖。
- [x] 打通 Project Design File 的真实重命名：编辑器 tab 双击或 `F2` 进入内联编辑，`Enter`/失焦提交、`Escape` 取消，失败保留输入以重试；请求只携带稳定 Project/File ID 与规范化名称。Main 通过 manifest-only journal 原子更新 descriptor，不改 `designFileId`、`documentId`、relative path、画布 revision、history 或 dirty 内容；与 autosave 共用 Project mutation queue，允许同名文件，macOS/Windows 共享交互与测试。
- [x] 打通 Design File 内完整 Page 生命周期：公共事务支持创建、命名、复制、最终位置排序和删除，并产生 Page/node diff、单 revision、preview、undo/redo 与自动保存；复制重映射整棵节点树但共享文档级 assets，删除保留 assets 且禁止删除最后一页。Pages 导航提供 `+`、双击/`F2` 内联命名、Enter/blur/Escape、菜单复制/删除、拖放排序和错误恢复；事务或 undo/redo 删除活动 Page 时回退相邻 Page。`opendesign_manage_pages` 复用同一 planner，宿主生成 ID；Agent 默认 Page 可直接重命名绑定 Page，创建/复制/排序/删除或跨 Page 操作改由一次性 Page 结构授权解锁，不再要求用户发送前选择内部 Design File scope。
- [x] 修复 `artboard.mode=existing` 的既有画板误判：Main 从当前 revision 的 `inspect_document` 结构结果验证 Frame/Page 身份并解析完整权威后代集合，既有锁定 Group/Frame 仍可作为 Agent 数据写入容器，新增图层与图片可进入任意真实后代；existing plan region 只表达逻辑审查范围，不再强制变成精确 bounds 的画板直属 Group/Frame，也不会为了匹配计划 ID 重写真实几何。最终验收验证真实 Frame 后代中存在材料内容与完整 ledger 证据；缺失、错 Page、非 Frame、父链循环和 stale inspection 使用稳定 `design_workflow.inspection_* / existing_artboard_invalid` 恢复码。
- [x] 保留 `EditorRuntime` invariant 的 `commandId / nodeId / path / message`，让 Renderer/Main/Agent journal/诊断 UI 共同返回结构化、可复制的可恢复 tool result；失败事务不写文档、不终结 Run，但 Runtime 会阻止后续设计写，直到成功重新 inspect。相同 fingerprint 与相同输入的盲重试有界并被宿主抑制；可信 Run binding、协议损坏等运行前置失败仍终结 Run。该切片升级为 `AgentEvent 3.6`，旧 journal 中只有 code/message 的失败继续可读。
- [x] 移除 Composer 常驻“当前页面 / 设计文件”写入范围下拉：Run 默认静默绑定当前 Page，只显示低权重 Page/选区上下文；新建/复制/排序/删除 Page 或跨 Page 修改时，模型通过 `opendesign_request_page_structure_access` 请求一次性“将修改 Untitled 的页面结构”授权。Main 精确绑定 `runId + toolCallId + approvalId`，只接受“允许本次/不允许”；批准后清除旧 inspection，并仅为本 Run、当前 Design File 解析 effective document execution context，终态自动回收。绑定 Page rename 不需扩权，拒绝不得重试绕过；Working Set / 原始 Mutation Target / 临时 Capability 不从选区、Project 或彼此静默推导。见 ADR-0029。
- [x] 将 Page 结构审批明确为 Run-scoped approval：首次允许后，同一 Run 的后续 Page 结构 tool call 直接复用已签发能力，不重复弹窗；新 Run 必须重新批准。Main 仍逐次校验权威 Run 能力，模型和 Renderer 都不能自行续期。before-tool 参数/schema、重新 inspection 和重复失败抑制返回结构化可恢复结果，不再压扁为 `Tool call was rejected before execution`；Timeline 折叠模型可自行修正的内部调用，真正的业务失败继续进入诊断和可见错误。
- [x] Renderer 设计工具桥从固定 30 秒总超时改为首响应/活动空闲/15 分钟总时限：Renderer 在 accepted/applying/capturing/persisting 阶段通过窄 Preload 协议续租空闲时限，总时限不可续。三类失败使用 `renderer_first_response_timeout / renderer_idle_timeout / renderer_total_timeout`，Timeline 明确显示画布操作，不再把 Cockpit 已成功的 HTTP 200 误报成模型超时；Provider timeout 只消费结构化 `AgentRunFailure.timeout`。
- [x] 为连续 Renderer 画布停滞增加 Run 级熔断：同一 Run 的 apply/capture 连续两次 timeout 后返回不可重试 `renderer_circuit_open` 并终止当前模型循环；已提交 revision 与 unfinished delivery 保留，completion guard 不续写，durable continuation 进入 needs-attention 而不自动新开 Run。成功画布工具清零，inspect 不掩盖持续 capture 故障，Run 结束/应用关闭清理状态；离屏 Leafer 的 `waitViewCompleted` 在隐藏 surface 不返回时只等待有界 2 秒，随后由同步 export 直接计算并渲染目标树，`renderer_capture_timeout` 同样计入熔断。本项阻止 30/90 秒故障循环，不把未导出的画面伪装成已验收。见 ADR-0052。
- [x] 修复 Agent 审查截图毒化 Leafer 全局异步 export 队列的根因：固定 `@leafer-in/export 2.2.9` 的异步 `UI.export()` 使用包级串行 `TaskProcessor`，一次 `waitViewCompleted/canvasToBlob` 永久挂起后，外层 timeout 无法取消队首任务，后续新 App capture 全部被阻塞。审查 JPEG 现在等待当前离屏 App ready 后走同一 Leafer plugin 的同步 `UI.syncExport`/data URL 管线，并继续由 30 秒 deadline、严格 JPEG/尺寸验证和 Adapter dispose 约束；回归测试证明一个挂起 surface 不会阻塞另一健康 surface。专业交付导出仍保持独立异步 Blob 路径。见 ADR-0054。
- [x] Design Plan 从“首次写入后永久冻结”改为宿主版本化修订：相同 plan 幂等返回，未开始 target 可新增/删除/修改；已落地 target 必须保留稳定 `targetId + Page + root Frame` 与既有 region ID，可修订视觉系统、目标说明和后续步骤。影响已落地目标的 amendment 会把它重新置为 drafted 并要求 capture/review/refinement/verification；accepted plan 紫色骨架已撤销，权威 amendment 改为更新真实 Frame/ledger 与当前 target 活动投影。模型口头完成仍不可信。
- [x] 在 Agent 事务入口只规范 Text 节点 content 中的模型字面量 `\\n/\\r\\n`，不修改 summary、路径、SVG/path 或其他字符串；Windows 绝对路径和显式双反斜杠保持原样。insert/update/replace 都复用同一边界并继续经过完整 DesignNode invariant。
- [ ] 以“首个真实可用 target 时间”而不只是整套完成时间建立 Agent 生成性能切片：真实根分配与语义步骤垂直切片已完成，macOS/Windows 打包产品的固定 `1/4/12` target 性能与交互 smoke 尚未完成，因此总项保持开放。见 ADR-0050。
  - [x] 建立不含 Prompt、设计正文或完整工具参数的 `design_generation_performance_v1` Run 级测量：Main 汇总 Provider turn、typed tool、Renderer 阶段与 canvas wait；`DesignDeliveryLedger v2` 让 `T0` 成为全部真实根进入文档的实测里程碑，未观测到 allocation 时明确记为 unavailable。`1/4/12` target 确定性事件序列验证指标语义，不冒充打包产品性能样本。
  - [x] 用两条 macOS 打包产品单 target 样本验证瓶颈量级：`T1=167.7–201.1s`、Provider 总时间 `270.0–292.8s`，Renderer 7 次工具总计 `3.8–4.0s`，其中固定 delay `1.8–2.1s`。据此撤销 accepted-plan 紫色 skeleton 与默认 100ms 人为 delay；阶段间仍等待真实绘制帧，cursor 只在权威 Frame 落地后出现。该结果不能替代 4/12 target 与 Windows 样本，也不等于 `allocated` 已实现。见 ADR-0049。
  - [x] 完成最小完整垂直切片：Plan 后由 Main 通过同一 Renderer/EditorRuntime/autosave 链一次原子事务分配 `1..N` 个真实稳定 Frame roots；ledger v2 以 allocated 区分空根与 drafted，空根不能 capture/review/verified，全部分配形成一个 revision/undo。材料工具只写 active target，首 target verified 后才推进；图片可直接进入已分配 Frame。apply 可提交覆盖所有 command 的有序语义 steps，Renderer 按完整步骤产生真实 revision，成功后才上送实时 progress，Timeline 由 live/durable `label + revision` 去重重建；无 steps 时整笔一次提交，不再机械按 1～3 条拆。仅平移恢复，resize/reparent/delete/undo 要求 inspect/amend；分配失败保持 pending。见 ADR-0050。
  - [x] 用本机生产 journal 收口无画布进展的恢复放大：`run_1786733759123_1` 在约 46 分钟内产生 585 events / 159 tool requests / 102 failures，其中 67 次不同 `invalid_tool_input`；`T_plan=126.5s / T1=298.2s`，Provider 累计约 2,295 秒而 Renderer 累计约 150 秒，最终组件策略又逐节点 repair。组件声明偏差现一次返回有界 `blocking:false` 质量报告，不再阻塞已通过结构/布局/review 的视觉交付；同一工具 4 次 schema 失败或跨工具 8 次可恢复失败仍无真实 revision 时以不可自动续跑终态停止，任一可信 revision 前进后清零。System prompt 允许安全的 Plan→首个小而真实 draft、review→refinement 在同一 sequential tool turn 提交，并要求先落最小有意义 region，避免整页巨大输入拖住 T1。见 ADR-0072。
  - [x] 将专业工具 catalog 改为 revision 驱动的渐进披露：新 Run 首轮只暴露七个必要工具，模型可见 canonical schema 从约 `148,350 bytes` 降至 `22,369 bytes`（`-84.9%`）；inspection 后只增加 Capability/SVG/Raster Export，十工具仍约 `26,732 bytes`。首稿 apply 从约 `63,924 bytes` 降至 `7,087 bytes`，只提供基础 Frame/Group/Shape/Text/solid paint 与基本写操作。create Plan 的真实空 Frame revision 不提前展开；首个材料 revision、Page lifecycle 写入或 existing-artboard Plan 后恢复完整二十一工具。各视图共用原始 validator、Main host、EditorRuntime、revision、history 和权限；切换时重新计算模型固定协议预算。该静态降幅不能冒充真实 T1 已改善，仍等待打包产品样本。见 ADR-0073。
  - [x] 将普通新建设计改为 Main host-inspected 的 Plan-first 编排：Run 注册后由 Main 通过同一 Renderer inspection/Coordinator/revision 边界预取 exact-revision 有界快照，首个 Provider turn 只暴露 inspect refresh、Plan、显式 read-image 与 Page 授权/生命周期五个工具；create Plan 分配真实 Frame roots 后，第二轮才披露基础 apply/image generation。预检失败回退原七工具路径，Stop 可取消预检，durable user journal 不混入宿主上下文。该切片从正常调用图删除一次 Provider inspection 决策，但仍需打包产品样本证明真实 `T_plan/T1` 收益。见 ADR-0075。
  - [x] 取代 host-inspected 的固定 Plan-only 第二轮：首个 Provider turn 现同时披露约 7 KB 的基础 `apply_transaction`，模型可在同一 assistant turn 按 `Plan → 首个真实 section` 发出两个顺序工具调用。Pi/Main 先完成真实 Frame 分配并推进 revision，再提交材料；Plan 失败、Page approval、必须先看的图片、capture/recovery 等依赖继续阻止错误合并。该切片用少量固定 schema 换取删除一次潜在 Provider 往返，自动化只证明调用图，真实收益仍由打包产品 `1/4/12` target 样本验收。见 ADR-0078。
  - [ ] 使用打包产品各执行固定 `1/4/12` target 场景，保存关联 Run/诊断 ID、平台、模型和冷/热启动条件；至少取得 macOS 与 Windows 的 `design_generation_performance_v1` 样本后，再以分位数判断 Provider、apply wait、capture/review 或 autosave 是否为主要瓶颈。
  - 固定 `1 / 4 / 12` target 基准场景，至少记录 `T_plan`（计划接受）、`T0`（全部稳定真实画板根进入文档）、`T1`（首个 target 出现有意义可编辑内容）、`T2`（首个 target 完成审查与精修）和 `T_all`（全部交付完成）；现状不具备的指标应明确记为不可用，不能用 skeleton/reveal 动画代替。
  - 最小垂直切片只验证“单次可整体撤销的真实根分配 → 首个 target 的连续语义事务 → 首稿/精修两个有意义 checkpoint → 其余 target 延续执行”。导航、Hero、内容区、底栏等步骤必须来自真实事务及其 revision，Timeline/cursor 只消费当前 active target 的提交事件；不得机械按 1～3 条命令拆分或加入固定延迟来制造过程感。
  - Plan amendment 保留已落地 target 的稳定 `targetId/pageId/frameId`；纯平移继续读取当前权威 transform，resize/reparent/delete 等结构变化重新 inspect/replan。中途失败保留有效提交并从失败步骤恢复，或由目标级 history group 整体撤销；每步回传模型的上下文只含步骤摘要与 revision，不重复注入完整文档。
  - 只有分阶段观测证明小批 apply、等待或重复 capture/review 是主要瓶颈后才调整策略；若采用 `allocated`，必须同步设计 completion guard、save/history、恢复、用户并发编辑与 revision rebase，并以新 ADR 取代当前“首事务必须包含真实内容”的约束。
- [x] 将单目标 plan/review 门禁扩展为持久化结构化交付账本：`DesignPlan v3` 按用户实际需求声明 `1..N` 个交付 target；ledger v2 按 `pending → allocated → drafted → captured → reviewed → refined → verified` 推进。allocated 是真实空 Frame 的 revision evidence，不是完成度；宿主以权威文档、精确 revision、capture/review/refinement 证据验收，不信任模型口头“完成”。任一必需 target 未完成时 completion guard 自动续跑，持久任务从首个未完成项恢复，UI 只显示 `N/M verified`。旧 v1 ledger 在持久边界显式迁移。见 ADR-0018、ADR-0050。
  - [x] 修复续跑完成门禁只读取当前 Run `delivery` 的假完成漏洞：成功 inspection 返回的上一 Run `unfinishedDelivery` 现在同样进入 completion guard，未验证 target 会阻止“已完成”文案。模型侧 `insert_element` 不再要求重复易错的 `parentId/childIds/visible/locked/opacity/extensions` 样板字段；Main 在可信边界补齐结构默认值并重新通过完整 `DesignOperation` 校验，内部 Renderer 契约仍只接受规范化完整节点。图片附件继续必须在真实计划 Frame 已落地后由 `place_image` 导入，不能把 attachment ID 冒充 document asset ID 或放宽画板门禁。
  - [x] 将 `N/M verified` 明确降为事实投影而非“任务不会结束”的解决方案，并实现 Main-owned durable continuation scheduler：交付账本仍未 verified 时，Provider timeout、单 Run budget 或模型错误口头完成会自动轮换到新 Run；新 Run 从最新权威 document revision 与持久 `unfinishedDelivery` 恢复，保留稳定 target/Page/Frame ID。continuation 带 `rootRunId/parentRunId/attempt/reason`，最多自动续跑 3 次；取消、不可重试错误和耗尽上限进入 `needs_attention`。Renderer 在 Run 轮换时保留后台 Design File 引用、Conversation 绑定与活动状态，自动提示投影为 system work 而不伪装成用户“继续”。该切片解决“中断后依赖用户继续”和空画布假完成；首个 target 优先、连续真实语义步骤及 `T1/T2/T_all` 提速仍按上面的独立性能切片推进。见 ADR-0047。
  - [x] 收口手动 Stop 与自动 continuation 的竞态：Main 在收到 `run.cancel` 时立即记录用户取消意图，不等待旧 Run terminal；若下一 Run 已 scheduled 但仍在读取文档或注册，阻止其进入 Agent utility process，并投影可信 cancelled terminal。Runtime 丢弃取消后已排队的 Provider retry/recovered，Timeline 在 stopping 状态立即移除模型重试和任务级“重新连接”行，避免用户停止后后台仍继续或界面假装重连。见 ADR-0047。
- [x] 把“空壳首稿”和不透明 union error 前移到正式 revision 之前：新 target 的首个事务必须带真实可编辑内容，当次插入的每个计划区域也必须同时带非容器内容，拒绝时 ledger 保持 pending；模型可见 paint/effect schema 按具体类型声明必需字段，EditorRuntime 对 property patch 合并真实节点后按 `kind` 校验，TypeBox union 展开为具体 field path，Renderer 将 issue 归因到最后一个真正修改该节点的 command。视觉审查继续负责构图与审美，不再作为发现空 Frame/Group 或节点 schema 错误的第一道防线。
- [x] 修复复杂设计在视觉审查后以 budget 提前停止：Run 生成预算只累计 Provider `usage.output`（已含 reasoning），不再把每轮重复 input/context 反复收费；单轮输入继续由可信模型窗口与 compaction 门禁负责，turn/tool/output 三层仍保留防失控上限。Provider 明确返回的有界 `reasoning_summary` 按 Run 合并为默认折叠的低权重“设计过程”，展开后明确它是模型摘要而非系统测试/已执行操作；省略/加密 reasoning 不反推隐藏思维链。
- [x] 将活动 Run 时间线改为 durable-first 单调投影：`message/tool/approval/run` 的 journal checkpoint 在 Run 未结束时也 debounce 回读 `session.history`，完成节点由 durable item 接管；live `message.delta` 按 block 合并、`tool.progress` 按 tool call 覆盖，移除会吞掉旧消息的 200-event 截断。Conversation 切换、长流、重试和历史回读只能补全或更新同 ID 状态，不能让已显示消息消失。
- [x] 收口 Agent `insert_element` 的层级契约：模型输入中的容器 `childIds` 不再和后续 child insert 重复写入，Renderer 在可信事务边界验证每个预声明 child 都有更晚且 parent 匹配的 insert 命令，再把 `childIds` 规范为空；EditorRuntime 只依据有序 child command 的 `parentId/index` 建立层级。缺失 child command 在 revision 前返回可恢复的明确错误，合法父子同批插入不会产生 duplicate child ID。
- [x] 收口 Agent 历史终态与超时表达：新 Run 开始时把旧 Run 的“已达到上下文限制”等 error/budget 终态降为保留审计的中性历史行，不再冒充当前阻塞；Provider 首响应、流空闲、总时限使用独立 watchdog 和结构化 `provider_timeout`，Main/Agent/journal/diagnostic/Timeline 保留具体 phase、阈值、retryable、已知 Provider request ID 与始终可用的本地 model request ID。首响应前拿不到上游 ID 时明确显示 unavailable，不伪造；旧无 failure journal 继续兼容。见 ADR-0030。
- [x] 将 Provider 文本连通与 Agent 工具兼容分开验证：设置页保存后先做文本握手，再要求无副作用的三参数 tool call，严格显示 `compatible / text-only / unreachable`；新自定义 Provider 默认 Chat Completions。OpenAI-compatible Chat 的 `reasoning_content/reasoning/reasoning_text` 不再冒充可见 reasoning summary 或进入 journal，usage token 仍保留；Responses/Anthropic 明确 summary 不受影响。见 ADR-0048。
- [x] 增加稳定 node ID 的属性级 transform/geometry/paint/effect/text/path tween 和自适应 reveal/tween 节奏：只在连续合法 Agent revision 间插值，支持同节点当前显示值 retarget、离屏最终态、Reduced Motion、截图/停止/错误/切页/人工编辑收口，并让新增 reveal 与属性 tween 共用单 RAF；选中节点及祖先的 editBox 同帧刷新，不产生第二份可写状态。
- [ ] 完成上述生成 motion 的 macOS/Windows 打包程序实机运动、触控板缩放、选区 editBox 与帧时间验收；共享自动化不能替代原生 GUI 证据。
- [ ] 前移首个专业位图交付切片：共享实现已从冻结的单选 layer/Frame 与权威 `DesignDocument` 生成 PNG/JPEG/WebP，贯通目标宽/高、1×/2×/3×、透明/明确背景、质量、重采样、进度/取消、人工 Inspector、Agent `opendesign_export_raster`、Main 原生保存与 POSIX/Windows 路径自动化；`capture_canvas` 继续是独立有界审查 JPEG，不能冒充交付。剩余门禁是同一 commit 的 macOS/Windows 打包产品保存框、覆盖、取消、透明与尺寸实测，以及后续批量/Slice/持久配置；见 ADR-0031。
- [x] 把左侧静态 Assets 占位替换为当前 Design File 的真实图片资源面板：权威索引覆盖 Image 与 image paint、多 Page 使用次数、安全预览/搜索/缺失状态、循环定位、只传稳定 asset ID 的画布拖放、Frame 局部坐标、导入、全引用 replace/relink、零引用安全删除、单 revision/undo 和取消/失败零 revision；Renderer 不接收路径，Runtime 继续作为竞态删除门禁。字体、跨文件 Library、授权、派生谱系、批量管理和大资源虚拟列表继续由 P4 完整资源工作台承接。见 ADR-0032。
- [x] 将 Renderer 历史巨型全局 `styles.css` 按组件垂直切片迁移为 `Component.module.scss`：CSS Modules 负责作用域，固定 Dart Sass 负责编译期嵌套/复用，design tokens/reset/应用 shell 保持全局。AssetsPanel、完整 Canvas chrome、LeftSidebar、PropertiesPanel、UtilityDock、Agent Timeline/Composer、DiagnosticNotifications、Statusbar、DesignFileTabs、共享 HomeTitlebar/HomeSurface、WorkspaceHome/ProjectHome、Settings Page/Forms、Titlebar/Toolbar/WindowControls 均已迁出；无引用静态 SVG 样张规则已删除，全局入口从 3562 行收口为 93 行，只保留 reset、Electron no-drag、visually-hidden、App shell、Workspace grid/窄窗口和 Reduced Motion。SettingsPage 的 Provider/Image React state、PropertiesPanel 的 Paint/Effect/Image/Export 与 AgentTimeline 的 timeline/composer 后续只能随业务边界提取，不能为缩短文件建立第二份状态。不得重新拆出互相覆盖的全局 SCSS 或并存运行时 CSS-in-JS。见 ADR-0033。
- [x] 完成确定性布局质检的首个垂直切片：`DesignLayoutQualityReport v1` 从权威文档世界坐标检查 Run 绑定 Frame 的目标身份、无效几何、`clipsContent`、完全越界、1%–25% 部分越界和至少 25% 大面积越界；有界 issue 列表超限时失败关闭。Renderer 用离屏 capture 的同一 revision 生成报告，Main 运行时验证 document/revision/Page/Frame 身份，初次 capture 把 node-specific 结果交给模型 review，refinement 后 error 阻止账本进入 `verified`，warning-only 可继续。pan/zoom/selection/窗口与活动文件不参与报告。安全区、文字 shaping/截断、触控区、重叠、对齐、间距和视觉 critic 仍属于下一切片，不能把本项宣传为审美已解决。见 ADR-0034。
- [ ] 建立独立的设计策略、确定性布局质检与视觉 critic 切片，解决“方块卡片 + 圆形光晕”的模板化收敛以及截图中底部导航活动项越过画板/安全区却通过审核的假阳性。宿主先对画板越界、clipsContent、导航/设备安全区、触控区、重叠、截断、对齐和间距异常做可复现几何门禁；计划再形成可验收的视觉命题、signature motif、造型/图像/字体语言和明确反模板项，capture critic 对独特性、构图张力、类型层级、形态多样性、素材融合与过度重复做结构化评分，refinement 必须落实失败项。提供按 UI/Web、海报、Logo、品牌/插画版本化的内置设计 skills，并允许用户追加不授予权限的自定义 skill；skill 只提供设计策略/参考范式/反模式，不能替代几何门禁、真实 capture 和人工盲评。固定任务基线不能以节点数量、用了渐变/path 或模型自评冒充审美提升。
- [ ] 在本仓库启动的 Electron 实例中复验：Agent 渐进事务期间 pan/zoom/resize 后 Leafer editBox 始终贴合选区，不出现巨大蓝色角、残影或输入锁死。
- [ ] 实机复验复杂渐变/光晕/模糊、属性检查器同步、`capture_canvas` 多模态视觉回读、本地路径/URL `read_image`、全局 GPT Image 2 `generate_image`、粘贴/拖放附件和 `place_image`。
- [x] 将 Leafer revision 同步改为 transaction change set 驱动的 affected-node 增量投影与 reconcile：未变节点不再 `set()`，无关 revision 不再隐藏 Editor、取消直接操作或刷新 tree bounds；选区相关变化只刷新对应元素 bounds，断档/切页/恢复才全量回退。
- [x] 建立人工 UI 与 Agent 共用的层级 planner：支持兄弟层序和 Page root/Frame/Group 跨容器重挂载，保持世界坐标、固定 Frame 尺寸并动态重算 Group bounds；图层树提供 before/inside/after 拖放、明确状态、单 revision/undo 和 macOS/Windows 共享行为测试。
- [x] 建立 P0 持久上下文压缩：原始 journal 不删除，模型投影按完整 run 边界生成累计 `context.compacted` checkpoint，保留近期用户/Agent 摘录、附件元数据、工具统计和最新 design revision；当前轮与旧 journal 的超长工具字段都会被省略，压缩后仍超本地预算则在 Provider I/O 前返回 `context_budget_exceeded`。
- [x] 将固定 system/tool 协议与可压缩 Conversation 投影分账；Main 按所选 Model Profile 注入 `contextWindow/maxOutputTokens`，Agent 对文字、图片、文档、工具与输出预留执行启发式 token 预算，并用 `model_context_incompatible` 区分“模型装不下协议”和用户上下文过长。模型可见 `apply_transaction` Schema 从 314,159 字符压至 25,222 字符，完整运行时校验保持不变。
- [x] 在同一 Run 的每个 Provider turn 前重新预算；旧 assistant/tool 段超限时生成临时有界 checkpoint，保留当前用户原文和最近完整 tool call/result 段。完整展开的二十一个工具、200K Model Profile 与八轮多模态工具循环已证明第八轮会压缩后继续；bootstrap→完整工具切换也会重算 fixed protocol，结构化工具结果同时具有单字段和整体投影上限，原始 journal 不删除。
- [ ] 将通用 Agent loop 迁移到固定 `@earendil-works/pi-agent-core` 的 headless `Agent`，通过 OpenDesign adapter 保留 Main 模型/凭据代理、typed design tools、Conversation journal、revision 和 plan/review 门禁；阶段 0—3 已完成核心、三种 API identity、`AgentEvent 3.8`、唯一 journal、二十一个生产工具、completion guard、取消/结构化失败分流、累计 checkpoint、逐轮压缩、内容寻址多模态/资源句柄和重启恢复。utilityProcess 唯一入口已切为 `OpenDesignPiRuntime`，旧自研循环与旧测试已删除，历史 tool-call ID 会从 journal 预加载以阻止重放执行。当前只剩同一 commit 的 macOS/Windows protected package 和 packaged Agent smoke 门禁，通过后才勾选完成；不得重新引入双循环/fallback。固定 `0.84.1` 的 `AgentHarness.prompt()` 仍抛出 `HarnessNotImplemented`，不得把未实现的 durable harness 接入生产或建立第二份 session 状态。
- [ ] 接入服务端 Model metadata 探测、Provider/tokenizer/image 精确预算和可选语义 compactor；上游仍返回 `context_too_large` 时只允许重新预算和紧急压缩后自动重试一次。
- [ ] 补万级节点、连续 Agent revision、效果/图片节点、选区/editBox、pan/zoom 的真实 Electron 帧时间与内存基准，并据此继续压缩结构 ID 遍历和资源失效成本。

完成条件：全仓 `pnpm verify` 通过，关键 Electron 交互写入 `verification.md`，ADR-0009/0010 的验证项有实际证据。

## P0-C：固定样张与能力事实门禁

- [ ] 使用当前仓库启动的 Electron 实例执行 `OD-PENGUIN-01` 和 `OD-POSTER-01`，保存原始 prompt、最终 `.opendesign` 文件、两次 `capture_canvas`、中间 refinement、截图、Conversation/Run ID 和相关诊断。
- [x] 建立可重放专业样张 fixture：固定 prompt、初稿 `.opendesign`、一次 refinement 事务、最终文档和 SHA-256 manifest 均由确定性生成器维护；`EditorRuntime` 与 Leafer 测试从干净文档验证命名 Group、正式 Path、复杂外观、图片、诊断、保存重开和 undo/redo，不依赖开发会话临时状态。
- [x] 建立无系统文件弹窗的 macOS 源码 Electron fixture smoke：Main 只接受固定样张 ID，在隔离 `home`/`userData` 中启动隐藏窗口；Renderer 通过唯一 Workspace `EditorRuntime` 依次提交初稿、生产 Leafer capture、refinement 和第二次 capture，Main 核对权威最终文档后保存窗口截图、最终 `.opendesign`、DPR、viewport 与 SHA-256 report，并由双层硬超时自动退出。`OD-PENGUIN-01` 与 `OD-POSTER-01` 已在当前 Mac 实机通过；该确定性重放不冒充 live Agent Conversation/Run 重放、打包产物或 Windows 像素 baseline。
- [ ] 为同一 fixture 建立 macOS/Windows 像素视觉 baseline；必须由真实生产 Leafer 画布渲染并记录平台、DPR、字体、截图和允许差异，结构投影测试不能替代像素证据。
- [x] 为 Path、渐变、光晕、模糊、blend、mask、图片和文字建立版本化预检：`inspect_document` 返回实际特性计数，并识别空 Path/文字、不可见或无绘制外观节点、丢失/不受支持的图片 asset、非有限 bounds、完全越出 clipping Frame 和异常根图层碎片；Agent prompt 要求先处理 error 并解释 warning。
- [x] 建立版本化 capability manifest。每项能力记录 `available / degraded / unavailable`、provider、限制、六个产品表面、自动化证据和实机证据；Agent system context、`get_capabilities` tool、生成式帮助文档和发布摘要读取同一 JSON 事实来源，`capabilities:check` 阻止生成物漂移。能力状态不是设置项，不进入设置页。
- [x] 让验证文档的环境/协议版本、测试数量和 Vite 构建产物由 `verification:generate` 从权威源更新，并由 `pnpm verify` 最后的 `verification:check` 阻止漂移；平台发布证据仍只允许在对应原生 runner 或已记录的本机命令完成后人工写入，不能由共享脚本伪造。

`OD-POSTER-01` 的首轮重放 prompt 固定为：

> 创建一张 1440×1024 的未来感企鹅发布会海报。企鹅必须放在一个命名 Group 中，身体、翅膀和脚使用 Path；使用渐变、描边、外光晕和阴影；加入标题和副标题；如需要可调用全局生图模型。完成前必须截图检查、执行一次具体修正并再次截图。

验收人员必须检查 Path 是否真实显示、企鹅是否属于单一上层 Group、图层树与画布选区是否一致，以及 Agent 是否实际执行“写入 → 截图 → 修正 → 截图”。验收期间还必须改变选区、缩放和窗口尺寸，并验证任务目标不漂移、editBox 不残留、undo/redo 和保存重开保持一致。

完成条件：两个样张在当前 macOS Electron 实例通过完整重放；失败项进入 P0 阻塞清单并在继续专业能力开发前修复。Windows 原生重放由 P0-A 的同级平台门禁承接。

## P1：专业能力契约

- 把 P0-C 的初始 capability manifest 提升为版本化公共契约，并为 Renderer、Agent、MCP 和发布说明提供同一只读查询入口。未知能力必须拒绝，降级能力必须返回结构化限制和 fidelity warning。
- 继续按垂直切片迁移专业基础文档版本；`DesignDocument 1.28.0` 已在 Shared Styles 基础上增加正式 Slice 与节点有序 Export Settings、后缀和统一能力门禁，后续仍需分支网络、Auto Layout Grid、Text/Font rich typography、图片 adjustments、nested Slot、画布矩阵重排、跨文件 Library/publishing、批量目录/PDF/P3 与更多 style/variable binding。
- 为 Geometry、Layout、Text/Font、Image 和 Import/Export service 建立窄、版本化的输入输出接口。服务只能返回纯结果、诊断或候选 `DesignOperation[]`，不能保存第二份文档或直接修改 Leafer 场景。
- 提供确定性迁移、未知版本拒绝、保存重开、preview、undo/redo、Agent schema、provider 映射和 fidelity warning 测试；不得把长期语义藏进 `extensions`。

完成条件：能力清单与真实 UI、Agent tool catalog 和 adapter 行为一致；所有 service 接口存在契约测试；未实现能力保持明确 `unavailable`，不能通过占位 JSON 或提示词伪装支持。

## P1-C：组件实例主流程

组件不再等待完整布局/变量阶段。它直接决定多页面 UI、导航、按钮、卡片、表单、表格和 Tabbar 能否保持结构一致，也是 Agent 避免反复复制散图层的主流程能力。

- [x] 完成 `Component → Instance → Override → Reset/Detach` 首个垂直切片：`DesignDocument 1.11.0` 与 Component Service v1 定义 OpenDesign-owned Main、轻量 Instance 和当前 revision 的可丢弃派生 subtree；稳定 `sourcePath`、missing/cycle/schema 诊断和原子 Runtime 命令不依赖 Leafer 对象或深拷贝事实。
- [x] 支持嵌套 Instance 与有界 override：文字、可见性、名称、透明度、blend/mask/effects、fills/strokes 等受支持属性可保持；嵌套 Instance 可交换组件并重新做 cycle 检查。Main 默认值更新会同步，现有 override 合并而不互相覆盖。破坏性源图层 delete/reparent 后的 orphan 自动迁移仍待后续，当前在失效前由 Runtime 阻止或在解析时明确失败。
- [x] 完成 Figma-compatible Component Properties v1：`DesignDocument 1.21.0` 与 Component Service v2 定义 `componentPropertyDefinitions`、Main sublayer `componentPropertyReferences` 和 Instance assignments，支持 Boolean、Text、Instance swap、preferred values、Main 默认值同步、set/reset、rename/remove 原子清理、cycle validation、advanced override 最终优先级及 detach 物化。Inspector 将 typed properties 置于高级 sourcePath override 之前；Agent 增加 add/rename/remove/set/reset property actions，inspection 返回定义、有效值、assignment 和绑定。隔离的 `@opendesign/figma-interop` 仅以固定官方 Plugin API typings 验证公共形状，不把 Figma 类型泄漏到 Core。
- [x] 完成 Figma-compatible Component Set/VARIANT v1：`DesignDocument 1.22.0` 定义真实 Set Frame、成员 membership/完整唯一组合、default 与正式 put/delete/change-set；Combine planner 保持 world geometry 并以单事务/单 undo 建 Set。Component Service 先按 VARIANT 选择唯一成员，再应用成员 properties 与 advanced override。Inspector 提供 Set/Variant 身份、Instance select/reset 和 eligible 多选 Combine；Agent 使用 inspection Component/root IDs 的 typed combine action，Canvas/SVG/位图、inspection、迁移、保存重开、history 与隔离 Figma interop 共享同一事实。
- [x] 完成 Figma-compatible Variant Property Matrix v3：`DesignDocument 1.23.0` 增加正式 `propertyOrder`，与既有 `variantOptions` 分别持久化 property/value 顺序；Runtime 支持 property add/rename/reorder/remove、value rename/reorder 和成员完整组合编辑，保持唯一组合、top-left default 与 Instance resolved member。Set root Inspector、Agent typed actions、inspection、diff/history、迁移、保存重开和渲染/导出继续共用 Component Service v2；见 ADR-0066。
- [x] 完成 Figma-compatible Component Slots v1：`DesignDocument 1.24.0` 与 Component Service v3 定义正式 Frame-like Slot、Main source/Instance override 存储、唯一合并顺序、Clear/Reset/delete/detach、Variant migration、settings、Component/Component Set preferred values 和指导性 limit warnings。Inspector、Layers、Agent typed actions/inspection、直接画布编辑、空 Slot editor overlay、Canvas/SVG/位图、迁移、保存重开与单 revision/undo 共用同一事实；nested Slot 明确失败封闭。见 ADR-0067。
- [x] 完成 Figma-compatible ordinary Component Property Order v4：`DesignDocument 1.25.0` 与 Component Service v4 增加每个 Component 必需且严格覆盖 definitions 的 `componentPropertyOrder`；Variant properties 继续由 Set order 管理并始终先于 active member ordinary properties。add/rename/remove/reorder、Inspector accessible controls、Agent typed action/inspection、diff/history、迁移、保存重开和解析/导出共用同一事实；见 ADR-0068。
- [x] 完成 Figma-compatible Variables Core v1：`DesignDocument 1.26.0` 与独立 Variable Service v1 取代无类型 token 占位，定义 Collection/Mode、BOOLEAN/COLOR/EASING/FLOAT/STRING/TIMING、同类型跨 Collection alias、scope/code syntax、Page/节点 mode inheritance 和 Figma-shaped bindings。人工 Variables 工作台/Inspector、Agent typed tool/inspection、Component 后投影、Leafer/SVG/位图、diff/history、迁移与保存重开共用同一解析结果；scope 仅影响 picker 推荐，不能冒充绑定授权或文档 invariant。Timing/Easing binding、更多字段、跨文件 Library 和 DTCG/REST/Plugin adapter 仍为后续切片；见 ADR-0069。
- [x] 完成 Figma-compatible Shared Styles Core v1：`DesignDocument 1.27.0` 与独立 Style Service v1 定义 Paint/Text/Effect/Grid registry、稳定 ID/key、按类型顺序、名称 `/` folder 语义及 `fill/stroke/text/effect/gridStyleId`。Runtime 对解绑、删除和直接属性修改先物化 resolved fallback；Component → Style → Variable 的单一投影进入 Local Styles 工作台、Inspector picker、Agent typed tool/inspection、Leafer/SVG/位图、diff/history、迁移与保存重开。隔离 Figma interop 对不支持 payload 返回明确 issue；remote Library/publishing 与完整 Plugin/REST adapter 为后续切片；见 ADR-0070。
- [x] 完成 Figma-compatible Slice 与 Export Settings Core v1：`DesignDocument 1.28.0` 定义透明可命中的正式 Slice leaf 和每节点有序 PNG/JPG/WEBP/SVG/PDF 配置。虚线仅为 non-exported editor overlay；人工与 Agent 共用 `insert_element`/`update_properties`、history/save/reopen，Slice 位图复用 Leafer crop。统一 planner 对 PDF、P3、Slice SVG 等未实现语义明确返回 unsupported；隔离 Figma interop 把 WEBP 标记为 OpenDesign 扩展。批量目录与完整 PDF/P3 为后续；见 ADR-0071。
- [x] 人工 UI 提供 Create component、Create instance、Go to main、Inspector source-layer override、Reset 与 Detach；Assets/Layers/Inspector 区分 Main/Instance/override。Agent 使用专用 `opendesign_manage_components`，通用 apply 不能写 component definition；同 Page 与跨 Page 权限分别校验。
- [x] Canvas 投影、hit testing、选择去重、Main/Instance direct manipulation、保存重开、undo/redo、复制/跨 Page、SVG/位图导出和 autosave 消费同一解析结果；循环、missing main/source、out-of-scope 与 revision conflict 原子失败。Instance 首版本可移动/旋转/倾斜但不可直接 resize/内部文字编辑；画布直接选择内部 override target 和双平台 GUI 实机证据仍待完成。

完成条件：自动化已验证同一 Design File 跨 Page Main/Instance、四类 typed property（含 Slot）、Component Set/VARIANT、Set 成员生命周期与二维矩阵、嵌套交换、Main/Slot 默认内容同步、Variables Core、人工与 Agent 操作、保存重开、autosave、undo/redo 和 SVG/位图导出一致。能力状态仍为 `degraded`，因为 nested Slot、画布矩阵重排、更多 Variable binding、跨文件 Library、画布内部派生 Main child 直选和 macOS/Windows 打包 GUI smoke 尚未完成。

## P2：精确图层、变换与矢量

- [x] 建立 `@opendesign/geometry-service` 的首个纯排列 provider；多层对齐、固定两端均分和明确一维间距由 EditorRuntime 转成单次事务，人工 Inspector 与 Agent typed tool 共用，不在 React、prompt 或 Leafer adapter 中重复计算。
- [x] 将纯排列 provider 升至 contract v4，增加确定性 Tidy up：一维按重叠轴和现有 gap 众数整理且不改另一轴；二维验证行列关系、支持不等尺寸与稀疏网格、锚定选择区域左上角。Inspector 与 `opendesign_arrange_layers` 共用同一 planner、preview、revision、undo 和自动保存路径；歧义/锁定/不可逆 transform/预算/no-op 明确失败。Smart Selection 画布间距手柄与增删改尺寸后的回流仍为后续独立切片。
- [ ] 针对 Path/Vector 通过维护状态、许可证、包体积、确定性、WASM/原生要求和 macOS/Windows 兼容基准选择固定版本的成熟 geometry kernel；已固定 BSD-3-Clause 的 `pathkit-wasm 1.0.0` 并通过真实 WASM 的 cubic PathOps、孔洞、空结果、simplify、outline stroke、输入预算与基础 bundle 隔离测试，裁决见 ADR-0021。剩余门禁是同一 corpus 的 macOS/Windows 原生加载、性能与内存基准，通过前不勾选完成，也不把 provider 基础描述为可用 Boolean/Pen 功能。
- [x] 将非破坏 Boolean Group 固定为 `DesignDocument 1.4.0` 的独立 `boolean` 容器；源层保持可编辑，组持有统一外观，Union/Intersect/Exclude 初始继承顶层、Subtract 初始继承底层。EditorRuntime planner 覆盖创建、operation 切换、解组、锁定、revision、保存重开和 undo/redo，不持久化 PathKit 派生 path；当前 capability 为 `degraded`。
- [x] 建立递归 Boolean geometry resolver 和 PathKit 派生投影：Rectangle/Ellipse/Path/Vector/嵌套 Boolean 统一进入真实 PathKit，源层 fill+stroke、局部 transform、空结果、精确缓存失效和短生命周期资源释放已有自动化；Leafer 按需加载独立 WASM chunk，只 reconcile 稳定 synthetic result，并将命中映射回原 Boolean，未把派生 path 写入文档或逐层绘制源层冒充结果。
- [x] 让人工工具栏/菜单、Inspector operation 控件、解组与 macOS `⌥⇧U/S/I/E`、Windows `Alt+Shift+U/S/I/E` 快捷键复用 Boolean planner；`opendesign_edit_hierarchy` 增加显式 `create-boolean`、`set-boolean-operation`、`ungroup-boolean` typed actions，不读取用户实时选区、不接受派生 path，并以 preview + 单次原子 apply 支持 undo。
- [x] 增加由稳定选区推导的短生命周期 Boolean 源层编辑 scope：Enter/双击/图层树进入，Shift+Enter/Escape/Done 退出，Tab 切换 operand；权威 synthetic result 保持可见，源层仅投影编辑轮廓，拖拽期间逐帧使用当前 transform/size 重算临时 result，松手只提交一次事务。Inspector 明确禁用组级控制的外观，锁定组可检查但只读；provider/geometry 失败显示可编辑源层或重试的上下文 warning，不把整张画布报成不可用。
- [ ] 完成 Boolean 像素基线、SVG 往返和 macOS/Windows 打包产品 smoke。固定 `OD-BRAND-01` 已加入可重放专业样张，并以真实 PathKit WASM 结果 checksum + Leafer synthetic Path 投影建立确定性几何基线；`@opendesign/import-export-service` SVG v1 纯 service 已覆盖 Path/Vector/基础 shape、Frame clipping、标准 `<text>/<tspan>` + 受控 TextNode 往返、ordered sibling masks、Boolean result 与基础 filter effects 的结构化导入导出、显式 fidelity report 和恶意 XML/外部引用拒绝。EditorRuntime 导入 planner 已把候选树按显式 Page/Frame/Group 目标转换为单次原子事务，覆盖 preview、锁定/冲突/层级校验、保存重开和一次 undo/redo；导出 planner 已从显式 roots、base revision、world bounds、paint order、padding 和同 revision Boolean snapshot 生成 0-origin 纯 service request。Main 已提供路径不外泄、fatal UTF-8、有界读取和原子保存的窄 SVG 文件桥，并覆盖 POSIX/Windows 路径与 IPC 安全测试。人工 File 菜单与 Properties Inspector 现通过可取消 worker 完成冻结目标导入、revision 复核、单事务应用/选中/undo、冻结选区导出、原生保存和 fidelity report。Agent `opendesign_import_svg` 已使用当前 Run 内容寻址 SVG handle、显式检查目标和 Main 生成 ID prefix 复用同一 worker/planner，以单事务导入、自动选中新根，并只回传有界保真元数据；`opendesign_export_svg` 由 Main 校验 preparation、打开原生保存框并只回传交付/保真元数据。模型不接收 XML、路径或内部前缀。真实 `OD-BRAND-01` Leafer 导出/re-import 像素基线、普通第三方 Text 字体布局、完整格式保真与 macOS/Windows 打包产品 smoke 仍未完成，因此不标记 SVG 往返完成。上述结构证据均不冒充待完成的真实像素 baseline。文字 operand 在 Text/Font service 能提供确定性 outline 前保持不可用。
- [x] 完成首个 SVG filter fidelity slice：导出使用标准 shadow-only primitive 分支与单一 `feMerge`，避免多 `feDropShadow` 重复合成半透明源图；导入/导出确定性保留最多八个普通零 spread drop shadow、一层 layer blur、效果顺序和 `visible`，并提供显式 user-space filter region。外部单个标准 `feDropShadow`/`feGaussianBlur` 可进入正式 `DesignNode.effects`；外部 URL 拒绝，inner/background/glow/grayscale、spread/blend、各向异性 blur、超预算值和复杂 graph 返回明确 fidelity issue，不静默扁平化。
- [x] 完成首个 SVG mask/clip fidelity slice：按 Figma/Leafer sibling 顺序把 alpha、luminance、outline、clipping mask runs 转换为标准 `<mask>/<clipPath>` 引用组，圆角 Frame `clipsContent` 只裁剪 children、不制造 background 图层；受控 graph 可确定性还原为同级 mask source + targets，受支持的外部本地 user-space mask/clip 会展开为可编辑蒙版组。definition 篡改、外部 URL、缺失/重复/循环引用、objectBoundingBox clip 与同元素 mask+clip 明确失败；复杂组合 graph 和 Text/Image mask source 继续显式不可用。
- [x] 增加 `DesignDocument 1.5.0` 正式 Line/Arrow：唯一持久 LineNode、有向归一化端点、独立端点装饰、开放中心描边、`L` / `Shift+L`、Shift 45 度、Alt 中心绘制、Inspector、Leafer Arrow/LineEditTool 端点写回、Agent schema 与受控 SVG marker 已打通；折线 connector、路由/吸附、标签、像素基线和 macOS/Windows 打包产品交互证据继续保持明确限制。
- [x] 增加 `DesignDocument 1.6.0` 正式 Polygon/Star：唯一持久语义节点、3–60 顶点、Star 归一化内径、实时圆角、Shift/Alt 创建、Inspector、Leafer 原生投影、Agent schema、尖角 PathKit Boolean 与受控 SVG 逐点校验已打通；corner smoothing、rounded outline、像素基线和 macOS/Windows 打包产品交互证据继续保持明确限制。
- [x] 增加 `DesignDocument 1.7.0` editable Vector Network 与首个 Pen 创作切片：`path` / `network` 严格互斥，稳定 vertex/segment/path/region ID、拓扑 invariant、cubic tight bounds、保存重开/undo/redo、Leafer-native preview/anchor/handle、`P`、click/drag/close/Enter/Escape/Backspace/tool-switch、单事务写入、Agent schema、Boolean 消费和受控 SVG network metadata 已打通；当前只创建单条非分叉 contour，macOS/Windows 打包交互和像素证据继续保持明确限制。
- [x] 增加 `DesignDocument 1.8.0` 已有单轮廓节点编辑：持久 corner/smooth/mirrored/independent handle mode，Enter/双击进入，单选/Shift 多选节点移动，选中节点手柄拖动，Delete/Backspace，锁定只读，Done/Escape，普通 selection/Pen/path-edit chrome 互斥，pointer-up/point-mode/delete 单事务，cubic tight bounds 与 transform offset 组合、保存重开/undo/redo、Agent schema 和受控 SVG metadata v2 均已打通；实现对照 Figma Vector Network 与 OpenPencil 固定提交 `449f31dd8b7df12965f65d9da774597332fc153d` 的 `path_edit.rs`、`canvas_path_overlay.rs` 和 history 行为，不引入其 runtime、文档或工具权限边界。
- [x] 将 `@opendesign/geometry-service` 升级为 contract v5，并完成单轮廓开放/闭合与路径反转垂直切片：Close 由宿主确定性增加稳定 closing segment 与 closed region，Open 删除 closing edge/依赖 region，Reverse 反转 path references 并同步 region winding，不重写 retained vertex/segment ID。人工 Vector Edit 工具条与专用 `opendesign_edit_vector` 复用同一 EditorRuntime planner、preview、单次 revision/undo；锁定、no-op、stale、Page scope、分支/多轮廓拒绝、tight bounds、保存重开、SVG metadata、Leafer Fill 和 Boolean open-region 语义已有自动化证据。文档 schema 已能表达这些状态，因此不虚增迁移版本；见 ADR-0037。
- [x] 将 Geometry Service 升级为 contract v6，并完成点击 Cut 垂直切片：Vector Edit 次级工具栏提供 Move（V）/Cut（X），可点击已有节点或直线/三次曲线任意位置创建真实断点；闭合 contour 变为一条开放 contour，开放 contour 变为两条互不共享 vertex、可继续编辑的开放 path run。宿主用 de Casteljau 精确拆分 cubic，只新建稳定 endpoint/segment/path ID，保留未受影响 ID；人工与 `opendesign_edit_vector cut-path` 共用 Geometry、EditorRuntime preview/apply、单 revision/undo/save，Leafer/Boolean/受控 SVG 继续消费同一 network/region 事实。当前多轮廓编辑只接受互不连接的非分支 path runs；见 ADR-0038。
- [x] 将 Geometry Service 升级为 contract v7，并完成单 Vector 图层有限线拖拽 Cut 垂直切片：Cut pointer down/move 只维护 node-local 临时 guide，小于 4 px 的 pointer up 沿用点击 Cut，超过阈值时由宿主求 line/cubic 真实 crossing；每条受支持的闭合 contour 必须恰好两个交点，两块都补真实 connector，含源起点的 piece 留在原 node 并保留 path/region ID，提取 piece 进入紧邻的新 Vector sibling。多条独立 closed contour 可一次切割，纯描边不发明 region；open、tangent/overlap、compound hole 与歧义多交点显式拒绝。人工与 `opendesign_edit_vector cut-with-line` 共用 Geometry/Runtime planner、宿主结果 ID、单事务/undo/save；Escape、lock、切页/工具/dispose 清理零 revision guide，标准 SVG `Z` + metadata v2 往返两个独立可编辑节点；见 ADR-0039。
- [x] 完成多 Vector 编辑集合与跨层拖拽 Cut：一个或多个已选 Vector layers 可通过 Enter/双击进入同一 scope，全部显示独立 trace/anchors，命中层成为 active；Shift 点击加入图层，macOS Command / Windows Control 点击切换成员。拖拽同时保留 document-space 公共切线、node-local guide 与 client threshold，pan/zoom 不改变目标或 revision。Runtime 对每层 world transform 求逆，跳过未命中层、拒绝 locked/non-invertible/不支持拓扑，并把所有命中层按稳定 sibling 顺序合并为一次 preview/apply、revision 和 undo。人工 Canvas 与 Agent `cut-layers-with-line` 共用 planner；模型不提供结果 ID 或 network。见 ADR-0040。
- [x] 将 Geometry Service 升级为 contract v8，并完成开放描边有限线 Cut 垂直切片：开放 contour 按路径 traversal 上所有真实横穿交点切开，路径片段依次交替进入 retained/extracted sibling，含源起点的首片保留 source path ID；不添加 connector、不闭合、不创建 region 或隐式 Fill。单交点、同一 cubic 多交点与任意多个交点均由宿主确定性分割，endpoint 接触不产生操作，tangent/overlap 继续明确失败。人工 Canvas 与 Agent 单层/多层 Cut 共用同一 Geometry/Runtime planner，闭合与开放目标可在一次 document-space 事务中混合；保存重开、undo/redo 与标准无 `Z` SVG + metadata v2 往返保持可编辑。见 ADR-0041。
- [x] 将 Geometry Service 升级为 contract v9，并完成未穿孔洞的 compound region Cut 重分配：当唯一 outer loop 被横穿两次且每个 inner loop 严格位于切线一侧时，孔洞以稳定 path/segment/vertex ID、loop direction 和 region winding 跟随实际包含它的 retained/extracted sibling；loop 数组顺序不参与 ownership。`serializeVectorNetwork` 现按 `loop.reversed` 输出有效闭合方向，Leafer、Boolean 与标准 SVG `d` 不再把 nonzero hole 填实；同 path 冲突方向显式失败。人工/Agent、单/多层 planner、tight bounds、save/reopen、undo/redo 与 metadata v2 往返继续复用同一事务；穿过或接触 hole 仍原子拒绝。见 ADR-0042。
- [x] 将 Geometry Service 升级为 contract v10，完成 crossed-hole boundary stitching 与闭合凹形多交点 Cut：全部 closed boundary arcs 与同侧 connectors 组成无向临时图并做 cycle decomposition；包含源 outer 起点的 component 保留源 path/region ID，其余一个或多个 component 进入同一 extracted Vector sibling。切线穿过 outer + hole 时重建为连续 single-loop 结果，不保留失效 hole；未切 loops 按真实包含关系分配。Runtime、Canvas、Agent、SVG metadata v2、保存重开和单次 undo 共用同一语义，viewport pan/zoom 不改变 document-space 切线；见 ADR-0044。
- [ ] 继续完成连接/断开、分支网络、套索、多节点变换框、flatten、outline stroke 与正式 Slice；补真实像素 baseline 和 macOS/Windows 打包产品交互证据。嵌套/重叠 compound regions、direct-hole-only Cut 与 self-intersection 继续结构化拒绝。
- 扩展剩余图层与精确变换工作流：重命名、批量属性、单层相对父级对齐、Smart Selection 画布间距手柄与回流、翻转、原点、智能吸附、参考线、标尺、像素对齐、画布直接操作时自动归属，以及显式跨容器键盘目标选择。
- 人工命令与 Agent typed tools 调用同一 geometry service，并把结果作为一个可预览、可撤销的 `DesignTransaction` 应用。SVG 导入导出必须经过同一公共 Path 语义，不能泄漏 provider 私有命令。

完成条件：`OD-PENGUIN-01` 可以通过人工 Pen 和 Agent 工具继续编辑，不需要重建整个轮廓；`OD-BRAND-01` 的布尔、outline 和 SVG 往返保持结构、bounds 与视觉基线；所有动作支持保存重开和 undo/redo。

## P3-A：文字、图片与海报交付

- [x] 增加 `DesignDocument 1.9.0` 固定文字框换行与溢出：`none/word/character` 和 `visible/clip/ellipsis` 进入正式 schema、`1.0.0–1.8.0` 迁移、EditorRuntime preview/save reopen/undo/redo、人工 Inspector、Agent typed schema、Leafer Text 投影和受控 SVG Text metadata v2；metadata v1 继续确定性读取。旧 adapter 错把 Box `overflow` 写给 Text 的路径已删除；见 ADR-0035。
- [x] 增加 `DesignDocument 1.10.0` 与 `@opendesign/text-service` contract v1：Fixed、Auto Width、Auto Height 进入 discriminated schema，`1.0.0–1.9.0` 迁移为 Fixed；EditorRuntime 在 insert/update/replace 的同一 preview/apply 中调用固定 Leafer 2.2.9 provider 并持久化具体 size，provider 未就绪返回结构化可重试失败，字体 fallback 返回 fidelity warning。Workspace 向活动、后台和后来打开的 Design File 同步 provider；单击/拖拽创建、Inspector、Agent schema、直接 move/resize、保存重开、undo/redo 与 SVG Text metadata v3/v2/v1 已贯通，不使用字符数估算；见 ADR-0036。
- [x] 增加 `DesignDocument 1.29.0` 与 `@opendesign/text-service` contract v2：按 Figma Text/TextStyle 公共边界加入 paragraph indent/spacing、case、decoration、独立 `textTruncation/maxLines`，旧 `textOverflow: ellipsis` 迁移为 clip + ending；Fixed 保持权威文字框尺寸，Auto Size 与画布共用固定 Leafer 2.2.9 rows 派生的结束省略号，直接编辑始终恢复和提交完整 content。Inspector、Agent 完整/Bootstrap schema、共享 Text Style、Figma interop 与 SVG Text metadata v4/v3/v2/v1 已贯通；见 ADR-0074。
- [x] 将 `@opendesign/text-service` 升级为 contract v3：Text 继续保存作者请求的 family/weight，当前 Leafer provider 单独报告 `available/missing/unknown`；Inspector 显示可信状态和文件级精确匹配数量，并以一个 `reflow_text` transaction/revision/undo 完成 Auto Size 显式重排或全文件替换，Fixed 保持权威文字框。Agent inspection 返回有界字体摘要，专用 `opendesign_manage_fonts` 经过 Main inspection/target/material-write/delivery、Renderer scope/revision 和同一 Runtime 命令；通用/Bootstrap apply schema 不扩张。Figma interop 只映射当前 family/weight 子集，不持久化本机 availability；见 ADR-0076。
- [x] 增加 `DesignDocument 1.30.0` 与 Text Service contract v4 的 Figma-compatible face identity：Text、Text Style、layout/availability、`reflow_text`、Inspector、Agent 完整/Bootstrap schema、Leafer、Figma interop 与 SVG Text metadata v5 统一保存 `fontFamily/fontStyleName/fontWeight/fontSlant`。`fontStyleName:null` 明确表示 unresolved；迁移不按 numeric weight 猜造 `Regular/Semi Bold/Bold`，Figma Text/Text Style export 在 unresolved 时返回 fidelity failure。文件级替换以四字段精确匹配并对任一 face 漂移返回 stale conflict；见 ADR-0077。
- 扩展 Text/Font service，支持字体二进制 asset/授权/内容寻址加载、富文本 runs、逐段样式、列表、OpenType/variable font axis、text-on-path 和确定性跨平台 shaping。macOS 与 Windows 必须产生明确兼容结果或 fidelity warning。
- 扩展已建立的 Image service：当前已有 Image 节点的版本化 placement、crop/focal 几何、Leafer 投影、检查器、来源替换和专用 Agent update tool；下一步补齐画布直接 Crop、mask、透明背景、基础 adjustments/filter、资源变体、引用恢复和大图生命周期。增加独立 `edit_image` adapter/tool，支持局部重绘、扩图、背景替换、重打光和风格统一；参考图、原图和 AI 派生资源必须分离并可追溯，任何编辑都不得覆盖原始 asset。
- 扩展 P0-B 已建立的专业位图导出，补海报交付所需的高级颜色、资源和格式保真；导出继续读取 DesignDocument 和受控资源，不能把当前画布截图当作交付产物。
- 为人工属性面板和 Agent 增加文字、裁剪、替换、调整和导出的语义命令；长任务必须展示进度、支持取消并返回稳定产物或明确失败。

完成条件：`OD-POSTER-01` 在保存重开后保持字体、图片裁剪和复杂外观，并能输出 1×/2× 专业位图；导出尺寸、alpha、资源引用和视觉基线通过自动化及 Electron 实机验证。

## P3-B：响应式布局、Variants 与设计系统

- [x] 完成普通 Frame constraints v1：`DesignDocument 1.12.0`、独立 Layout Service v1 与 EditorRuntime planner 定义横向 left/right/stretch/center/scale、纵向 top/bottom/stretch/center/scale；Inspector、单选 populated Frame 画布 resize 与 Agent `set-constraints/resize-frame` 共用一个递归原子事务，保存重开、undo/redo、reparent 清除、旧文档迁移和通用 Agent resize 旁路拒绝已有自动化。translation-only、Group/Boolean bounds、Instance resize、Auto Size 文字拉伸和双平台打包 GUI 仍是明确限制。见 ADR-0051。
- [x] 完成线性 Auto Layout v1：`DesignDocument 1.13.0` 在 Frame properties 持久化 horizontal/vertical flow、四边 padding、固定非负 gap 与主轴/交叉轴 start/center/end；Layout Service 纯函数求解固定尺寸子层，EditorRuntime 在每笔事务的显式命令和文字测量后统一 deepest-first 回流。增删、隐藏/显示、resize、重排、reparent、父 Frame resize、保存重开和 undo/redo 共用同一事实；Inspector、`Shift+A` / `Alt+Shift+A`、Layers 层序、画布边界与 Agent `set-auto-layout` 已贯通。流内普通 constraints 自动清除/隐藏，直接画布 geometry 与 Agent 通用旁路明确拒绝且零 revision。hug/fill、wrap、auto gap、baseline、min/max、ignore-layout child、grid、画布回流手柄、SVG metadata 和双平台打包 GUI 仍待后续。见 ADR-0053。
- [x] 完成 Auto Layout 轴向尺寸 v1：`DesignDocument 1.14.0` 与 Layout Service contract v2 增加 Frame 每轴 Fixed/Hug、直属子层每轴 Fixed/Fill、主轴剩余空间平分、交叉轴填充、隐藏层排除、nested Hug 有界收敛，以及水平 Fill + Auto Height Text 重测。Inspector、手动 Hug Frame resize 切回 Fixed、Agent `set-layout-sizing`、reparent/关闭 flow 清理、preview/apply、undo/redo/save/reopen 共用同一 planner/Runtime；Hug/Fill 和文字冲突、通用 apply 旁路失败封闭。wrap、auto gap、baseline、min/max、ignore-layout child、grid、画布回流手柄、SVG metadata 与双平台 GUI 仍待后续。见 ADR-0055。
- [x] 完成 Auto Layout Horizontal Wrap v1：`DesignDocument 1.15.0` 与 Layout Service contract v3 增加 Horizontal 专属严格 `wrap { mode, counterGap }`、固定宽度阈值、按 child 顺序贪心分行、逐行主轴/行内与整组交叉轴对齐、Fixed/Hug Height、隐藏层排除和超宽单项 overflow。Inspector、Agent `set-auto-layout`、Runtime 回流、nested convergence、preview/apply/history/reopen 共用同一语义；Vertical Wrap、Wrap+Hug Width、Wrap+Fill 与通用旁路失败封闭。Auto gap、baseline、min/max、ignore-layout child、grid、padding minimum、画布回流手柄、SVG metadata 与双平台 GUI 仍待后续。见 ADR-0056。
- [x] 完成 Auto Layout Min/Max + Padding Minimum v1：`DesignDocument 1.16.0` 与 Layout Service contract v4 为 Auto Layout Frame 和直属 flow child 增加独立 `layoutLimits`，Fixed/Hug/Fill 候选尺寸统一 clamp，主轴 Fill 采用 bounded water-filling，Frame padding 是优先于 max 的硬下限；Horizontal Wrap、nested Hug 和 Auto Height Text 重测复用同一求解链。Inspector 四字段可设置/清空，Agent 新增 `set-layout-limits`，通用 apply、非法作用域和反转区间失败且零 revision；disable/reparent 按节点是否仍为 flow Frame 清理或保留。Vertical Wrap、Wrap+Fill、auto gap、baseline、ignore-layout child、grid、画布回流手柄、SVG metadata 与双平台 GUI 仍待后续。见 ADR-0057。
- [x] 完成 Auto Layout Auto Gap v1：`DesignDocument 1.17.0` 与 Layout Service contract v5 用主轴 `space-between` 表达自动间距；Fixed 主轴只把非负剩余空间分配到相邻项之间，单项回到起始 padding，Hug 轴按零 gap 收敛，Horizontal Wrap 按每行独立求 gap。数值 gap 在模式切换中保留；Inspector 提供固定/自动模式，Agent `set-auto-layout` 只提交语义，宿主派生坐标。增删、隐藏、resize、重排、nested、preview/apply、undo/redo/save/reopen 共用 Runtime 回流；counter-axis Auto gap、Vertical Wrap、Wrap+Fill、baseline、ignore-layout child、grid、画布间距手柄、SVG metadata 与双平台 GUI 仍待后续。见 ADR-0058。
- [x] 完成 Auto Layout Ignore Flow / Absolute Child v1：`DesignDocument 1.18.0` 与 Layout Service contract v6 增加可选 `layoutPositioning: absolute`，直属 child 保留在 Frame 内但退出 Hug/Fill/Auto gap/Wrap flow；切换时原子清理 sizing/limits 或 constraints，Fixed/Hug parent 尺寸变化复用普通 constraints。Inspector 在 Layout 区提供“忽略自动布局”与 constraints，flow child X/Y 禁用，absolute child 可直接画布 move/resize；Agent `set-layout-positioning` 与通用 apply/insert/replace 旁路失败封闭。disable/reparent、preview/apply、undo/redo/save/reopen 共用 Runtime。旋转 absolute child、counter-axis Auto gap、Vertical Wrap、Wrap+Fill、baseline、grid、画布间距手柄、SVG metadata 与双平台 GUI 仍待后续。见 ADR-0059。
- [x] 完成 Layout Guide / Uniform Grid v1：`DesignDocument 1.19.0` 在 Frame properties 持久化最多八个稳定 uniform guide 的 size/color/opacity；它们不改变 child 几何或 Auto Layout，只在选中 Frame 时由 Leafer editor sky 投影为不可命中辅助线，pan/zoom/resize 时重算，capture/export 不包含。Inspector 与 Agent `set-layout-guides` 共用 Runtime planner、单 revision/undo/save/reopen；generic apply/insert/replace 旁路失败，重复 ID 和每 guide 4096 线预算关闭。Columns/Rows、margin/gutter/offset、吸附、共享 style、baseline 与 Auto Layout Grid 仍待后续。见 ADR-0060。
- [x] 完成 Layout Guide / Columns / Rows v2：`DesignDocument 1.20.0` 在同一 Frame guide 集合增加 fixed start/center/end 与 stretch columns/rows，支持 count、sectionSize、gutter、offset/margin；Leafer editor sky 显示裁剪在 Frame 内的不可命中色带，不改变 child/Auto Layout，不进入 capture/export。Inspector 加号菜单、类型/对齐字段、Agent strict schema、迁移、save/reopen、undo/redo、pan/zoom/resize 与 generic 旁路门禁共用同一 planner。Auto Layout Grid 的 track/cell/span/reflow、吸附、共享 style、baseline 与手工参考线仍后续实现。见 ADR-0061。
- 建立 OpenDesign-owned constraints、horizontal/vertical auto layout、wrap、padding/gap、对齐、hug/fill/fixed、min/max、absolute child、layout grid 与响应式求解语义。Layout service 输出确定性布局或候选事务，不保存第二份布局状态。
- 在 P1-C 已完成 Boolean/Text/Instance-swap/SLOT properties、Component Set/VARIANT v1、成员生命周期 v2、二维属性矩阵 v3 与 Slot v1 的基础上继续建立 nested Slot、画布矩阵重排、共享样式与 Library 发布/消费，并扩展 Figma Plugin/REST import-export、跨文件更新、循环依赖和失效引用诊断。
- [x] 建立 Design File 级 Variables Core，而不是应用设置：支持六类 typed value、Collection/Group path、Mode、同类型 alias、picker scope、code syntax、核心属性 binding，以及 primitive → semantic → component 分层。人工 UI 与 Agent 共用同一版本化命令；主题/模式切换、alias 继承、循环/失效引用产生确定性结果。跨文件 Library 发布/消费与 DTCG JSON 导入导出继续通过后续独立 service 实现。
- 人工 UI 和 Agent 使用同一组创建组件、生成实例、修改 override、切换 Variant、绑定 Token 和调整布局命令。属性检查器必须区分源组件、实例值、override 与继承值。

完成条件：`OD-UI-01` 在改变容器宽度、组件 Variant 和变量模式后得到确定性结果；实例 override、保存重开、undo/redo 和 Agent 修改保持一致，且没有把 Leafer Flow 或组件私有对象写入文档。

## P4：资源、导入导出与交付

- 建立统一资源工作台，管理图片、字体、二进制、派生资源、去重、引用计数、替换、失效恢复和授权状态。
- 建立 SVG、PNG/JPEG/WebP/GIF、PDF 和剪贴板设计内容的导入管线；导入必须返回结构化保真报告，不能静默丢弃未知效果或字体。
- 扩展导出到 SVG/PDF、批量 Frame、透明背景、切图、Token 和开发检查。导出产物必须来自版本化 service，并记录 provider、设置和 fidelity warning。
- 为 `OD-SCALE-01` 建立固定性能基准，记录万级节点、复杂文字、图片/效果、连续 Agent revision、pan/zoom、资源释放、内存和帧时间；回归超过预算时阻断发布。

完成条件：专业文件交换和批量交付有可重复产物与保真报告；`OD-SCALE-01` 在 macOS 和 Windows 达到已记录预算；长导入、导出和基准任务可以取消且不会锁死画布。

## P5：完整 Agent 权限与互操作

- 把当前设计工具纳入 Main-only Trust/Capability/Approval/Audit/Sandbox 执行链。
- 实现 attached roots、per-run resource handles、访问快照、撤销与跨 Project 多目标计划。
- 增加受控 `fetch_reference` 和隔离 `capture_reference`，明确 HTML 内容与网页视觉截图的不同语义。
- 让 MCP Client/Server 复用同一资源 locator、能力、revision、审批、审计、事务和撤销入口。

完成条件：Agent、MCP 和人工 UI 对同一设计操作产生同构事务、同一 revision 行为和同一撤销结果；模型不能通过工具参数覆盖全局 provider、读取任意路径、获取原始凭据或绕过审批。

## Agent 专业设计质量轨

专业设计质量不能只依赖 system prompt。以下工作与 P0-P5 并行，并由 Runtime、service 和固定样张共同验收：

- 增加结构诊断，识别复合对象散落 Page 根层、文字溢出、空 Path、不可见节点、资源缺失、非有限 bounds、完全越界、异常遮挡和无意义碎片层。
- [x] 完成通用语义对象与组件决策 v1：DesignPlan v4 由 LLM 根据同一/跨 target 复用、稳定语义身份、集中更新价值、结构一致性与实例差异声明 component/ordinary 候选，不按 Logo/按钮类别或固定次数机械决定；Main 在 exact-revision 最终检查中一次报告声明的 Frame/Group、Component Main 与 linked Instance 偏差。实机证明逐项阻塞会把可用设计放大为数十轮元数据修复，因此 ADR-0072 将其重分层为 `blocking:false` 可维护性质量，Frame/region/material/layout/revision 正确性继续阻塞 verified。v2/v3 历史计划兼容，材料 amendment 保留稳定语义节点与 Component 身份；固定正反样张及既有 save/reopen、undo、override、同步和导出回归共同验收。后续补结构相似度诊断、批量组件 materialization 与 design critic；没有批量宿主执行和 1/4/12-target 实机证据前不得恢复逐节点阻塞。见 ADR-0062、ADR-0072。
- 增加渲染诊断与可读性检查，覆盖主体比例、层级、留白、对比度、文字可读性和关键内容裁切。启发式诊断必须标注置信度，不能把审美模型输出伪装成确定性错误。
- 为对齐、布局、布尔、裁剪、组件、变量、导入和导出提供语义化 typed tools，避免模型通过大量低层坐标和节点重建完成专业操作。
- 低优先级开放用户级与 Project 级设计 Skill/风格规范：记录来源、版本、内容哈希和权限，只影响设计方法、风格与评审标准，不能覆盖系统策略、扩展 Mutation Target 或替代底层设计能力。当前 `@opendesign/discovery` 只有隔离发现/优先级解析，尚未接入生产 Agent、管理 UI 或权限审计链，因此不得宣称已支持自定义 Skill/提示词。
- [ ] 中优先级调研并内置受信任的专业 Design Skill 方法包：按 UI、Logo/品牌、海报等 deliverable 类型选择有界的构图、网格、字阶、层级、组件化和评审清单，只向模型返回命中的步骤摘要与版本/内容哈希，不在每轮重复注入完整资料。候选内容必须固定来源与许可，并通过同 prompt/模型/工具预算的盲评样张证明首个可用画面时间、成功率或视觉评分有净收益；Skill 只影响设计方法，不能获得工具、路径、网络、凭据或额外 Mutation Target。
- 保留“写入 → `capture_canvas` → refinement → `capture_canvas`”可信完成门禁，并加入结构诊断结果、渲染失败和导出失败的阻断条件。截图次数本身不能证明设计质量。
- [x] Layout Quality Report v2 为 Frame overflow 返回 exact-revision world bounds、当前 parent-local position、最小 parent-local recovery delta/position 与 resize 必要性；完成门禁和 Agent 恢复指令直接消费这些可信几何，禁止把 world 坐标误写为 local transform 后反复试错。
- 使用固定 prompt、参考资源、模型配置、工具轨迹、最终文档和视觉评分运行回归。任何提示词、模型 adapter、工具 schema 或渲染后端变更都必须重放受影响样张。

## 持续门禁

- 不恢复 OpenPencil、Canvas2D、手写选择框、隐藏 fallback 或双写状态。
- OpenPencil 可作为持续的产品行为、工作台、Pen/Path、SVG、图片和模板验收基准；参考必须固定提交并转译为 OpenDesign 公共语义与测试，不能把上游实现直接变成第二套产品内核。
- 不让模型、MCP、skills 或 Renderer 获得 Leafer 对象、原始凭据、任意路径或裸 shell。
- 新第三方依赖必须固定版本并更新 ADR、`engine-baseline.json`、第三方通知和兼容性测试。
- macOS 与 Windows 是同级发布门禁；不能用一个平台的构建或自动化结果替代另一个平台的原生验证。
- 文档只描述当前事实或明确目标；未验证能力不得宣传为完成。
