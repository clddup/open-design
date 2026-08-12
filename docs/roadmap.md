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
- [x] 建立第二阶段 Agent 画布结构过程：最初的 `DesignPlanToolInput version: 2` 声明单画板位置/尺寸和稳定区域 ID/bounds，version 3 继续兼容并在当前 Page 投影首个未完成 target；只有 Main 匹配接受的计划才能在 Leafer 内置 editor `sky` 的不可命中底层显示 Frame/区域 skeleton。`create` target 的计划节点 ID 在所有 target 间全局唯一，Main 从 accepted plan 编译新画板/区域的可信 Page、parent 和父级局部几何；`existing` target 的 region 仅保留为逻辑规划/审查区域，不投影成待物化紫框，也不要求重构真实图层树。真实顶层 Frame 只平移时骨架/cursor 跟随当前 transform；骨架使用 `sky⁻¹ × tree`、cursor 使用 `sky⁻¹ × screen`，selection/EditBox 保持在其上方。已建立目标内的纯新增事务经 Renderer 复核尺寸、轴对齐和祖先链后安全 rebase，resize/rotate/reparent/delete/跨 Page 或覆盖写仍要求重新 inspect。create 模式正式直属 `Group/Frame` 出现实际内容后逐区替换，空容器不冒充完成；停止、终态、错误、切页、截图和 dispose 均清理，静态 Reduced Motion、pan/zoom 与 selection 分层已有自动化证据。骨架不进入文档、revision、history、selection、保存或导出。
- [x] 建立第三阶段 Agent 语义过程：accepted plan 后才显示独立紫色 Agent cursor 与本地化阶段标签；位置先锚定待完成区域，再只跟随已提交 Agent revision 的新增节点 focus point。typed tool name/结构化 progress 驱动 `structuring/building/assets/reviewing/refining/recovering`，不展示 Provider 自由文本；完成态清除旧百分比和 live/durable timeline progress detail。cursor 不命中、不借用 selection，支持 pan/zoom、离屏隐藏、180 ms 低频位移、Reduced Motion、`aria-live`、停止/截图/终态/错误/切页/dispose 清理，并继续与正式文档分离。
- [x] 将 material write → capture → visual review 门禁绑定到权威 revision，而不是视口或选区状态：baseline/pre-write、重复和早于最近 material revision 的截图分别返回稳定 `design_workflow.*` 恢复指令；系统提示禁止原样重试，live/durable 时间线默认折叠可自动恢复的门禁失败。pan、zoom、全屏、窗口尺寸和选择变化不改变 revision/mutation target。
- [x] 将视觉审查从活动 viewport 迁移为绑定 Run Mutation Target/计划 Frame 的确定性离屏 Leafer 渲染：Main 选择已建立的计划 Frame，否则选择绑定 Page；Renderer 按 captured revision 导出 content tree，不包含 selection/skeleton/cursor/reveal。用户在生成期间切换 Design File、pan、zoom、resize 或查看其他区域只能改变本地视图，不能改变 Agent 收到的审查画面、revision 或 mutation target。
- [x] 打通单目标 Run 的多 Design File 后台执行：每个打开文件保持一个权威 `EditorRuntime`，Renderer 按可信 `documentId` 路由工具并在 Run 期间 retain 文件。A 的写入/capture 不刷新 B，也不把 A 的生成 overlay 投到 B；切回 A 直接显示最新 revision。跨文件多目标 Run 仍按 ADR-0006 保持未实现，不把此能力扩大宣传为跨文件原子事务。
- [x] 为 Project Design File 建立按稳定 Project/File/Document 身份绑定的自动保存：人工事务以 500 ms debounce 落盘，同一文件的保存串行化且保存期间产生的新 revision 会继续 drain；只有落盘响应身份/revision 匹配当前目标才 checkpoint。Agent 设计写入在工具成功返回模型前立即 flush 对应文件，后台 A 不保存或刷新当前 B；窗口关闭或应用退出前 flush 全部 pending 文件。Main 把资源销毁延后到 `will-quit`，macOS 在异步 flush 后恢复原退出意图，Windows 走同一生命周期状态机。失败保持 dirty，并通过 `design_autosave_failed` 诊断通知用户。独立打开的外部 `.opendesign` 文件仍使用显式 Save/Save As，不静默覆盖。
- [x] 打通 Project Design File 的真实重命名：编辑器 tab 双击或 `F2` 进入内联编辑，`Enter`/失焦提交、`Escape` 取消，失败保留输入以重试；请求只携带稳定 Project/File ID 与规范化名称。Main 通过 manifest-only journal 原子更新 descriptor，不改 `designFileId`、`documentId`、relative path、画布 revision、history 或 dirty 内容；与 autosave 共用 Project mutation queue，允许同名文件，macOS/Windows 共享交互与测试。
- [x] 打通 Design File 内完整 Page 生命周期：公共事务支持创建、命名、复制、最终位置排序和删除，并产生 Page/node diff、单 revision、preview、undo/redo 与自动保存；复制重映射整棵节点树但共享文档级 assets，删除保留 assets 且禁止删除最后一页。Pages 导航提供 `+`、双击/`F2` 内联命名、Enter/blur/Escape、菜单复制/删除、拖放排序和错误恢复；事务或 undo/redo 删除活动 Page 时回退相邻 Page。`opendesign_manage_pages` 复用同一 planner，宿主生成 ID；Agent 默认 Page 可直接重命名绑定 Page，创建/复制/排序/删除或跨 Page 操作改由一次性 Page 结构授权解锁，不再要求用户发送前选择内部 Design File scope。
- [x] 修复 `artboard.mode=existing` 的既有画板误判：Main 从当前 revision 的 `inspect_document` 结构结果验证 Frame/Page 身份并解析完整权威后代集合，既有锁定 Group/Frame 仍可作为 Agent 数据写入容器，新增图层与图片可进入任意真实后代；existing plan region 只表达逻辑审查范围，不再强制变成精确 bounds 的画板直属 Group/Frame，也不会为了匹配计划 ID 重写真实几何。最终验收验证真实 Frame 后代中存在材料内容与完整 ledger 证据；缺失、错 Page、非 Frame、父链循环和 stale inspection 使用稳定 `design_workflow.inspection_* / existing_artboard_invalid` 恢复码。
- [x] 保留 `EditorRuntime` invariant 的 `commandId / nodeId / path / message`，让 Renderer/Main/Agent journal/诊断 UI 共同返回结构化、可复制的可恢复 tool result；失败事务不写文档、不终结 Run，但 Runtime 会阻止后续设计写，直到成功重新 inspect。相同 fingerprint 与相同输入的盲重试有界并被宿主抑制；可信 Run binding、协议损坏等运行前置失败仍终结 Run。该切片升级为 `AgentEvent 3.6`，旧 journal 中只有 code/message 的失败继续可读。
- [x] 移除 Composer 常驻“当前页面 / 设计文件”写入范围下拉：Run 默认静默绑定当前 Page，只显示低权重 Page/选区上下文；新建/复制/排序/删除 Page 或跨 Page 修改时，模型通过 `opendesign_request_page_structure_access` 请求一次性“将修改 Untitled 的页面结构”授权。Main 精确绑定 `runId + toolCallId + approvalId`，只接受“允许本次/不允许”；批准后清除旧 inspection，并仅为本 Run、当前 Design File 解析 effective document execution context，终态自动回收。绑定 Page rename 不需扩权，拒绝不得重试绕过；Working Set / 原始 Mutation Target / 临时 Capability 不从选区、Project 或彼此静默推导。见 ADR-0029。
- [x] 将单目标 plan/review 门禁扩展为持久化结构化交付账本：`DesignPlan v3` 按用户实际需求声明 `1..N` 个交付 target；单个设计只建立一个 target，明确的一套页面/方案/物料逐项建立 target，不擅自扩张或折叠。每项绑定稳定 Page/Frame/root ID，状态按 `pending → drafted → captured → reviewed → refined → verified` 推进；宿主以权威文档、精确 revision、两次 capture/review/refinement 证据验收，不信任模型口头“完成”。create target 另验证计划 region 的直属容器和非空实际内容子树，existing target 则验证真实画板后代材料内容，不把逻辑 region 强加给既有层级。任一必需 target 未完成时 completion guard 在同 Run 自动续跑，持久任务可在中断后的新 Run 从首个未完成项恢复，UI 显示 `N/M verified`；超大工具结果仍单独保留有界账本摘要。Provider 超时后由 Main 自动创建新 Run 尚未实现，继续由下一条用户消息触发恢复。
- [x] 把“空壳首稿”和不透明 union error 前移到正式 revision 之前：新 target 的首个事务必须带真实可编辑内容，当次插入的每个计划区域也必须同时带非容器内容，拒绝时 ledger 保持 pending；模型可见 paint/effect schema 按具体类型声明必需字段，EditorRuntime 对 property patch 合并真实节点后按 `kind` 校验，TypeBox union 展开为具体 field path，Renderer 将 issue 归因到最后一个真正修改该节点的 command。视觉审查继续负责构图与审美，不再作为发现空 Frame/Group 或节点 schema 错误的第一道防线。
- [x] 修复复杂设计在视觉审查后以 budget 提前停止：Run 生成预算只累计 Provider `usage.output`（已含 reasoning），不再把每轮重复 input/context 反复收费；单轮输入继续由可信模型窗口与 compaction 门禁负责，turn/tool/output 三层仍保留防失控上限。Provider 明确返回的有界 `reasoning_summary` 按 Run 合并为默认折叠的低权重“设计过程”，展开后明确它是模型摘要而非系统测试/已执行操作；省略/加密 reasoning 不反推隐藏思维链。
- [x] 将活动 Run 时间线改为 durable-first 单调投影：`message/tool/approval/run` 的 journal checkpoint 在 Run 未结束时也 debounce 回读 `session.history`，完成节点由 durable item 接管；live `message.delta` 按 block 合并、`tool.progress` 按 tool call 覆盖，移除会吞掉旧消息的 200-event 截断。Conversation 切换、长流、重试和历史回读只能补全或更新同 ID 状态，不能让已显示消息消失。
- [x] 收口 Agent `insert_element` 的层级契约：模型输入中的容器 `childIds` 不再和后续 child insert 重复写入，Renderer 在可信事务边界验证每个预声明 child 都有更晚且 parent 匹配的 insert 命令，再把 `childIds` 规范为空；EditorRuntime 只依据有序 child command 的 `parentId/index` 建立层级。缺失 child command 在 revision 前返回可恢复的明确错误，合法父子同批插入不会产生 duplicate child ID。
- [x] 收口 Agent 历史终态与超时表达：新 Run 开始时把旧 Run 的“已达到上下文限制”等 error/budget 终态降为保留审计的中性历史行，不再冒充当前阻塞；Provider 首响应、流空闲、总时限使用独立 watchdog 和结构化 `provider_timeout`，Main/Agent/journal/diagnostic/Timeline 保留具体 phase、阈值、retryable、已知 Provider request ID 与始终可用的本地 model request ID。首响应前拿不到上游 ID 时明确显示 unavailable，不伪造；旧无 failure journal 继续兼容。见 ADR-0030。
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
- [x] 在同一 Run 的每个 Provider turn 前重新预算；旧 assistant/tool 段超限时生成临时有界 checkpoint，保留当前用户原文和最近完整 tool call/result 段。完整生产 system prompt、十八个工具、200K Model Profile 与八轮多模态工具循环已证明第八轮会压缩后继续；结构化工具结果同时具有单字段和整体投影上限，原始 journal 不删除。
- [ ] 将通用 Agent loop 迁移到固定 `@earendil-works/pi-agent-core` 的 headless `Agent`，通过 OpenDesign adapter 保留 Main 模型/凭据代理、typed design tools、Conversation journal、revision 和 plan/review 门禁；阶段 0—3 已完成核心、三种 API identity、`AgentEvent 3.8`、唯一 journal、十八个生产工具、completion guard、取消/结构化失败分流、累计 checkpoint、逐轮压缩、内容寻址多模态/资源句柄和重启恢复。utilityProcess 唯一入口已切为 `OpenDesignPiRuntime`，旧自研循环与旧测试已删除，历史 tool-call ID 会从 journal 预加载以阻止重放执行。当前只剩同一 commit 的 macOS/Windows protected package 和 packaged Agent smoke 门禁，通过后才勾选完成；不得重新引入双循环/fallback。固定 `0.84.1` 的 `AgentHarness.prompt()` 仍抛出 `HarnessNotImplemented`，不得把未实现的 durable harness 接入生产或建立第二份 session 状态。
- [ ] 接入服务端 Model metadata 探测、Provider/tokenizer/image 精确预算和可选语义 compactor；上游仍返回 `context_too_large` 时只允许重新预算和紧急压缩后自动重试一次。
- [ ] 补万级节点、连续 Agent revision、效果/图片节点、选区/editBox、pan/zoom 的真实 Electron 帧时间与内存基准，并据此继续压缩结构 ID 遍历和资源失效成本。

