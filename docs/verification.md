# OpenDesign 验证状态

- 日期：2026-08-15

<!-- verification-facts:baseline:start -->

- 环境基线：Node.js 24.14.0、pnpm 10.32.1、Electron 43.3.0、Vite 8.2.1
- 文档协议：`DesignDocument 1.36.0`
- Agent 协议：`3.11.0`
- Geometry Service：`contract v13`
- Text Layout Service：`contract v4`
- Text Range Service：`contract v1`（DesignDocument rich-text runs 已接入）
- Text Paragraph Service：`contract v2`（逐段 indent/spacing/list 已接入）
- Text List Service：`contract v1`（ordered/unordered、五级层级与 hanging marker 已接入）
- Text Editing Session Service：`contract v2`（自动列表、光标输入样式、范围暂存与单事务提交已接入）
- Text Run Layout Service：`contract v4`（native/HarfBuzz 列表生产投影已接入）
- Layout Service：`contract v8`
- Agent Core：`@earendil-works/pi-agent-core 0.84.1`（production-entry-native-gate-pending）
- 生产画布：`leafer-editor 2.2.9`

<!-- verification-facts:baseline:end -->

本文只记录当前工作树实际执行的证据。计划命令、历史会话结果和第三方能力说明不算通过。

## 平台支持矩阵