完成条件：全仓 `pnpm verify` 通过，关键 Electron 交互写入 `verification.md`，ADR-0009/0010 的验证项有实际证据。

## P0-C：固定样张与能力事实门禁

- [ ] 使用当前仓库启动的 Electron 实例执行 `OD-PENGUIN-01` 和 `OD-POSTER-01`，保存原始 prompt、最终 `.opendesign` 文件、两次 `capture_canvas`、中间 refinement、截图、Conversation/Run ID 和相关诊断。
- [x] 建立可重放专业样张 fixture：固定 prompt、初稿 `.opendesign`、一次 refinement 事务、最终文档和 SHA-256 manifest 均由确定性生成器维护；`EditorRuntime` 与 Leafer 测试从干净文档验证命名 Group、正式 Path、复杂外观、图片、诊断、保存重开和 undo/redo，不依赖开发会话临时状态。
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
- 继续按垂直切片迁移专业基础文档版本；`DesignDocument 1.10.0` 已统一正式 Line/Arrow、Polygon/Star、editable Vector Network / Pen 创作、已有单轮廓节点编辑，以及 Fixed/Auto Width/Auto Height 文字、具体权威尺寸与换行/溢出，后续仍需分支与多轮廓、Slice、constraints/layout、Text/Font rich typography 与显式 reflow、图片 adjustments、Component/Instance/Variant、style/token binding 和 export settings。
- 为 Geometry、Layout、Text/Font、Image 和 Import/Export service 建立窄、版本化的输入输出接口。服务只能返回纯结果、诊断或候选 `DesignOperation[]`，不能保存第二份文档或直接修改 Leafer 场景。
- 提供确定性迁移、未知版本拒绝、保存重开、preview、undo/redo、Agent schema、provider 映射和 fidelity warning 测试；不得把长期语义藏进 `extensions`。

完成条件：能力清单与真实 UI、Agent tool catalog 和 adapter 行为一致；所有 service 接口存在契约测试；未实现能力保持明确 `unavailable`，不能通过占位 JSON 或提示词伪装支持。

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
- [ ] 继续完成 crossed-hole boundary stitching、闭合凹形多交点、连接/断开、分支网络、套索、多节点变换框、flatten、outline stroke 与正式 Slice；补真实像素 baseline 和 macOS/Windows 打包产品交互证据。
- 扩展剩余图层与精确变换工作流：重命名、批量属性、单层相对父级对齐、Smart Selection 画布间距手柄与回流、翻转、原点、智能吸附、参考线、标尺、像素对齐、画布直接操作时自动归属，以及显式跨容器键盘目标选择。
- 人工命令与 Agent typed tools 调用同一 geometry service，并把结果作为一个可预览、可撤销的 `DesignTransaction` 应用。SVG 导入导出必须经过同一公共 Path 语义，不能泄漏 provider 私有命令。

完成条件：`OD-PENGUIN-01` 可以通过人工 Pen 和 Agent 工具继续编辑，不需要重建整个轮廓；`OD-BRAND-01` 的布尔、outline 和 SVG 往返保持结构、bounds 与视觉基线；所有动作支持保存重开和 undo/redo。