| 平台    | 产品级别 | 当前证据                                                                                                                                                                                                                                                   | 发布状态                        |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| macOS   | 一级支持 | 原生 workflow [31384519288](https://github.com/clddup/open-design/actions/runs/31384519288) 历史上已通过 verify、protected Vite build、未签名 DMG/ZIP、包内容检查、packaged Agent smoke 与 artifact 上传；当前 workflow 已改为仅上传 DMG，待下一次反馈验证 | 自动化历史通过；签名/安装待验收 |
| Windows | 一级支持 | 历史 workflow 已在 Windows runner 通过 verify、protected Vite build、NSIS、包内容检查、packaged executable/Agent smoke 与 artifact 上传；当前 NSIS 已配置 assisted installer 和目录选择，待最新原生产物复验                                                | 自动化待复验；实机安装待验收    |
| Linux   | 目标平台 | 保留 electron-builder 配置，当前无原生验证                                                                                                                                                                                                                 | 当前阶段不阻塞                  |

macOS 与 Windows 必须在同一待发布 commit 上分别完成原生验证。Electron、TypeScript 和共享测试通过不等于另一操作系统可用，protected V8 bytecode 也不能跨系统构建后复用。

## 自动化门禁

当前工作树通过：

<!-- verification-facts:tests:start -->

```text
pnpm format:check   passed
pnpm architecture:check passed
pnpm agent-core:check passed
pnpm capabilities:check passed
pnpm fixtures:check passed
pnpm lint           passed
pnpm typecheck      passed
pnpm test           passed
├── package tests   passed
└── desktop tests   passed
pnpm build          passed
├── Renderer
├── Electron Main
├── Preload
└── Agent utilityProcess
```

<!-- verification-facts:tests:end -->

测试覆盖的关键路径包括：

- 固定 UI/Logo live-Agent 评测工具验证场景 prompt 可读取、模型上下文预算与首轮工具面有界、真实 evidence 结构和产物字节完整性。匿名 packet 只暴露 prompt、rubric 与随机排序后的最终 captures，不暴露 Run、Provider、model、app 或 Critic 身份；评分按每项 1–5 分执行 critical/ordinary 非补偿阈值。该自动化只证明评测工具可重放，不证明当前模型设计质量已经通过；真实 macOS/Windows 打包产品 Run 与人工评分仍待执行。命令为 `pnpm evaluation:check`，见 ADR-0120。

- DesignDocument 1.10 schema/migration、Fixed/Auto Width/Auto Height 文字与具体权威尺寸、文字换行/溢出、正式 Path/Vector 外观与持久 Bézier point mode、非破坏 Image placement 与 Boolean Group、事务、revision、preview、history、undo/redo、asset 引用安全和 Agent 渐进事务回滚。
- Agent 画布生成过程测试覆盖：`opendesign_apply_transaction.steps` 按语义边界一次覆盖全部 command；每个成功步骤产生真实 revision，Boolean 等依赖完整 invariant 的命令自动合并到同一有效阶段；无 steps 时整笔一次提交，多个 revision 共享一个 undo，取消回滚整组。Renderer 只从已提交 Agent `ChangeSet` 派生父级优先的新增节点 reveal、视觉字段 changed-only tween 和 focus point，用户或 name/z-order 等非视觉更新不产生 Agent 动画。Leafer reveal 覆盖 pending/wireframe/fade/final、密集批次有界节奏、重复事件去重和最终 opacity；属性 tween 纯函数覆盖仿射最短角 transform、geometry、solid/gradient color、shadow/effect、文字度量、同 topology path、不兼容 dissolve、退化矩阵无 `NaN`，cadence 在慢帧/大批次下降低时长与节点预算。Adapter 测试覆盖 changed-only revision、中间值、同节点 retarget 不回跳、选区 bounds 同帧刷新、pan/zoom 保持、离屏最终态、capture/人工直接操作/Reduced Motion 收口；reveal 与 tween 共享单 RAF。`DesignPlanToolInput version: 3` 测试覆盖一个/多个 target、画板位置/尺寸、区域 bounds、跨 target 全局唯一稳定 ID、Main acceptance 匹配和 v2 历史兼容；Main 从 accepted plan 编译全部真实 Frame roots 的可信 Page/parent/局部 transform/size，并以单个 revision/undo 分配。accepted plan 紫色 skeleton 已从生产路径撤销；相关 skeleton 投影测试只保留历史行为证据。cursor 挂在内置 editor `sky` 的不可命中底层且只有真实 Frame 存在时出现；selection/EditBox 位于其上。连续 MoveEvent 中即使 sky 暂时落后于 document `tree`，固定屏幕 cursor 也通过 `sky⁻¹ × screen` 保持同一锚点，不会因 pan/zoom 累积错位。Renderer 证明已建立计划 Frame 内纯新增事务可安全跨过用户平移 revision，同时 resize 会拒绝复用旧布局条件。第三阶段测试覆盖本地 typed tool → semantic phase 映射、自由文本 progress 隔离、百分比终态清理、真实 revision cursor focus、180 ms 位移、pan/zoom、离屏边界、固定屏幕标签、Reduced Motion、`aria-live`、抑制和新 Run 恢复；Agent timeline 同时证明 live/durable 语义步骤按 revision 去重重建，completed tool 不再保留旧 progress detail，可自动恢复的 `design_workflow.*` 门禁反馈不堆叠为红色失败卡。Main coordinator 以 material/capture/review revision 拒绝 baseline、重复和过期截图，并从 Run/plan 选择 Page 或 Frame target；Leafer adapter 和 Renderer capture service 验证 captured revision 的独立 content-tree 导出、尺寸上限、清理与无活动 viewport 依赖。Agent 审查 JPEG 先等待当前离屏 App ready，再走 Leafer 同步 `UI.syncExport`/data URL，不进入 `@leafer-in/export 2.2.9` 的包级异步串行队列；测试证明一个永久挂起的 surface 不阻塞另一健康 surface，并拒绝 Promise/非法 JPEG 输出。App 端到端测试证明 A 的 Run 在用户切到 B 后仍写入并截图 A，B revision/overlay 不变，切回 A 读取最新 revision；手动停止和 Agent 终态继续清理对应文件的展示。该自动化不替代 macOS/Windows 实机运动、触控板缩放和帧时间验收。
- Agent presentation viewport 的补充回归覆盖 editor sky 在最后一个 viewport event 后才追平的真实 render settle：App 在实际 child render 前重算 `sky⁻¹ × tree` 与 cursor 局部矩阵，第二次稳定 render 不重复写 transform，避免骨架/光标双重 pan/zoom 与常驻重绘。
- `DesignLayoutQualityReport v1` 纯函数测试覆盖 clipping 开关、隐藏后代、1%–25% 部分越界、至少 25% 大面积越界、完全越界、无效/错 Page Frame、报告运行时守卫和超过 128 个 issue 时失败关闭。Renderer capture 测试证明报告与同一不可变 document revision 生成；Main 边界拒绝缺失、畸形及 document/revision/Page/Frame 不匹配报告；多 target coordinator 测试证明跨 target 报告不能冒充当前 Frame，最终 error 保持 `refined`、修正后可恢复 `verified`，warning-only 不阻塞。报告不读取活动 viewport、selection 或截图像素。
- `DesignCapabilityManifest v1` 的严格字段、唯一 ID、六表面状态、证据派生与不可变快照；Agent system context、只读 `get_capabilities` tool、生成式帮助文档和发布摘要读取同一 JSON，`capabilities:check` 会拒绝文档漂移。
- `inspect_document` 不把 image asset 的 data URI 或外部 URI 放入模型上下文；Agent Runtime 会同时压缩当前轮和旧 journal 中意外出现的超长工具字段，避免图片文档在下一轮触发 `context_too_large`。
- Agent Runtime 在完整 run 边界生成累计 `context.compacted` checkpoint，并在同一 Run 的每个 Provider turn 前重新预算；旧 assistant/tool 段超限时变成临时有界 checkpoint，当前用户原文和最近完整 tool call/result 段继续保留。测试覆盖原始 Timeline 不删除、checkpoint 范围单调增加、旧全文退出模型投影、第八轮自动恢复，以及单次当前输入或最小必要段仍超预算时才返回 `context_budget_exceeded`。模型投影同时限制超长单字段和超过 `50000` 字符的完整结构化工具结果，原始 journal 不丢失；预算错误按 system、tool schemas、Conversation/tool results 和 framing 分账。Main 从可信 Model Profile 注入窗口和输出预算；可信 token 预算存在时不会再被固定字符阈值误杀，缺少模型窗口时才使用字符保底；固定协议无法适配小窗口时返回独立的 `model_context_incompatible`。
- Run 防失控预算现在分别限制 turn、tool call 和 Provider 实际 `usage.output`。重复发送的 input/context 由每轮 context window 与 compaction 约束，不再反复累计到生成预算；集成测试用连续两轮各 `180000` input token 证明 completion guard 仍可把未完成 delivery 继续到 complete，同时实际 output 超限仍返回 budget。Provider 返回的有界 `reasoning_summary` 会作为低权重“设计思路”进入 live/durable Timeline；省略或加密 reasoning 不会被推断为可见文本。
- Renderer design-tool IPC 只序列化正式的 `requestId/call/context/captureTarget`，Main 内部 `reportProgress` 回调不得进入跨进程 payload；同一严格 request validator 已加入 host 回归测试。Preload 对带稳定 requestId 的非法请求立即返回 `renderer_request_invalid`，不再静默丢弃并等待 30 秒。一次 Renderer timeout 仍可恢复，同一 Run 连续两次 first-response/idle/total/capture timeout 会打开 run-scoped circuit 并以 terminal error 收口；成功 inspect 不清零 capture stall，模型不能再用 inspect 绕过熔断或包装为 `stopReason: complete`。离屏 capture 在 Leafer `waitViewCompleted` 永不返回时最多等待 2 秒，再由同步 export 直接计算并渲染目标树；独立 surface 与同步 JPEG 失败仍有回归覆盖。该修复对应本机 `run_1786622162070_1` 的 first-response timeout，以及 `run_1786695232930_1` 在 revision 425、609 节点文档上连续七次 `renderer_capture_timeout` 的实机证据。
- `run_1786695232930_1` 还证明两条独立 Page 链路缺陷：r417 inspection 后 Page rename 成功提交 r418，下一笔 create 被重复 exact-inspection 门禁拒绝；以及宿主把含 `|` 的 Provider tool-call ID 拼入新 Page ID，导致该 Page 进入 plan delivery 后不符合 Global Task `StableId`。现在批准后的首次 inspection 仍为必需，随后连续 Page 生命周期由当前 Renderer revision/planner 保护，跨 Page plan/节点写入继续要求 exact-current inspection；新 Page ID 会先规范化，任务投影同时兼容已落盘的有界无控制字符文档实体 ID。`inspection_required/stale` 仍持久审计，但作为模型可自行恢复的内部门禁不再堆叠红色失败卡。
- `OD-PENGUIN-01`、`OD-POSTER-01` 与 `OD-BRAND-01` 专业 fixture 从固定 prompt 生成初稿、refinement 事务、最终 `.opendesign` 和 SHA-256 manifest；`fixtures:check` 阻止生成物漂移。EditorRuntime 测试验证命名 Group、主体/翅膀/脚/围巾正式 Path、1440×1024 海报画板、可编辑 Boolean 品牌主件、复杂特性下限、零结构诊断、JSON 保存重开及 apply/undo/redo；Leafer 测试验证所有权威节点可达、Path/渐变/效果/mask/内嵌图片映射且没有 fidelity warning。品牌样张还通过固定 PathKit WASM 解析非破坏 Subtract，校验 result bounds 与 path checksum，再投影唯一 synthetic Leafer Path；该几何证据不替代真实像素 baseline。
- macOS 源码 Electron 的无弹窗 fixture smoke 已重放 `OD-PENGUIN-01` 与 `OD-POSTER-01`：固定 ID 由 Main 从仓库加载，隔离 `home`/`userData`，Renderer 使用唯一 Workspace `EditorRuntime` 和生产 Leafer 分别 capture revision 0/1，Main 核对权威最终文档并保存初稿、精修、窗口截图、最终文档与 SHA-256 report；内外双层超时保证无人值守退出。证据生成于忽略提交的 `output/professional-smoke/darwin/`，命令为 `pnpm --filter @opendesign/desktop smoke:fixture:mac -- OD-PENGUIN-01` 与 `OD-POSTER-01`。该结果不替代 live Agent Conversation/Run、打包应用或 Windows 原生验证。
- Boolean resolver 使用真实 PathKit WASM 覆盖有序四类运算、圆角 Rectangle、Ellipse、Path/Vector 原始坐标、嵌套组、fill+stroke、stroke align、transform、dash、空结果和精确缓存；Leafer adapter 测试覆盖按需加载、稳定 synthetic ID、源层隐藏、命中映射、失败 warning、dispose 后迟到结果、无关 revision 复用和删除清理。人工工具栏菜单、Inspector operation 控件、解组和 macOS/Windows 快捷键与 `opendesign_edit_hierarchy` 的三类 Boolean typed actions 复用同一 planner；源 operand edit scope 测试覆盖 Enter/双击/图层树进入、Shift+Enter/Escape/Done 退出、Tab 导航、可丢弃轮廓、逐帧 synthetic preview、单次正式提交、受控外观字段、最小 operand 删除保护、锁定可选但只读、provider retry 和上下文 warning。Agent 测试继续覆盖显式稳定 ID、preview、单次 revision/undo、世界 transform 与实时选区隔离。
- `@opendesign/import-export-service` SVG v1 使用固定 `@xmldom/xmldom 0.8.13`、`transformation-matrix 3.1.0` 与既有 PathKit provider；测试覆盖正式矢量节点、层级/transform、受控 paint/stroke/effects/mask 以及 Text 的标准 `<text>/<tspan>` 与有界 metadata。Text metadata v7 增加 UTF-16 paragraph runs、逐段 indent/spacing 与 character/paragraph 交集 tspan，并继续确定性读取 v6/v5/v4/v3/v2/v1；Fixed/Auto Width/Auto Height、具体 size、换行、溢出、大小写、装饰、ending truncation、max-lines 与完整 font face identity 继续保留。标准 SVG 输出 `font-style` 和段落定位证据，metadata 与标准属性冲突时稳定拒绝。`OD-BRAND-01` Boolean 只导出标准 result path，源 operand 不进入 SVG，re-import 得到可编辑 Vector 且 normalized geometry/bounds 一致。字体未嵌入和 consumer-dependent layout 返回明确 warning；普通第三方 Text、metadata/content/paint 篡改、DOCTYPE/ENTITY、script、stylesheet、external URL、未授权句柄、伪造结果与缺失 Boolean geometry 均稳定失败。EditorRuntime planner、Main 原生文件桥、Preload、人工 UI、Renderer worker 与 Agent handle 继续复用同一受控导入/导出链，覆盖显式 target/revision、原子事务、取消、undo、保存和有界 fidelity report。angular gradient、复杂 effects/combined masks、inside/outside stroke、SVG text outline 等未保真项返回明确 issue；打包实机与完整格式保真仍未完成。
- EditorRuntime 设计预检覆盖 Path/渐变/光晕/模糊/blend/mask/图片/文字特性计数，以及空内容、不可见/无外观、缺失或不受支持图片源、非有限 bounds、clipping Frame 完全越界和根层碎片；同一报告经 `inspect_document` 交给 Agent。
- Leafer 文档投影、Path 实例、复杂外观映射和 change-set 增量同步：未变节点保持 spec/元素 identity，不调用 `set()`；无关新增、删除和 revision 不刷新 tree/Editor，也不取消进行中的直接操作；选中节点变化只刷新该元素 bounds 并更新 editBox；asset change 会精确重投影引用节点。
- Workspace/Project/Design File、Conversation、Global Task、Provider Catalog v3/v1/v2 迁移、独立 `GlobalImageGenerationSettings v1`、两套凭据隔离和跨进程对象校验。Project autosave 专项覆盖 500 ms debounce、匹配身份/revision 后 checkpoint、保存进行中产生新 revision 的串行 drain、错配响应拒绝、失败保持 dirty 与结构化诊断，以及关闭窗口前 flush。App 级测试证明 Agent 工具在成功响应前已保存目标 revision，保存失败不向 Agent 报成功，后台 A 只保存 A 而不写 B；外部独立 `.opendesign` 不会自动覆盖。Main 生命周期测试证明普通 macOS 关窗继续保留应用、Windows 最后窗口关闭会退出，macOS 应用退出在 Renderer 异步 autosave 后恢复退出意图；Project/Agent 资源只在 `will-quit` 销毁。Design File rename 专项进一步覆盖 manifest-only interrupted recovery、稳定 File/Document/path、与文档保存串行、跨进程窄请求与响应、允许同名、tab 双击/F2、Enter/blur/Escape、空名称、失败重试、焦点恢复，以及 Project card/titlebar 同步；rename 不产生文档 save、revision 或 dirty 变化。
- Page 生命周期专项覆盖 `insert_page/update_page/move_page/delete_page` schema、无效树回滚、稳定 Page ID、名称 trim/控制字符/长度、允许同名、复制节点 ID 重映射与 asset 共享、最终位置排序、禁止删除最后一页、Page/node diff、preview/apply、undo/redo 和保存重开。WorkspaceRuntime 订阅每个文件的权威 `EditorRuntime`，活动 Page/Frame 被事务或 undo/redo 删除时回退相邻 Page 并清除越界选择；关闭或替换文件会解除订阅。人工 UI 覆盖 `+` 后立即命名、双击/F2、Enter/blur/Escape、IME、失败保留、菜单复制/删除、最后一页禁用和拖放最终 index。Agent Run 始终从当前 Page Mutation Target 开始，Composer 无常驻写范围下拉；`opendesign_manage_pages` 允许直接重命名绑定 Page，创建/复制/排序/删除或跨 Page 修改先通过 `opendesign_request_page_structure_access` 请求一次性授权。专项覆盖精确 `runId/toolCallId/approvalId`、允许/拒绝、发送回滚、旧 inspection 失效、重新检查后的跨 Page plan、旧 Run 不可操作和终态回收；批准只产生同 Run、同 Design File 的 effective execution context，不扩大到其他文件、Project 或路径。
- OpenAI Responses、OpenAI Chat Completions、Anthropic Messages canonical adapter 与 tool calling。
- 固定 `@earendil-works/pi-agent-core 0.84.1` 的 headless `Agent` 已进入 utilityProcess 唯一生产入口 `OpenDesignPiRuntime`；旧自研通用循环和生产 fallback 已删除。Agent 协议 3.11 允许 Main 在 Run 注册后通过同一 Renderer inspection/Coordinator/revision 边界预取 exact-revision 有界快照；Renderer 不能提交该字段，预检失败回退公开工具，Stop 会取消未完成预检。宿主快照只进入当前模型投影，durable journal 继续保存用户原文。正常首个 Provider turn 收到 inspect refresh、Plan、显式 read-image、Page 授权/生命周期与 compact apply；一个 Provider response 可按 Plan、材料两个 tool block 顺序执行，Main 先分配真实 Frame roots并推进 revision，再提交首个真实切片。image generation 仍等 Plan，首个材料 revision 或 Page 写入后恢复完整二十二工具，existing Plan 直接展开。没有宿主快照时保留七工具 bootstrap，公开 inspection 后为十工具。字体工具保持 deferred，不扩张首稿 surface。ModelGateway、tool/run adapter、Context budget、附件引用、completion guard、revision、approval、failure 和 pending-tool 最终化继续复用同一生产边界；确定性测试证明调用图可再少一次 Plan→首稿 Provider 往返，但不替代 Grok/GLM/Codex 与 macOS/Windows 打包产品的真实 T1 样本。见 ADR-0075、ADR-0076 与 ADR-0078。
- 生产 Provider stream 的首响应、空闲和总时限 watchdog 会 abort 实际 fetch/source iterator，并分别产生带 `first-response / stream-idle / total` phase、实际阈值和 retryable 的 `provider_timeout`。Main model request ID 始终贯通 bridge、Agent、journal、诊断与 Timeline；Provider request ID 已知时保留，首响应前未知时明确显示 unavailable。`agent.error` 会立即收口同 Run 的 partial message/tool/approval，`run.completed` 仍能沿保留的 run-to-conversation 关联刷新 durable history；开始后续 Run 时只有当前 Run 保留活动状态，旧 error/budget 转为中性历史行，无 run ID 的进程错误也会回收孤儿活态。测试覆盖三种 timeout、已知/未知上游 ID、取消不误判 error、旧无 failure journal、Conversation history 重载和诊断复制。
- Main 对 HTTP 200 后的 SSE body 中断、canonical `retryable` failure 和无 terminal EOF 最多执行 5 次可取消重连，固定退避为 400/900/1800/3200/5000 ms；Timeline 只更新一条 `正在重新连接 N/5` 活态并在恢复后折叠。每个 Provider attempt 在 Main 内缓冲到 terminal，所有失败 attempt 的半截 text/reasoning/tool event 都不进入 Pi、journal 或设计工具；最终失败只公开逻辑 started/failed 终态。专项测试覆盖首次恢复、5 次耗尽、无 terminal EOF、事件顺序、bridge 校验、UI 覆盖/恢复和 connection interruption 与 timeout 文案分流。
- 完整生产设计工具契约会穿过 Agent→Main model bridge 的真实守卫；守卫分别限制单工具 schema 和集合总大小。生产回归使用完整 system prompt、二十一个工具和 200K Model Profile，既证明短消息会进入 Provider，也证明含多模态结果的八轮工具循环会在 Run 内压缩后完成。模型可见 `apply_transaction` Schema 不依赖 `$ref/$defs`，本地仍用完整 `DesignOperationSchema` 校验。模型桥、畸形 Agent 事件与无 run ID 的进程错误会变成可见终态；设计工具桥拒绝会变成回给模型的 `tool.failed`，两者都不再只写日志后让 UI 永久等待。
- 工具执行、业务校验和设计工具桥失败会作为 `tool.failed` 回到下一轮模型上下文供其重试或解释；模型桥、Provider、Agent 进程/协议和可信 Run binding 失败才会取消 Run。两类路径分别有“继续第二个模型回合”和“相关 Run 终结/解锁”测试。
- 本机生产 `run_1786733759123_1` 证明 exact-input 抑制不足以控制无进展恢复：约 46 分钟内出现 585 events、159 tool requests、102 failures、67 次不同 `invalid_tool_input` 和逐节点组件修复。Agent Runtime 现按真实 design revision 建立第二层 circuit：同工具连续 4 次 schema 失败或跨工具累计 8 次可恢复失败仍无 revision 时分别返回 `tool_protocol_no_progress / design_recovery_no_progress` terminal，成功 inspection 不重置总量，可信 revision 前进才清零。最终组件策略检查一次返回全部 Main/Instance/ordinary 偏差的有界 `blocking:false` 质量报告；Frame/region/material/layout/revision 错误仍保持阻塞。专项测试覆盖不同参数、跨工具、inspection 与 revision reset，见 ADR-0072。
- 续跑 inspection 携带的上一 Run `unfinishedDelivery` 会进入完成门禁，仍有 pending/drafted/captured/reviewed/refined target 时模型完成文案不能放行。模型 `insert_element` 可省略由命令/宿主确定的结构样板字段，Main 规范化后重新执行完整 `DesignOperation` 与内部桥校验；replace subtree、未知字段、Instance 绕过和附件冒充 document asset 仍保持拒绝。
- JSONL 启动恢复会一次性终结孤立 started Run 和 pending tool；Global Task 同步转为 interrupted。Conversation 在 Run 注册和后续 Agent 活动时更新持久 `updatedAt`，Renderer 立即按最近活动重排。
- Main-owned diagnostic v3 事件经过严格跨进程校验，按大小轮转写入 JSONL，且不接受任意上下文字段；右下角错误通知显示稳定错误码和关联 Run，并复制包含 Conversation/Run/Request/Tool Call ID、应用版本、平台及受限 Provider failure 的诊断文本。failure 只允许 code/message/retryable、Provider/请求 ID 与 timeout phase/阈值，不接受 Prompt、凭据、路径或完整响应。
- Agent 设计生成另以静默 `design_generation_performance_v1` 诊断汇总单个 Run 的 `T_plan/T0/T1/T2/T_all`、Provider 首事件/首内容/总时长与重试、typed tool 分类往返、Renderer 首确认及 accepted/applying/capturing/persisting 阶段。`T0` 只在 ledger v2 的全部 target 获得真实 allocated revision 时记录，未观测到则明确 unavailable；空根不触发 T1。Renderer 返回实际 canvas wait 与固定 delay 总量；所有聚合有界且不含 Prompt、设计正文、节点内容或完整工具参数。自动化以 `1/4/12` target 确定性事件序列验证里程碑语义，不替代 macOS/Windows 打包产品、真实 Provider 和真实画布的性能样本。
- 高置信空白 Page 的 `new-design` model surface 由真实 inspection 结构分类，只暴露 `opendesign_generate_first_slice` 与 recovery inspection；附件、selection、continuation、已有内容、编辑/读取/导出和 Page lifecycle 意图回退 general。专项测试验证 compact input 编译为 Plan v4 + canonical transaction、allocation 与 first slice 的 committed revision 顺序、失败不推进 ledger、完成门禁承认 Main 初始 inspection，以及成功材料 revision 后 compact tool 消失。当前固定 prompt/tool 字符测量为约 `4,550 + 11,955`，旧 host-inspected general 为约 `50,343 + 22,912`，静态降幅约 77%；该数字不替代真实打包产品 T1。见 ADR-0080。
- 图片/文档附件、内容识别、完整性、大小限制、多模态 `image_ref`、显式本地路径/HTTP(S) 图片读取和未明示 source 拒绝；远程 body stream 的 15 秒超时、用户取消和流式超过 16 MB 均覆盖到 reader 生命周期。
- `openai-images` adapter 只使用独立应用级配置的 Base URL、鉴权、凭据和任意 model ID 调用 `/images/generations`，GPT Image 2 是首个验证模型；链路校验 `data[0].b64_json`、响应/图片大小、格式、凭据和取消。tool schema 不接受 Provider/Model 覆盖，也不会借用 Conversation Provider；旧 v2 选择和密文迁移已有回归测试。
- Renderer Agent 对话、属性检查器、设计工具 selection context / Mutation Target / revision、`capture_canvas` 内容寻址多模态结果、取消/继续、i18n 和桌面控件交互；对话在底部时跟随新消息与状态，用户上翻后保持阅读位置，回到底部后恢复跟随；剪贴板文件与拖放文件经 Preload API 导入，run 只接收安全附件元数据，纯文本路径粘贴保持普通输入行为。
- host-only 图片放置以单个 Page-targeted `put_asset + insert_element(image)` 事务进入 `EditorRuntime`；测试验证单次 revision、发送时存在选区也能在固定 Page 新增 asset/node、当前活动页面变化不漂移目标，以及一次 undo 同时移除 asset/node。
- 人工检查器与 `opendesign_update_image` 共用 `planImageNodeUpdate`：明确 Page/node ID 的 placement 与来源替换进入单个事务，保留现有 placement，未共享的旧 asset 可安全清理，共享 Image/Path/Vector paint 资源不会误删；文件选择取消/失败不产生 revision，Agent 执行不读取发送时或实时选区。
- 当前 Design File 的 Assets 面板直接投影权威 `assetsById/nodesById`，覆盖 Image 与 image paint、多 Page 引用计数、安全 data 预览、不受支持/缺失状态、搜索和循环定位。内部拖放只携带稳定 asset ID；Canvas 将 host 屏幕坐标转换为文档坐标，Runtime 再解析最深可见 Frame 与父级局部坐标，锁定容器明确拒绝。导入、放置、全引用 replace/relink 与零引用删除分别保持单 revision/undo，替换保留 placement/paint 字段，UI 预判与 Runtime 删除门禁共同覆盖竞态；取消、picker 失败和外部 drop payload 均不改 revision。见 ADR-0032。
- Renderer 新业务样式开始使用 Vite CSS Modules + 固定 Dart Sass 的 `Component.module.scss`；AssetsPanel 与 Canvas 拖放态已从全局入口隔离，生产 Vite 构建证明编译链可用。历史 `styles.css` 仍待按组件迁移，当前不能宣称全仓模块化完成。见 ADR-0033。
- `opendesign_edit_hierarchy` 对现有节点提供显式 ID 的编组/解组、前移/后移/置顶/置底和跨 Page root/Frame/Group 重挂载语义；宿主与人工 UI 复用同一 planner，保持世界 transform 与多选内部顺序，固定 Frame 尺寸，自底向上重算受影响 Group bounds，并以一个原子事务写入和一次撤销。人工入口包含 Layer order 菜单、macOS `⌘/⌥⌘ + [ ]`、Windows `Ctrl/Ctrl+Shift + [ ]` 快捷键，以及图层树 before/inside/after 指针拖放。测试覆盖两个平台状态下的拖放、选区保持、保存重开、undo/redo、stale revision、Page Mutation Target、锁定、混合父级、cycle、空来源 Group、不可逆 transform、无效 index、外部拖放数据拒绝、继承外观 warning 与提交前取消；这仍是自动化 DOM/Runtime 证据，不冒充 Electron 实机指针验证。
- `artboard.mode=existing` 由 Main 从当前 Renderer inspection 的 document ID、observed revision、Page roots 和完整 `parentId` 链解析，不再以空后代集合开始。Main 在计划接受前拒绝缺失/非 Frame/错 Page/断裂/循环/过期层级，失败后可重新 inspect 并重定义计划；既有锁定 Group/Frame 仍可作为 Agent 数据写入容器，插入与图片放置可进入任意真实后代，但 Page-root 散落继续拒绝。`global-task-coordinator` 测试覆盖既有 Frame、两层嵌套容器、锁定、stale revision、重新 inspection 恢复和根层拒绝。`AgentEvent 3.8` 继续保留 invariant 的 command/node/path/message，并新增受限结构化 Run failure；失败零 revision，重新 inspection 前设计写被冻结，盲重试不再次执行。按需 Page 结构授权与多目标交付账本均已有专项验证。
- `@opendesign/geometry-service` contract v4 的根入口提供不持有文档状态的纯排列结果；EditorRuntime 的 `planArrangeNodes` 将六向多层对齐、固定两端横/纵均分、明确正数/零/负数间距，以及一维/二维 Tidy up 映射为一个原子事务，并自底向上维护 Group bounds。一维 Tidy up 只修改重叠关系确定的排列轴，使用现有 gap 众数并保留另一轴；二维验证行列 overlap graph、支持不等尺寸和稀疏网格、使用两轴 gap 众数并锚定选择区域左上角。Inspector 与 `opendesign_arrange_layers` 共用该 planner；Agent 必须提供检查所得的稳定 Page/node IDs，发送时或实时选区不作为写目标。测试覆盖不等尺寸、稀疏二维网格、众数 tie-break、负间距、旋转/缩放父级、两端固定、Group rebase、保存重开、undo/redo、锁定、不可逆 transform、歧义、Page scope、无操作拒绝、事务预算，以及 macOS/Windows Renderer 状态；尚未执行真实 Electron 指针/键盘产品 smoke，Smart Selection 画布手柄和回流也尚未实现。
- 隔离的 `@opendesign/geometry-service/vector-path` 子入口固定 `pathkit-wasm 1.0.0`；实际 WASM corpus 覆盖 cubic union/subtract/intersect/exclude、复合孔洞、合法空结果、self-intersection simplify、Canvas/SVG transform、精确两段 dash、开放路径 outline stroke、fill rule、tight bounds、确定性输出、非法输入和资源预算。`boolean-resolver` 递归覆盖 Rectangle/Ellipse/Path/Vector/嵌套 Boolean、源层 fill+stroke、inside/center/outside stroke、visibility、空结果和精确 cache invalidation。所有 PathKit 对象显式释放，公共结果不暴露 WASM/Skia 对象。Renderer 仅在 Page 存在 Boolean 时加载独立 `browser-vector-path` 与 WASM 产物；Main/Preload/Agent 不包含该实现。同一 corpus 的 macOS/Windows 原生加载、性能与内存门禁仍待 CI。
- Geometry Service contract v6 的隔离 `vector-edit` 子入口保留 v5 的节点移动、手柄耦合、point mode、删除、Open/Close/Reverse，并把可编辑范围扩展到互不共享 vertex 的非分支多 contour。点击 Cut 把已有 vertex 或 path-directed line/cubic `t` 变成重合但拓扑独立的 endpoint，cubic 使用 de Casteljau 精确拆分；闭合 contour 变开放，开放 contour 拆为两条 path run，未受影响 ID 保持稳定。EditorRuntime 负责 tight bounds、transform offset、锁定/Page/revision/no-op、preview 和单事务；人工 Move（V）/Cut（X）与 `opendesign_edit_vector cut-path` 共用 planner，Agent 只提交 inspect 所得稳定 ID。Leafer、Boolean 与受控 SVG metadata v2 消费同一 network/region，多条开放 contour 不被隐式连回或填充。自动化覆盖正向/反向 cubic、line、已有 vertex、端点 no-op、stale ID、继续编辑/删除、保存重开、undo/redo、锁定、快捷键、焦点、Agent 实时选区隔离及 SVG 往返；拖拽子集由下述 contract v7 继续完成。
- Geometry Service contract v7 在同一 `vector-edit` 子入口提供有限线拖拽 Cut：对 line/cubic 求真实有限 crossing，vertex 去重并过滤 tangency，路径重叠显式拒绝；当前每条被命中的独立 closed contour 必须恰好两个交点，两块都补真实 connector，含源起点的 piece 保留源 path/region ID，extracted pieces 合并进一个新 sibling Vector。无 region 的纯描边不会被 Close helper 误补 Fill，多独立 contour 可一次切割，compound hole/open contour/凹形多交点明确返回 unsupported。在此纯单层语义之上，EditorRuntime 新增多目标 planner：接收 document-space 公共切线，对每个明确 source 的 world transform 求逆，跳过未命中层，locked/non-invertible/不支持拓扑则整体失败，并按 source sibling index 降序组装 update + insert，使全部命中 source/result pairs 只产生一次 preview/apply、revision、undo 和 save。Canvas 支持一个或多个 Vector layers 的 edit collection、逐层 trace/anchors/节点选区和 active layer，Shift 点击加入、macOS Command / Windows Control 点击切换成员；Cut 同时保存 document-space 语义线、node-local 短生命周期 guide 与 4 px client threshold，pan/zoom 只重投影。`opendesign_edit_vector cut-with-line` 继续接收单节点局部线，新增 `cut-layers-with-line` 接收 inspect 所得 Page/node IDs 与 document-space 线，结果 IDs 均由宿主生成，实时 selection 不参与解析。测试覆盖同一 cubic 双交点、多个 closed contours、逐层变换、多 overlay、成员切换、未命中跳过、锁定/不可逆/重复 ID、稳定 sibling 顺序、save/undo/redo、Agent typed targets，以及闭合标准 SVG `Z` + metadata v2 再导入。open stroke、compound hole redistribution、凹形四交点、连接/分支、connect/disconnect、flatten、outline stroke、像素基线和 macOS/Windows 打包交互仍未验收。
- Geometry Service contract v8 把同一有限线 Cut 扩展到开放 contour：按 path traversal 收集所有 transverse crossings，从后向前精确拆分并对同一 cubic 的多个交点重映射参数；第 0、2、4…片进入 retained，第 1、3、5…片进入 extracted，源起点所在首片保留 source path ID。所有开放片保持 `closed:false`，不补 connector、不创建 region 或隐式 Fill；endpoint 接触 no-op，tangent/overlap 继续失败。Runtime/Canvas/Agent 无旁路地复用同一单层/多层 planner，因此 closed/open targets 可在一次 document-space Cut、revision 和 undo 中混合。测试覆盖单/多交点、同 cubic 多交点、tight bounds/transform、save/undo/redo、Canvas/Agent selection 与原子性，以及两个开放 sibling 的标准 SVG 无 `Z`、metadata v2 和可编辑再导入。该历史切片当时尚未覆盖 compound hole、闭合凹形多交点、连接/分支、connect/disconnect、flatten、outline stroke、像素基线和 macOS/Windows 打包交互；未穿孔洞由下述 v9 继续完成。
- Geometry Service contract v9 为具有唯一 outer loop 的 compound region 增加未穿孔洞重分配：outer 仍按两个 crossing 分成闭合 siblings，每个严格位于切线一侧的 inner loop 以原 stable path/segment/vertex ID、loop direction 与 winding rule 跟随实际包含侧；源 loops 数组顺序不参与判断。`serializeVectorNetwork` 现按 region `loop.reversed` 生成有效 path traversal，使 nonzero hole 在 Leafer、Boolean 与标准 SVG 中真实镂空；同 path 冲突方向明确失败。Runtime/Canvas/Agent 继续复用相同单/多层 planner、一次 revision/undo、tight bounds 和 selection 规则，SVG metadata v2 可把一个单-loop sibling 与一个 compound sibling 恢复成同一 editable topology。该历史切片当时尚未覆盖穿过/接触 hole 与闭合凹形多交点，已由下述 v10 完成；歧义 outer、多层嵌套/重叠 region、连接/分支、connect/disconnect、flatten、outline stroke、像素基线和 macOS/Windows 打包交互仍未验收。
- Geometry Service contract v10 把穿孔与闭合凹形多交点纳入同一 Cut：精确切开的 outer/hole/concave boundary arcs 与同侧 connectors 组成无向临时图，cycle decomposition 重建全部连续 closed components。包含源 outer 起点的一块保留源 path/region ID，其余一个或多个 components 进入同一 extracted Vector sibling；outer + hole 四交点会得到两个 single-loop regions，不保留已经失效的 hole，未切 loops 则按真实包含关系继续分配。Runtime/Canvas/Agent 共享相同 planner、宿主结果 ID、一次 revision/undo 和结构化失败；Canvas 在 Cut 进行中 pan/zoom 仍提交原 document-space line。标准 SVG 将穿孔结果往返为两个单 `Z` 节点，将凹形 extracted sibling 往返为含两个 `Z` subpaths 的 metadata v2 editable network。direct-hole-only、歧义 outer、shared loops、嵌套/重叠 regions、self-intersection、连接/分支、connect/disconnect、flatten、outline stroke、像素基线和 macOS/Windows 打包交互仍未验收。
- Geometry Service contract v11 在既有非分支 network 上增加同一 Vector 的 Connect/Disconnect。Connect 只接受两个开放 endpoint：同一路径两端复用 Close，不同 path runs 确定性定向并保留文档顺序较早的 path ID；重合 Cut endpoints 合并回一个稳定 vertex，不产生零长度垃圾 segment，不重合 endpoint 才建立真实 connector。Disconnect 复用 Cut vertex 的稳定双 endpoint/path 结果。Canvas 次级工具栏与 Agent `connect-endpoints/disconnect-vertex` 共用 `planVectorSemanticEdit`、Runtime preview/apply、tight bounds、单 revision、undo/redo、保存重开和 SVG metadata v2。测试覆盖正反 endpoint、重合恢复、有距离 connector、internal vertex 拒绝、按钮启用、Agent schema/实时 selection 隔离和生产工具预算。跨 Vector layer Join、degree>2 分支、flatten、outline stroke 与原生双平台交互仍未完成。
- Geometry Service contract v12 增加稳定节点 bounds 与 node-local affine transform，并同步变换所选节点附着的 Bézier tangent endpoints。Canvas Vector Edit 新增 `Q` 节点 Lasso v1，以及同一 Vector 两个以上节点的内部移动、八向 resize 和四角 rotation hit area；Shift 支持比例缩放/15° 旋转吸附，Option/Alt 支持中心缩放。Lasso/preview 保持 session-only，pointer-up 经 `planVectorNetworkUpdate` 只提交一条 revision/undo；Agent `transform-vertices` 只接受 inspection 的 vertex IDs 和有限 6 元矩阵。专项自动化覆盖 polygon 边界、Shift toggle、resize/rotate、modifier、Bézier tangent、tight bounds、Runtime/Agent 原子事务、Canvas `Q` 快捷键和 Cut overlay 回归。path segment selection 后由 ADR-0114 完成；跨 Vector 统一节点框与 Space 中途平移后由 ADR-0115 完成；双平台打包 GUI 证据仍未完成。ADR-0113。
- Geometry Service contract v13 增加稳定 segment 与 mixed point/path deletion。Leafer Vector Edit 的 Move 点击和 `Q` Lasso 分别维护 session-only `selectedVertexIds/selectedSegmentIds`；line/cubic 完整 polygon containment 使用有界自适应曲线投影，选中路径由当前 network 派生 overlay。Delete 区分节点重连与 segment 断开，开放/闭合 contour 确定性拆分 open runs、清理失效 region，并经现有 Runtime 只提交一次 revision/undo。专项覆盖 direct click、Shift toggle、line/cubic Lasso、稳定 path ID、region、mixed selection、只读和 Cut 回归。ADR-0114。
- 在不虚增 Geometry contract 的前提下完成跨 Vector document-space 节点变换：Leafer `sky` 中只有一个 session-only 统一 box，任意不同 parent transform 下的选中节点先由 world transform 汇总 bounds，再把 move/resize/rotate matrix 共轭回各 node-local network；Shift/Option modifier 保持，resize/rotate 中 Space 冻结原操作并累计 reposition offset，松开后继续无跳变。Escape、pointer cancel、scope/tool/revision 失效恢复全部 preview 且零 revision；pointer-up 通过 `planVectorNetworkUpdates` 与 `LeaferVectorEditRequest.edits` 一次提交。Agent `transform-layers-vertices` 接受明确 node/vertex groups 与 document-space matrix，复用 `planVectorLayersVertexTransform`，缺失、锁定、不可逆、重复或 stale target 整体失败。专项覆盖不同 translate/rotate/scale、公共 bounds、Space keydown/move/keyup、单回调/单 transaction/undo、read-only 与单 Vector 回归。ADR-0115。

Node.js 在涉及 `node:sqlite` 的测试中输出 experimental warning；测试仍通过。该 API 的 Electron 长期兼容策略尚未最终确定。

## 已配置模型 API 烟测

本次另用无窗口 Electron harness 直接复用 Main 的 `ModelProviderHost`、`safeStorage` 和用户现有 `gpt-5.6-sol` / OpenAI Responses 配置完成一次真实两轮 API 调用；harness 与工作数据库副本均不进入仓库，未打开或控制任何 OpenDesign 窗口。

- 临时会话预置 12 个完整历史 Run，并让当前 `opendesign_inspect_document` 返回含 1,617,290 字符合成 data URI 的原始工具结果。
- Runtime 生成累计 checkpoint `fromSequence=1 / toSequence=18`，摘要 3,974 字符；原始 journal 仍保留完整工具结果。
- 实际送入 Provider 的两轮序列化上下文分别为 225,425 和 226,483 字符，均包含 checkpoint、均不包含 `data:image`，最大单字段为 12,011 字符。
- 两个 Provider attempt 均正常完成；Run 以 `complete` 终结，无 `agent.error`，第二轮正确返回“图片图层 1、诊断错误 0、revision 147”。

该证据复现并通过了原故障的关键边界：旧历史压缩 → 检查工具 → 超长图片字段本地剥离 → 第二轮真实模型响应。它不替代 Renderer 中粘贴/拖放、真实图片附件视觉理解或完整设计事务的后续实机验证。

## 专业设计就绪度审计

当前 `DesignCapabilityManifest v1` 记录 0 项完整可用、21 项降级可用和 1 项不可用能力；没有实机证据的能力不会标记为完整可用。`DesignDocument 1.33.0`、EditorRuntime、Geometry/Image/Text/Layout/Component/Variable/Style service、Leafer adapter、Inspector 和 Agent tools 已打通正式矢量、文字、外观、图片、响应式布局、Component/Variant/Slot、Variables、Shared Styles、视觉复核和单目标 PNG/JPEG/WebP 导出基础路径。Shared Styles 专项证据覆盖 Paint/Text/Effect/Grid registry、按类型顺序、五类节点引用、fallback 保真解绑/删除、Component → Style → Variable 投影、Canvas/SVG/位图、Local Styles 工作台/Inspector、Agent typed tool/inspection、单 revision/undo 与保存重开。Typography Core v2 + Text Layout Service v4 专项证据覆盖整节点排版、ending truncation/max-lines、单样式 Text Style、完整原文恢复、四字段 exact face identity、provider-owned 字体三态、文件级精确替换与显式 reflow。Text Range v1、Text Paragraph v2、Text List v1 与 Text Editing Session v2 分别验证 UTF-16 character range/edit remap、段落 split/merge、五级列表事实，以及真实 edit DOM 的自动列表、结构键、非空 range staging、collapsed-caret typing style、真实输入后 run 物化、caret move/Escape 清理、Inspector focus 保留、composition DOM identity 和一次 `commit_text_edit` Runtime transaction/reflow/revision；普通 input 不再逐键重建 DOM，`U+200B` typing marker 不进入 content/history。Text Run Layout v4 的 Leafer/HarfBuzz provider 同时验证 mixed face/size/fill、逐段首行缩进/段后间距、稳定 marker column、wrapped hanging indent、LTR/RTL logical-start、Auto Size、跨 run wrapping、grapheme/cluster 边界与 baseline。Page/Frame capture 与 Text/ancestor PNG/JPEG/WebP export 继续从冻结 exact-revision scene spec 重建。Component Service v5 已验证 Canvas/Layers/Inspector/键盘统一 selection、stable sourcePath 派生目标、Slot 内 nested Instance ownership、revision 失效回退与安全 override；Slot-in-Slot 按 Figma 公开模型永久失败封闭。真实字体跨平台栅格、连接/分支 network、custom list markers、高级 decoration、OpenType、variable axes、字体打包与授权迁移、更多 Variable/Style binding、跨文件 Library/publishing、DTCG/REST/Plugin adapter、原生 IME/undo smoke、像素基线和双平台 GUI 仍未验收，因此相关能力保持 `degraded`。

仓库当前已有独立 `@opendesign/geometry-service` contract v10：确定性排列已进入产品链，固定 PathKit provider 提供路径布尔、simplify、transform、dash、outline stroke、稳定 editable-vector 拓扑与多层 Cut；EditorRuntime 负责 document-space 编排、transform inverse、稳定 sibling 与原子事务。`DesignDocument 1.33.0` 和唯一 Runtime 同时拥有正式 Vector Network、Boolean、Text character/paragraph/list runs、Auto Size、Typography Core v2 与 exact face identity。Text Layout v4、Text Range v1、Text Paragraph v2、Text List v1、Text Editing Session v2 与 Text Run Layout v4 分别负责整节点测量、字符/段落范围、列表、真实编辑会话样式与 rich/complex/list shaping。`commit_text_edit` 把 final content、optional canonical runs 与最小 paragraph patches 在一个 transaction 中校验、remap、reflow 并生成一个 revision/undo；它不暴露给 Agent/MCP，Agent 继续使用 inspected non-empty range tool。公共 `reflow_text` 的 expected-face 竞态门禁保持不变。递归 Boolean、SVG metadata v8、Figma styled segments、Leafer/HarfBuzz exact-revision projection、人工 Inspector 与 Agent typed transaction 继续复用同一权威事实。custom marker、高级 decoration、OpenType/axes、字体打包/授权迁移、text-on-path、新版 bidi 和双平台原生输入/视觉证据仍未完成。`@opendesign/layout-service` contract v6、Component Set/VARIANT/Slot、Component Service v5 派生层统一选择/安全 override、Variables Core、Shared Styles、受控 SVG 和图片 placement/crop 路径保持现状；Slot-in-Slot 按 Figma 公开模型永久失败封闭，更多 Variable binding、跨文件 Library、DTCG/REST/Plugin adapter 与 AI 图片编辑仍在后续路线图。

Agent Runtime 与 Main 当前强制执行“Main exact-revision inspection（失败则公开 inspect）→ typed Plan v4 (`targets: 1..N`) → 原子分配真实 Frame roots → active target 实质初稿 → `capture_canvas` → typed visual review → refinement → final capture → verified → 下一 target”。单个设计只建立一个 target；明确的一套页面、方案或物料逐项建立。`DesignDeliveryLedger v2` 记录 `pending → allocated → drafted → captured → reviewed → refined → verified`；allocated 只有真实 Frame/revision evidence，空 Frame 不能 capture/review/verified 或计入完成度。Plan 分配全部 create roots 只产生一个 revision/undo 且立即 autosave，不预建 Region/Group；失败不推进 ledger。材料写只允许 active target。计划 Region 仍必须按稳定 ID 建为直属 `Group/Frame` 并在同一事务带真实内容。apply 的可选 semantic steps 必须按顺序一次覆盖全部 command；每个成功步骤产生真实 revision 后才进入 progress/Timeline，终态可持久重建；无 steps 时整笔一次提交，不按命令数拆。仅平移 Frame 可从最新 inspection 继续，resize/rotate/reparent/delete/undo 要求 inspect/amend；纯 insert 仍经过 planned rebase guard。completion guard、final capture 结构与 layout quality、跨文件 runtime 路由、离屏截图和超大结果边界保持不变。该流程改善首个真实页面时间和过程可信性，但不单独保证真实 Provider 提速、审美或跨平台产品 smoke；后续仍按 roadmap 的固定样张、专业 service 与人工验收推进。见 ADR-0050 与 ADR-0075。

`DesignLayoutQualityReport v6` 现在从 exact-revision Component Service 投影检查完整 Instance subtree、稳定 `instanceId + sourcePath` provenance、内部 clipping ancestor chain 和派生 Text production-provider evidence。确定性 error capture 不进入 Visual Review；Coordinator 返回 `repair-layout-overflow`，`opendesign_arrange_layers` 以一次事务扩展安全 trailing-edge artboard/持久 clipping Frame，unsafe 结构失败封闭并要求 inspect 后显式修复。专项自动化覆盖派生 root/child 裁切、严格 report schema、artboard 与内部 Frame 扩容、单 revision/undo 和清洁 recapture 后恢复 verified；审美独立 critic 与生成 rubric 不由该几何切片冒充完成。见 ADR-0116。

生产 Frame capture 的视觉门禁已改为无作者上下文的 stateless critic：Main 复用 Run provider/model 身份与内容寻址 JPEG，但不继承作者 reasoning effort；请求只含 latest brief、active target contract 和 deliverable review skills，不含作者消息、reasoning 或工具历史。严格内部 tool schema 返回每项 1..5 分和像素证据；Draft 至少返回两条可执行 refinement，附带 prose、重复/额外 tool call、缺失/额外 criterion 均失败封闭。宿主自行计算 critical/ordinary threshold、平均分、failed criteria 与 refinement。Logo 专项阻断通用方块/字母变体、弱黑白轮廓、counterform、16/24/32px、Wordmark 和仅缩放 App Icon；Draft 自动 reviewed，Final 低分保持 refined，无 Critic 或未 pass 都不能 verified。自动化已覆盖请求隔离、attachment shape、响应唯一性、critical 单项不可补偿、全项达标、revision binding、draft/final ledger；固定样张人工盲评、独立 critic model 配置、高阶 Pattern 和持久 Brand Context 仍未完成。见 ADR-0117。

Design Reference Strategy 现把 Run raster 附件明确分为 style/composition/brand reference、content asset 或 ignore；有图 Run 缺少分类、漏图、跨 Run ID、重复 ID 或超过两张 active visual reference 均在 Plan 注册前失败封闭。compact first-slice 编译保留同一策略。Critic 多模态顺序固定为 exact-revision delivery JPEG 在前、最多两张授权 reference 在后，并新增 critical、非补偿 `reference-adherence`；content asset/ignore 不重复进入 Critic。专项自动化覆盖 schema、compact compile、Main 授权绑定、图片顺序和低分阻断。该证据不冒充跨文件 Pattern catalog、持久 Brand Context 或模板/Library。见 ADR-0118。

Design File-local Component catalog 由 Renderer 从同一 inspection revision 投影，最多 64 项并明确 total/truncated；当前 scope Component 优先，其他条目只暴露名称、说明、变体/属性摘要和用量，不暴露 Main subtree。Main 对目录执行 exact-key/唯一 ID/计数/上限校验，Plan `reuse-component` 只接受当前目录 ID，交付内 Instance 继续由 typed Component Service 创建并在最终 inspection 验证链接。专项自动化覆盖目录排序/边界、跨进程解析、普通与 compact Plan、stale ID 拒绝、system/tool context 预算；该证据不冒充跨文件 Library 或普通结构自动 Pattern 发现。见 ADR-0119。

## 构建结果

Vite 生产构建完成四个环境。共享门禁从实际 `out/` 检查每个预期产物唯一、存在且非空，不要求 macOS 与 Windows 的输出和某次本机构建保持精确字节相等。包体治理应使用明确的大小预算或回归阈值，并按目标平台分别记录，不能拿单个平台的一次构建字节数阻断其他平台。

<!-- verification-facts:build:start -->

| 产物                       | 共享门禁   |
| -------------------------- | ---------- |
| Renderer 主 JS             | 存在且非空 |
| Leafer Web chunk           | 存在且非空 |
| 按需 Vector geometry chunk | 存在且非空 |
| 按需 PathKit WASM          | 存在且非空 |
| Electron Main              | 存在且非空 |
| Preload                    | 存在且非空 |
| Agent                      | 存在且非空 |

<!-- verification-facts:build:end -->

构建提示 Renderer/Main 存在超过 500 kB 的 chunk。当前不影响构建成功，但需要在性能阶段评估动态加载与 Rolldown code splitting，不能通过移除 sourcemap 或隐藏警告冒充优化。

构建图不包含 OpenPencil、旧 canvas preload、旧 Canvas2D 产品包、CanvasKit 及其 WASM 或隐藏本地设计 server。固定 PathKit WASM 仅作为上表所列的 Renderer 按需资产存在。

## Electron 安全基线

当前代码保持：

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`；Renderer CSP 仅为按需 PathKit 增加 `'wasm-unsafe-eval'`，不允许通用 `'unsafe-eval'`。
- Preload 暴露窄、类型化且运行时校验的产品 API，不暴露原始 `ipcRenderer`。
- Renderer 导航使用精确开发 origin/打包入口；新窗口默认拒绝，HTTP(S) 外链交给操作系统。
- Conversation Provider 与全局图片生成凭据使用不同的 Main-only `safeStorage` 槽；Renderer 和 Agent utilityProcess 都不接收密钥。
- 附件由 Main 校验内容、大小、MIME、摘要和存储完整性；utility/model bridge 不接受任意路径或 inline base64。
- 模型设计写入必须经过 typed tool、Main run binding、Renderer scope/revision 校验和唯一 `EditorRuntime.apply()`。

## 仍需实机验证

以下项目没有被本次自动化替代，不能描述成已完成：

1. 在本仓库启动的 macOS/Windows Electron 实例中运行大型 Agent 事务，确认有效阶段和父级优先 wireframe/fade 清楚但不过慢；生成期间持续 pan/zoom/resize，确认 Leafer 蓝色 editBox 始终贴合节点，无巨大角、残影、viewport 锁死或输入丢失；停止、失败、切页、Reduced Motion 和截图后不残留半透明节点或 Agent 线框。
2. 复杂渐变、光晕、模糊、blend、mask 和高级描边组合的视觉保真。
3. 属性检查器修改后画布同步、多选对齐/均分/明确间距的图标与键盘焦点、文本中文输入法、缩放中的 DOM TextEditor 和焦点恢复。
4. 粘贴/拖放附件、本地路径/URL `read_image`、全局 GPT Image 2 `generate_image` 到真实多模态模型，以及 `place_image` 的完整用户流程。
5. 从三个固定 fixture 生成 macOS/Windows 真实 Leafer 像素 baseline，并重放完整 Agent“写入 → 截图 → 修正 → 截图”轨迹。
6. 在 macOS/Windows 打包应用中实机验证 SVG 选择导入、撤销、选区/Frame 导出、fidelity report 和失败恢复，并验证 `OD-BRAND-01` 导出/re-import 的真实 Leafer 外观。
7. 大节点量、复杂文本、图片/效果的帧率、内存和资源释放基准。

实机验证只能连接明确从当前仓库 `apps/desktop` 启动的实例，不能控制用户的其他 Electron/Chrome 进程或个人浏览器配置。

## 发布验证状态

本次在 macOS arm64 命令行执行 `package:mac`，由 Vite 8.2.1 在当前平台重新生成 Main/Agent `.jsc`，electron-builder 26.15.3 生成以下未签名产物：

- `OpenDesign-0.0.0-mac-arm64.dmg`

`verify:package:mac` 已检查目标平台/架构命名、非空 DMG、unpacked `app.asar`、`icon.png`、`THIRD_PARTY_NOTICES.md`、Main/Agent bytecode wrapper、`.jsc`、bytenode runtime，以及 protected output 中不存在 sourcemap。打包过程没有启动 OpenDesign 窗口；按用户要求，本次未运行 packaged executable smoke。

仓库的 macOS/Windows 原生 workflow 顺序为 `verify → native protected package → package content verification → packaged Agent smoke → artifact upload`；历史 workflow 已在两个平台通过。当前 worktree 修改了 NSIS 安装模式，尚无对应 Windows 原生产物，因此以下发布门禁仍未完成：

- Windows 当前 commit 的原生 verify、可选目录 NSIS、packaged smoke，以及干净安装/升级/卸载和用户数据保留。
- macOS 干净安装、升级/卸载、Developer ID 签名、hardened runtime 和 notarization。
- 两个平台的窗口、菜单、输入、画布、文件、`safeStorage`、Provider 与崩溃恢复产品 smoke。
- Linux 原生构建和 protected bytecode（当前不阻塞 macOS/Windows 里程碑）。
- 从实际发行物生成的完整第三方许可证清单。

因此历史证据证明 macOS/Windows 可以生成安装包并运行 packaged Agent smoke；当前安装器变更仍需 Windows 原生复验，两个平台都未达到完整发布门禁。