## P3-A：文字、图片与海报交付

- [x] 增加 `DesignDocument 1.9.0` 固定文字框换行与溢出：`none/word/character` 和 `visible/clip/ellipsis` 进入正式 schema、`1.0.0–1.8.0` 迁移、EditorRuntime preview/save reopen/undo/redo、人工 Inspector、Agent typed schema、Leafer Text 投影和受控 SVG Text metadata v2；metadata v1 继续确定性读取。旧 adapter 错把 Box `overflow` 写给 Text 的路径已删除；见 ADR-0035。
- [x] 增加 `DesignDocument 1.10.0` 与 `@opendesign/text-service` contract v1：Fixed、Auto Width、Auto Height 进入 discriminated schema，`1.0.0–1.9.0` 迁移为 Fixed；EditorRuntime 在 insert/update/replace 的同一 preview/apply 中调用固定 Leafer 2.2.9 provider 并持久化具体 size，provider 未就绪返回结构化可重试失败，字体 fallback 返回 fidelity warning。Workspace 向活动、后台和后来打开的 Design File 同步 provider；单击/拖拽创建、Inspector、Agent schema、直接 move/resize、保存重开、undo/redo 与 SVG Text metadata v3/v2/v1 已贯通，不使用字符数估算；见 ADR-0036。
- 扩展 Text/Font service，支持 max-lines、字体 asset/授权/替换、字体加载后的显式 reflow、富文本 runs、paragraph、列表、OpenType/variable font 和共享文本样式。文字 shaping 必须在 macOS 和 Windows 上产生明确的兼容结果或 fidelity warning。
- 扩展已建立的 Image service：当前已有 Image 节点的版本化 placement、crop/focal 几何、Leafer 投影、检查器、来源替换和专用 Agent update tool；下一步补齐画布直接 Crop、mask、透明背景、基础 adjustments/filter、资源变体、引用恢复和大图生命周期。增加独立 `edit_image` adapter/tool，支持局部重绘、扩图、背景替换、重打光和风格统一；参考图、原图和 AI 派生资源必须分离并可追溯，任何编辑都不得覆盖原始 asset。
- 扩展 P0-B 已建立的专业位图导出，补海报交付所需的高级颜色、资源和格式保真；导出继续读取 DesignDocument 和受控资源，不能把当前画布截图当作交付产物。
- 为人工属性面板和 Agent 增加文字、裁剪、替换、调整和导出的语义命令；长任务必须展示进度、支持取消并返回稳定产物或明确失败。

完成条件：`OD-POSTER-01` 在保存重开后保持字体、图片裁剪和复杂外观，并能输出 1×/2× 专业位图；导出尺寸、alpha、资源引用和视觉基线通过自动化及 Electron 实机验证。

## P3-B：布局、组件与设计系统

- 建立 OpenDesign-owned constraints、horizontal/vertical auto layout、wrap、padding/gap、对齐、hug/fill/fixed、min/max、absolute child、layout grid 与响应式求解语义。Layout service 输出确定性布局或候选事务，不保存第二份布局状态。
- 建立 Component/Instance/detach、nested instance、property/override、Variant/State 与共享样式，并提供循环依赖和失效引用诊断。
- 建立 Design File/Library 级 Design Token/Variable 系统，而不是应用设置：支持 Color/Number/String/Boolean 等 typed value、Collection/Group、Mode、同类型 alias、属性 scope/binding，以及 primitive → semantic → component 分层。人工 UI 与 Agent 必须共用同一版本化命令；主题/模式切换、alias 继承、循环/失效引用、Library 发布与消费都产生确定性结果。DTCG JSON 导入导出通过独立 service 返回保真报告，不把 token 占位字段描述成已可用。
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
- 增加渲染诊断与可读性检查，覆盖主体比例、层级、留白、对比度、文字可读性和关键内容裁切。启发式诊断必须标注置信度，不能把审美模型输出伪装成确定性错误。
- 为对齐、布局、布尔、裁剪、组件、变量、导入和导出提供语义化 typed tools，避免模型通过大量低层坐标和节点重建完成专业操作。
- 低优先级开放用户级与 Project 级设计 Skill/风格规范：记录来源、版本、内容哈希和权限，只影响设计方法、风格与评审标准，不能覆盖系统策略、扩展 Mutation Target 或替代底层设计能力。当前 `@opendesign/discovery` 只有隔离发现/优先级解析，尚未接入生产 Agent、管理 UI 或权限审计链，因此不得宣称已支持自定义 Skill/提示词。
- 保留“写入 → `capture_canvas` → refinement → `capture_canvas`”可信完成门禁，并加入结构诊断结果、渲染失败和导出失败的阻断条件。截图次数本身不能证明设计质量。
- 使用固定 prompt、参考资源、模型配置、工具轨迹、最终文档和视觉评分运行回归。任何提示词、模型 adapter、工具 schema 或渲染后端变更都必须重放受影响样张。

## 持续门禁

- 不恢复 OpenPencil、Canvas2D、手写选择框、隐藏 fallback 或双写状态。
- OpenPencil 可作为持续的产品行为、工作台、Pen/Path、SVG、图片和模板验收基准；参考必须固定提交并转译为 OpenDesign 公共语义与测试，不能把上游实现直接变成第二套产品内核。
- 不让模型、MCP、skills 或 Renderer 获得 Leafer 对象、原始凭据、任意路径或裸 shell。
- 新第三方依赖必须固定版本并更新 ADR、`engine-baseline.json`、第三方通知和兼容性测试。
- macOS 与 Windows 是同级发布门禁；不能用一个平台的构建或自动化结果替代另一个平台的原生验证。
- 文档只描述当前事实或明确目标；未验证能力不得宣传为完成。
