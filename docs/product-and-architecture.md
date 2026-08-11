# OpenDesign 产品与架构

## 1. 产品定义

OpenDesign 是 AI-native 通用设计平台。用户可以直接操作专业画布，也可以用自然语言、上下文命令和可组合工具让 Agent 理解意图、生成方案、修改对象并解释结果。

UI 设计是首要能力和最先打磨的工作流，但不是产品边界。统一的文档模型、设计命令和引擎适配层应能承载界面、Logo、海报、品牌物料、社交图片及未来设计类型，避免形成只认识 Frame 和组件库的 UI 专用内核。

### 1.1 当前实现

截至 2026-08-11，仓库当前具备：

- OpenDesign 自有的 `DesignDocument 1.8.0`、正式 Line/Arrow、Polygon/Star、互斥的精确 SVG path-data / editable Vector Network、持久 Bézier point mode、非破坏图片 placement 与非破坏 Boolean Group，以及带稳定 ID/名称的多 Page。Page 创建、重命名、复制、最终位置排序和删除与节点操作共用事务、preview、单调 revision、Page/node diff、history、undo/redo、checkpoint；文档迁移覆盖 `1.0.0` 至 `1.7.0 → 1.8.0`。
- Workspace/Project/Design File 持久化与导航、Project Design File 自动保存与稳定身份重命名、持久 Conversation、按 Conversation 隔离的时间线和单目标 Global Task 投影。
- 固定 `leafer-editor@2.2.9` 的唯一生产画布路径，覆盖场景投影、pan/zoom、命中、选择、move/resize/rotate/skew 和文本内编辑。旧 Canvas2D、手写选择框和 OpenPencil 运行时已移除。
- 多 fill/stroke、渐变、图片 Paint、阴影/光晕/模糊、blend、mask、高级描边和事务化图片 asset 的公共设计语义及属性检查器/Leafer 映射。
- 独立的 `@opendesign/geometry-service` contract v4：根入口提供多层对齐、固定两端均分、明确一维间距，以及按现有 gap 众数与 overlap graph 确定的一维/二维 Tidy up；隔离的 `vector-path` 子入口固定 `pathkit-wasm 1.0.0`，以短生命周期、纯数据 provider 通过真实 WASM 的 cubic PathOps、孔洞、空结果、simplify、transform、dash、outline stroke、fill rule、bounds、预算和确定性测试；`editable-vector` 子入口验证稳定 vertex/segment/path/region ID、拓扑连续性并确定性生成 cubic path 与 tight bounds；`vector-edit` 子入口负责单轮廓节点多选移动、手柄耦合、point mode 与删除。`DesignDocument 1.8.0` 与 EditorRuntime 保留独立非破坏 Boolean 节点及 planner，并提供正式有向 Line/Arrow、Polygon/Star、editable Vector Network 与节点编辑 planner；Leafer 用 Arrow/LineEditTool、Polygon、Star、Path、Pen overlay 和互斥的 point/handle overlay 投影，Boolean resolver 同时消费精确 path-data 与 network 派生 path。`@opendesign/import-export-service` 的 SVG v1 纯 service contract 可导入可编辑 Line/Path/Vector/基础 shape，并用受控本地 marker 往返 Line 端点、用逐点校验 metadata 往返零圆角 Polygon/Star、用 schema + topology + rendered `d` 三重校验的 editable-network metadata v2 往返 point mode；v1 metadata 继续兼容读取，普通第三方 SVG 仍保留为精确 path-data，不猜测 network。Boolean result 仍作为标准 path 导出并返回 fidelity report。EditorRuntime planner、Main 路径不外泄的 `.svg` 原生打开/保存桥、人工入口和 Agent run-scoped handle 继续复用同一可取消 worker；模型不接收 XML、路径或内部 ID 前缀。Smart Selection 画布手柄/回流、分支/多轮廓编辑、完整外观与像素/双平台产品证据仍未完成，因此相关 capability 保持 `degraded`。
- SVG v1 当前还可确定性往返圆角 Frame `clipsContent`、标准 `<text>/<tspan>` + 受控可编辑 Text metadata，以及按父容器 child order 分段的 alpha/luminance/outline/clipping sibling masks；受支持的第三方本地 user-space `<mask>/<clipPath>` 会展开为可编辑同级蒙版组。普通第三方 Text 的确定性字体布局、复杂组合 mask graph、Text/Image mask source、objectBoundingBox clip 与真实像素/双平台产品证据仍明确不在已完成范围。
- 运行于 `utilityProcess` 的持续 Agent Conversation、取消/恢复、多 Provider Catalog、OpenAI Responses、OpenAI Chat Completions、Anthropic Messages adapter 和 Main-only `safeStorage` 凭据。
- 版本化 `DesignCapabilityManifest v1`，按 contract/runtime/human/agent/render/export 六个表面记录 provider、限制与证据；Agent system context、`opendesign_get_capabilities`、生成式帮助文档和发布摘要读取同一事实源。能力状态不是设置项，不进入设置页。
- `opendesign_get_capabilities`、`opendesign_inspect_document`、`opendesign_define_design_plan`、`opendesign_capture_canvas`、`opendesign_record_visual_review`、`opendesign_edit_hierarchy`、`opendesign_arrange_layers`、`opendesign_request_page_structure_access`、`opendesign_manage_pages`、`opendesign_apply_transaction`、`opendesign_read_image`、`opendesign_generate_image`、`opendesign_place_image`、`opendesign_update_image`、`opendesign_import_svg` 与 `opendesign_export_svg` 十六个 typed tools。Run 默认绑定发送时当前 Page，Composer 不再常驻显示 Design File 写入范围；绑定 Page rename 可直接调用 `manage_pages`，创建/复制/排序/删除或跨 Page 修改则先申请一次性 Page 结构授权，批准后强制重新 inspect，并仅在本 Run、当前 Design File 内解析 effective execution context。`manage_pages` 与人工 Pages 导航共用 Page planner，宿主生成复制 Page/节点 ID；Page 生命周期不触发视觉设计 plan/review 门禁。`edit_hierarchy` 对现有节点执行宿主计算的无损编组/解组、非破坏 Boolean 创建/切换/解组、保持多选内部顺序的前移/后移/置顶/置底，以及在 Page root、Frame 和 Group 之间保持世界坐标的跨容器重挂载；Boolean actions 只接受显式 operand/Boolean ID，不接收或持久化 provider 派生 path。`arrange_layers` 对显式稳定节点执行多层对齐、固定两端均分、明确一维间距，以及锚定左上角的一维/二维 Tidy up，不让模型手算 transform；`update_image` 对明确 Page/node ID 执行非破坏 placement 或替换已授权来源；`import_svg` 只消费当前 Run 已授权的内容寻址 SVG 句柄，并导入 inspect 所得 Page/Frame/Group 的明确局部坐标；`export_svg` 只接受 inspect 所得的 Page/root IDs 与已实现设置，由 Main 打开原生保存框。两种 SVG 工具都不向模型暴露 XML 或路径。人工图层树使用同一 hierarchy planner 提供 before/inside/after 拖放，Inspector 与 Agent 使用同一 Boolean/arrange/image/SVG service；这些操作均保持单一文档事实状态，并在设计写入时以单次 revision 和单次撤销提交。专业层级、Boolean、排列、图片与 SVG 操作不从用户选区隐式推导 Agent 目标。Agent 可把 Run 绑定 Page/计划 Frame 的确定性渲染和全局 GPT Image 2 生成结果作为有界、内容寻址的多模态图片回读，图片/文档/SVG 附件支持选择、剪贴板和拖放；SVG 作为可编辑资源句柄而非 Provider 图片/文档输入，图片还支持受限读取用户明示本地路径、`file:` URL 或 HTTP(S) URL。新建设计必须经过“读取 → typed plan → 实质初稿 → 截图 → typed review → 修正 → 再截图”的 Runtime/Main 双门禁。
- 对既有画板继续设计时，Main 只信任当前 Renderer `inspect_document` 的 document/revision/Page/node 层级投影：`artboard.mode=existing` 会验证目标 Frame 并解析完整后代集合，随后允许写入既有或新建的嵌套 Group/Frame；Project 落盘副本、用户活动 viewport、发送时选区和本 Run 新增节点缓存均不能取代这一权威祖先判定。stale/invalid inspection 与错误 existing Frame 返回稳定可恢复码，不把一次计划失败升级为 Run 终态。
- Renderer/Preload/Main/Agent 的运行时校验、最小环境变量 allowlist，以及按 run 分别冻结 Design File/revision、选区上下文与单一 Mutation Target 的设计工具桥。
- Main-owned 结构化诊断 JSONL、按 Conversation/Run/Request/Tool Call 关联的右下角通知与单条诊断复制；Agent 对话在用户位于底部附近时跟随新消息和流式状态，用户上翻后暂停跟随。
- Agent 大型设计事务的文档有效渐进提交、typed plan 骨架、语义 Agent cursor 与 Leafer 新增节点 reveal：`DesignPlanToolInput version: 3` 在 Main 匹配接受后展示当前 Page 首个未完成 target 的画板/主要区域，version 2 历史计划继续按单 target 兼容；正式区域内容按稳定 ID 逐区替换骨架。cursor 的阶段只来自固定 tool 生命周期，位置先锚定计划区域、再跟随已提交 revision 的新增节点 focus point，不消费 Provider 自由文本。小事务保持原子，大事务只提交通过 `EditorRuntime.preview()` 的连续有效前缀并共享一个撤销组；已提交的新节点按父级优先经历短暂线框与淡入。所有展示状态均可丢弃，不进入文档、history、selection、保存或导出；Reduced Motion、手动停止、Run 终态、切页、错误和截图遵守明确收口语义。Material write/capture/review 另以 observed document revision 建模，pan/zoom/选区/窗口变化不会制造冲突；可自动恢复的门禁错误返回稳定下一步并默认不堆叠红色时间线卡。

macOS arm64 与 Windows x64 已在同一 GitHub 原生 workflow 上分别通过 verify、protected Vite build、包内容检查、packaged executable/Agent smoke 和 artifact 上传；Windows 已产出 NSIS 与 `OpenDesign-Windows-X64` artifact。两平台签名、安装后的人工 GUI 产品 smoke 仍未完成，不能据此宣称达到发布门禁。尚未完成的其他主要目标包括：完整 Working Set/Mutation Targets/Capabilities、attached roots、通用 per-run resource handles、Main approval/audit/sandbox 执行链、跨 Project 多目标、完整 MCP 产品链、`fetch_reference`/隔离 `capture_reference`，以及能力基线中列出的专业矢量、布局、组件、变量、富文本和导入导出。

本文后续同时描述当前边界和已接受的目标架构；目标内容不能当作已完成事实。实施状态见[专业设计能力基线](design-capability-baseline.md)与[路线图](roadmap.md)，项目/会话/跨目录边界见 [ADR-0006](adr/0006-project-conversation-agent-scope.md)。

## 2. 产品原则

### 2.1 人和 Agent 共用同一设计系统

人类操作和 Agent 操作最终进入同一套设计命令、约束、历史记录和撤销机制。Agent 不是自动点击 UI 的宏，也不拥有一条绕过校验的隐蔽写路径。

### 2.2 画布优先，AI 原生

画布始终是设计事实的可视化中心。AI 入口应贴近当前文档、选区、页面和任务上下文，支持“提议—预览—应用—撤销”的短反馈循环，而不是把设计工作降格为一次性聊天生成。

### 2.3 UI 优先，内核通用

首个成熟能力覆盖 UI 布局、组件、样式、设计 token、响应式状态和交付检查。公共对象模型同时保留通用图形能力，例如路径、文本、图片、蒙版、效果、约束、资源和导出配置。

### 2.4 本地优先且权限可见

文档编辑、历史和基础渲染默认在本地完成。外部模型、MCP 服务和 skills 只能在用户可理解的作用域内访问数据和执行能力，敏感动作需要显式同意并留下审计记录。

### 2.5 专业桌面体验

OpenDesign 追求高质量、低 Web 感的 Codex 式桌面 UI。应用应表现为稳定、紧凑且可长期工作的工具，而不是套在窗口中的网站：使用持久工作区、分栏、检查器、原生感菜单、快捷键、上下文命令和细致状态反馈；避免巨型圆角卡片、营销式 Hero、过量胶囊按钮和无功能的渐变装饰。

### 2.6 组织、上下文与权限分离

Project 用于组织设计文件、会话和持久配置，不是文件系统 sandbox。Conversation 的 `homeProjectId` 只定义默认归档与上下文锚点；实际读取、写入和执行由每个 run 的 Working Set、Mutation Targets、Capabilities、Approval 与 Sandbox 决定。

### 2.7 跨平台是发布能力

OpenDesign 是跨平台桌面产品，不是 macOS 专用工具。macOS 与 Windows 同属一级支持平台：两者必须提供原生安装包，并通过启动、窗口/菜单、画布输入、文件选择、Project 保存重开、Agent utilityProcess、凭据存储、附件、模型调用、升级与卸载等平台 smoke。不能因为共享 Electron/TypeScript 代码或 macOS 测试通过，就推断 Windows 可用。

平台特有实现必须位于明确 adapter 或条件分支，并在另一一级平台具有等价行为或显式替代。Linux 仍是目标平台，构建配置和代码边界不得主动封死 Linux，但当前阶段 Linux 缺陷不阻塞 macOS/Windows 里程碑。

## 3. 核心工作流

1. 用户在 Workspace 中创建或打开 Project 与 Design File，并在 Page 的 Frame/Artboard 和 Layers 上直接编辑。
2. 用户通过选区命令、命令面板或 Agent 面板描述目标；Conversation 保留 `homeProjectId`，但可以为本次 run 显式引用其他 Project 或目录。
3. 主机为 run 固定 Working Set、Mutation Targets 与 Capabilities。三者分别表达可读上下文、计划写目标和策略允许的动作，互不隐式授予。
4. Agent 读取经授权的最小上下文并返回结构化计划与设计事务；Tool Runtime 执行 Trust、Capability、Approval 与 Sandbox 检查。
5. OpenDesign EditorRuntime 按每个 Design File 的 `baseRevision` 预演或应用事务，并向 UI 返回变更集、冲突、诊断和渲染状态。
6. Project Design File 的新 revision 自动进入按文件串行的原子保存；Agent 写工具在对应 revision 持久化后才向模型返回成功。保存失败保留 dirty 状态并通知用户。
7. 用户检查单目标或多目标结果，继续编辑、处理冲突、接受替代方案或通过各 Design File 的统一历史撤销。

典型 UI 工作包括从需求生成首版、重排已有界面、建立 token、提取组件、检查一致性和生成交付说明。通用设计工作包括构图、文字层级、矢量编辑、资源替换、多尺寸变体和导出。

## 4. 产品范围

### 4.1 首要范围

- 无限或大范围 Web 画布、页面与多画板编辑。
- 选择、变换、对齐、布局、文本、矢量、图片、样式、组件和资源管理。
- UI 设计系统能力，包括 token、变体、响应式约束和可访问性检查。
- 上下文感知 Agent、可组合 skills、工具调用、方案预览和可撤销应用。
- 双向 MCP：连接外部数据与工具，以及向外部 Agent 暴露受控设计能力。
- 本地文档、导入导出和可恢复的编辑历史。

完整的专业设计能力范围、当前实现状态与后续协议门禁见 [专业设计能力基线](design-capability-baseline.md)。该基线用于避免按反馈逐项追加字段；分阶段交付不改变完整产品边界。

### 4.2 暂非目标

- 在第一阶段替代完整的视频、3D、CAD 或专业排版软件。
- 让模型直接拥有不受限制的 shell、网络、文件系统或引擎内存访问。
- 以特定模型供应商、特定 MCP 实现或 OpenPencil 私有对象作为公共产品协议。
- 用聊天记录充当设计文档的唯一事实来源。

### 4.3 资源层级

目标产品层级固定为：

```text
Workspace
└── Project
    └── Design File
        └── Page
            └── Frame / Artboard
                └── Layers
```

Workspace 聚合项目、会话入口、策略和连接配置，但不授权整个磁盘。Project 是组织、检索和默认上下文单元，不是 sandbox；它可以没有目录，也可以关联多个经批准的 attached roots。Design File 是持久化、revision 和冲突检测的基本文档单元，并包含一个或多个 Page。Frame/Artboard 是 Page 内的通用容器，Layers 是其下的节点树；这些名称不把内核限制为 UI 设计。

每层使用不依赖绝对路径的稳定 ID。Main 把用户选定路径映射为资源 ID 或不透明句柄；移动或重命名文件不应改变 Design File 身份。一个 Design File 只有一个权威 `EditorRuntime` 状态和单调 revision。

## 5. 系统上下文

```text
用户
  │
  ▼
Electron Renderer ── Web 画布、工作台、Project / Conversation / Agent UI
  │  仅类型化 preload API
  ▼
Electron Main ───── 路径/句柄、凭据、策略/审批、工具执行代理、进程监督
  ├──────────────► TypeScript Agent utilityProcess
  │                      ├──► 模型提供商
  │                      ├──► Skills（不受信任的说明与资源）
  │                      └──► 外部 MCP Servers
  └──────────────► Tool Runtime ─► 受限 worker / sandbox（按能力）

Electron Renderer
  ├──────────────► OpenDesign EditorRuntime（每个 Design File 的权威状态）
  │                  └──► Pages / 节点 / 事务 / revision / history / editor state
  └──────────────► Leafer Engine Adapter
                     └──► 当前 revision 场景投影 / viewport / hit test / direct manipulation

获准的外部 MCP Clients ─► OpenDesign MCP Server ─► 同一 Tool Runtime / 事务入口
```

Renderer 不直接接触 Node.js、Electron、模型密钥或引擎私有 API。Main 拥有路径解析、root/handle 登记、凭据、Capability 解析、Approval 绑定和工具执行代理；实际重负载可以在受限 worker 中执行，业务推理和长时 Agent 工作不进入主进程事件循环。Agent、skills 和 MCP 只接收受限结果或不透明句柄，不获得原始凭据或任意路径能力。

## 6. 逻辑组件

| 组件                | 职责                                                      | 明确不负责                           |
| ------------------- | --------------------------------------------------------- | ------------------------------------ |
| Desktop Shell       | 窗口、菜单、生命周期、路径/句柄、凭据、权限与安全 IPC     | 模型推理、具体设计语义               |
| Renderer Workbench  | 面板、命令、画布交互、可视化状态                          | 任意本地文件和密钥访问               |
| Resource Registry   | Workspace/Project/Design File 身份、attached roots        | 把 Project 当作授权 sandbox          |
| Design Contracts    | 通用节点、命令、事务、快照、诊断和版本                    | 具体渲染后端私有结构                 |
| Design Capabilities | 版本化能力状态、产品表面、provider、限制和验证证据        | 根据提示词或占位字段推断支持         |
| Editor Runtime      | 权威文档、事务、revision、history 与 editor session state | 产品 UI、模型供应商逻辑、画布渲染    |
| Geometry Service    | 确定性排列及后续几何 provider 的版本化纯输入输出          | 保存文档、修改 Leafer 场景、隐式选择 |
| Leafer Adapter      | 场景投影、绘制、viewport、命中、选择和直接操作            | 持久化事实、history、Agent           |
| Agent Runtime       | Conversation/run、上下文组装、计划、工具循环和恢复        | Electron 主进程特权、裸 fs/Bash      |
| Tool Runtime        | 工具注册、schema、Capability、Approval、审计与派发        | 自动扩大 skill 或 MCP 权限           |
| MCP Gateway         | 客户端和服务端传输、能力映射、身份与会话                  | 绕过 Tool Runtime 或事务入口         |
| Persistence         | 原子保存、恢复、版本迁移、会话日志和本地索引              | 把聊天文本当作设计状态               |

这些名称描述目标边界，不保证相应目录当前已完整实现。仓库中的包结构可以逐步承载这些职责，但应保持依赖方向从产品层指向契约层，而不是反向引用桌面实现。

## 7. Electron 进程模型

### 7.1 Renderer

Renderer 开启上下文隔离并关闭 Node.js 集成。它通过 preload 暴露的窄接口请求文件、引擎和 Agent 操作；接口使用明确的请求与响应类型，禁止暴露原始 `ipcRenderer`、任意通道名或通用 `execute` 方法。

### 7.2 Main 与 Preload

Main 负责可信调度和系统能力，所有入口校验来源、参数、资源身份、权限与取消信号。Main 拥有路径选择与规范化、符号链接和路径穿越检查、root/handle 映射、操作系统凭据、安全策略、审批绑定和工具执行代理；每次执行都重新确认句柄有效且目标仍在授权边界内。Preload 只完成能力桥接，不持有产品业务状态，也不把路径、凭据、事件对象或 Electron 原生对象传入页面。

### 7.3 Agent utilityProcess

Agent Runtime 使用 TypeScript 并运行于 Electron `utilityProcess`。当前 `AgentRequest 3.6` 的 `run.start` 包含 `sessionId`（承载产品 `conversationId`）、`runId`、prompt、model selection、可选的图片/文档/SVG 附件元数据、单个 `documentId`、revision、发送时的选区上下文与独立的单一 `mutationTarget`。选区只帮助模型理解用户当时关注的节点，不授予也不缩小写入范围；每个新 Run 的 Mutation Target 始终冻结为发送时活动 Page，Composer 只显示低权重 Page/选区上下文，不再提供 Design File 写入范围下拉。任务开始后 Renderer 的选区、活动页面、tab 和 viewport 变化都不会改变原始 binding。需要创建、复制、排序、删除 Page 或跨 Page 修改时，模型调用 `opendesign_request_page_structure_access`；Main 只接受精确匹配 `runId + toolCallId + approvalId` 的“允许本次”，批准后删除旧 inspection，并仅为该 Run、该 Design File 解析 effective document execution context，终态自动回收。绑定 Page rename 不需要额外授权，拒绝不得重复申请绕过。新 `run.start` 必须携带 Mutation Target；历史 `message.user` journal 允许缺省该字段以继续读取 3.2 及更早会话，不会从旧选区反推或补授写权限。Renderer 不得提交 `modelContext`；Main 从所选 Model Profile 解析 `contextWindow/maxOutputTokens` 后再注入 utility process。Main 在转发 Run 前根据当前 Project/Design File 注册并校验 host-bound revision；Conversation journal 只记录历史上下文，不得用历史最大 revision 覆盖当前活动文档事实。文档从持久化版本重新打开或放弃未保存修改后，即使 journal 曾记录更高 revision，也必须接受 Main 已验证的当前基线，后续写冲突仍由 Main 绑定与唯一 `EditorRuntime` 的 `baseRevision` 校验处理。`homeProjectId` 仍由 Main-owned Conversation descriptor 和 Global Task 目标校验承载。当前按需 Page 授权不等同于完整 Working Set、多 Mutation Targets、通用能力快照/审批和跨 Project 多目标；这些扩展仍需要后续协议升级和存量会话迁移。详细裁决见 [ADR-0029](adr/0029-contextual-page-structure-approval.md)。

`DesignPlan v3` 已在这个单一 Design File 边界内提供 `1..N` 个交付 target：单个设计只产生一个 target，明确的一套页面、方案或物料按用户列出的交付项逐个产生。默认 Page Run 只能计划该 Page；获得一次性 Page 结构授权并重新检查后，effective document execution context 可以覆盖当前检查结果中的多个 Page。Global Task 持久 `DesignDeliveryLedger v1` 逐项记录 draft、capture、review、refinement 与 final verification，completion guard 在全部 target verified 前自动续跑，中断后的新 Run 可从首个未完成项恢复。该交付账本不授予第二个 Design File/Project Mutation Target，也不等同于跨文件多目标事务；后一能力仍属于后续协议工作。

主进程负责启动、健康检查、限流、取消和异常重启。utilityProcess 默认不继承渲染页面权限，也不直接访问引擎、文件系统、shell 或凭据；所有工具执行都通过主机侧 Tool Runtime 进行策略判断和代理。详细决策见 [ADR-0002](adr/0002-agent-utility-process.md) 与 [ADR-0006](adr/0006-project-conversation-agent-scope.md)。

## 8. 设计引擎边界

OpenDesign 自己拥有文档模型与 `EditorRuntime`；`DesignDocument`、`DesignTransaction`、revision、diff、history、undo/redo 和持久化不委托给第三方引擎。Renderer 中的 `@opendesign/leafer-engine` 把活动 Page 的当前 revision 投影成 Leafer 场景，并隔离所有 Leafer 类型和 API。Leafer 负责渲染、DPR、资源生命周期、viewport 机制、坐标转换、命中测试、hover、选择器、框选、多选、变换控制框和文本内编辑。固定依赖记录在 `engine-baseline.json` 中，规范决策见 [ADR-0009](adr/0009-leafer-rendering-and-interaction-engine.md)。

Leafer 场景不是第二份可保存状态。手势期间 Leafer 可以临时改变投影以保证逐帧反馈；手势结束时，适配器只返回稳定节点 ID 和候选 `DesignOperation[]`。Renderer 使用当前 `documentId` 与 `baseRevision` 提交一条事务：成功后从新 revision 同步，冲突、取消或失败则从权威快照恢复。Agent、MCP、Main 和 utility process 永远不获得 Leafer 对象或私有 JSON。

`DesignDocument 1.8.0` 已把纯色、线性/径向/角度渐变、图片 Paint、多色标、投影、内阴影、内外光晕、图层/背景模糊、灰度、混合模式、蒙版、高级描边、正式 Line/Arrow、Polygon/Star、互斥的精确 SVG path-data / editable Vector Network、持久 corner/smooth/mirrored/independent point mode、Image 节点的 `Stretch / Fit / Fill / Crop` 非破坏 placement，以及保留有序源图层的 Boolean Group 定义为 OpenDesign 公共语义。Pen 使用 network 创建单条开放或闭合 cubic contour；已有单轮廓可通过 Enter/双击进入 point edit，执行节点多选移动、手柄拖动、point mode、删除、Done/Escape，并在每个完成动作以单事务提交。Agent typed transaction、Leafer Path、PathKit Boolean 和受控 SVG metadata v2 复用同一语义。分支、多轮廓、connect/disconnect、open/closed 转换、reverse、flatten 和 outline stroke 尚未完成。Line 保存归一化有向 start/end、独立端点和开放中心描边；Polygon/Star 保存顶点数、Star 内径和圆角。Boolean Group 持有 operation 与统一外观，不保存 PathKit 派生 path；开放 Line 与尚无精确 outline 的圆角规则图形不会静默成为 Boolean operand。Crop 保存归一化焦点、缩放、旋转和翻转；原始 asset 不被改写。图片继续使用事务化 `DesignAsset`。外观规范见 [ADR-0010](adr/0010-open-design-appearance-image-and-reference-semantics.md)，路径与视觉复核规范见 [ADR-0012](adr/0012-formal-path-vector-and-visual-review.md)，图片 placement 规范见 [ADR-0019](adr/0019-versioned-image-placement-and-crop.md)，Boolean 规范见 [ADR-0022](adr/0022-versioned-nondestructive-boolean-groups.md)，SVG 规范见 [ADR-0023](adr/0023-versioned-svg-interchange-service.md)，Line/Arrow 规范见 [ADR-0024](adr/0024-versioned-line-arrow-semantics.md)，Polygon/Star 规范见 [ADR-0025](adr/0025-versioned-polygon-star-semantics.md)，editable Vector Network 与 Pen 规范见 [ADR-0026](adr/0026-versioned-editable-vector-network-and-pen.md)，已有矢量节点编辑规范见 [ADR-0027](adr/0027-versioned-vector-point-editing.md)。

OpenDesign 设计内核的目标能力族包括：

- 生命周期：创建、打开、关闭、保存、导入、导出和恢复文档。
- 查询：页面、节点、选区、资源、样式、能力和轻量快照。
- 事务：创建、更新、移动、删除、批量变更、预演、提交和撤销。
- 视图：Leafer 实现命中测试、缩放、视口、覆盖层和渲染失效；OpenDesign 只持久化产品需要的 session state，并通过适配器同步。
- 事件：文档变化、选区变化、历史变化、资源状态、诊断和崩溃恢复。

这些是跨 Contracts、EditorRuntime、Main host 和专业 service 的产品能力，不是 `@opendesign/leafer-engine` 单包接口清单。当前 `@opendesign/design-capabilities` 固定 `DesignCapabilityManifest v1`：每项能力同时记录 contract、runtime、human、agent、render 与 export 状态，只有必需表面全通且同时具备自动化和实机证据时才允许标记 `available`。组件、布局和完整静态导出等能力明确返回 `unavailable`；已有 SVG service、Runtime planner、人工导入导出与 Agent 导出入口，但仍缺少 Agent 导入、完整格式保真和产品级实机证据的交换链，以及其他部分链路返回 `degraded`，不能从 schema 占位或第三方引擎说明推断支持。

公共命令使用稳定 ID、预期文档版本和幂等/冲突语义。Design File 是 revision 与提交冲突的边界：不同文件可以并行；同一文件的权威 runtime 在短提交区间内串行处理，并对过期 `baseRevision` 返回结构化 `conflict`，不得静默覆盖。引擎缺少某项能力时返回 `unsupported`，不允许调用者猜测私有 API。详细决策见 [ADR-0003](adr/0003-design-engine-adapter.md) 与 [ADR-0006](adr/0006-project-conversation-agent-scope.md)。

Project Design File 打开后由 Renderer 以稳定 `projectId + designFileId + documentId` 绑定唯一 `EditorRuntime` 和自动保存协调器。普通人工变更短暂 debounce 后通过类型化 Preload 请求 Main；同一文件至多一个保存进行中，保存期间的新 revision 必须随后继续保存，响应的 File/Document/revision 必须与请求匹配，旧或错配结果不能把较新 revision 错误 checkpoint 为已持久化。Agent 事务得到新 revision 后会立即 flush 该目标文件，再把工具成功返回 Runtime；用户切换活动 tab 不会改变保存目标。Main 继续使用 Project mutation queue 与 crash-safe journal 原子提交文档和 manifest。自动保存失败保留 dirty 状态并生成包含 Project/File ID 的结构化诊断；关闭窗口或退出应用时先静默取消本次关闭并 flush 全部 pending Project 文件，失败则保持窗口与可恢复状态。Main 的 `before-quit` 只记录退出意图，ProjectHost、WorkspaceStore 与 Agent 等资源延后到 `will-quit` 才销毁；因此 Renderer 在 `Cmd+Q` 和 Windows 退出期间仍可保存，macOS 会在异步 flush 后恢复原退出意图。独立通过原生打开框加载的外部 `.opendesign` 不属于 Project autosave 范围，仍只在用户明确 Save/Save As 时覆盖。

Design File 名称是 Project manifest 中可变的展示属性，不是资源身份或物理路径。编辑器 tab 支持双击或 `F2` 内联重命名，`Enter`/失焦提交、`Escape` 取消；名称经过去除首尾空白、1–256 字符与控制字符校验，但不要求唯一。Renderer 只提交 `projectId + designFileId + name`，Preload/Main 重新校验，ProjectHost 使用 manifest-only crash-safe journal 更新 descriptor 与 Project 时间戳。操作不读取或顺带保存 `DesignDocument`，不改变 `designFileId`、`documentId`、relative path、revision、history 或 dirty 状态；与同 Project autosave 并发时进入同一 mutation queue。失败保持原名称和输入状态，并生成包含 Project/File ID 的诊断。

## 9. 项目、会话与内置设计 Agent

OpenDesign 的主产品路径是应用内部的垂直设计 Agent，而不是等待外部 Agent 通过 MCP 驱动。用户在工作台内选择模型提供商并描述目标；内置 Agent 理解经授权的设计文件、选区、设计系统、视觉结果和会话历史，通过 typed design tools 生成、检查和修改结构化设计。多模型 provider adapter 是产品基础能力，不能把模型选择或核心设计循环外包给外部 MCP 客户端。

新建设计的 plan 与视觉 review 是 Run-scoped、可丢弃的执行投影，不是第二份可写文档状态。Main 要求计划按用户需求声明 `1..N` 个交付 target，每个 target 明确一个 Frame/Artboard 和构图，同时共享视觉系统；单个设计只有一个 target，一套设计按明确交付项逐个建立。每个 target 的新图层进入自己的 Frame。Web/UI 与海报使用同一门禁：UI 额外强调 grid、density、typographic hierarchy、control state、form language 与 surface/depth，不能把重复圆角卡片或普通方块拼接描述为完成。每个 target 首次渲染截图后必须先记录结构化 review，才允许 refinement；持久交付账本在全部 target verified 前阻止完成。详细决策见 [ADR-0018](adr/0018-agent-design-plan-and-visual-review.md)。

Agent 的画布生成过程分为正式阶段和可丢弃展示两层。Main 接受的 `DesignPlanToolInput version: 3` 按用户请求声明 `1..N` 个交付 target；Renderer 在与 selection 分离的 Leafer `sky` 层展示当前 Page 首个未完成 target 的画板与主要区域稳定 ID/bounds，version 2 历史计划继续按单 target 兼容；未经确认的 Provider tool request 不产生画布结构。较大的 typed transaction 会按原命令顺序寻找 `EditorRuntime.preview()` 可接受的最短优选前缀，每个阶段都是合法 revision，并通过同一 history group 在完成后只形成一个 undo；取消会回滚整个组。Renderer 从已提交 Agent `ChangeSet` 派生父级优先的 Leafer 线框/淡入和 focus points，并在正式区域出现实际内容后逐区替换骨架。独立 Agent cursor 只用固定 typed tool mapping 表达结构、构建、素材、审查、修正和恢复阶段；Provider 自由文本 progress 不进入画布，已提交节点才改变 cursor 位置。partial JSON、计划 overlay、cursor、动画 opacity 和线框均不写入文档。`capture_canvas`、手动停止、Run 终态、切页和错误会清理展示；Reduced Motion 跳过 reveal/位移动画但保留静态结构状态。当前尚未实现属性级 tween 和自适应节奏，详见 [ADR-0028](adr/0028-agent-generation-presentation.md)。

Agent 参考 Pi/OpenCode 的工程思路：保持核心循环小而透明，以消息、工具、事件和持久会话为基础，通过 provider adapter、skills 和 MCP Client 扩展。生产 Model Gateway 已通过 OpenDesign canonical adapter 使用固定 `@earendil-works/pi-ai 0.84.1`；ADR-0020 接受固定 `@earendil-works/pi-agent-core 0.84.1` 的 headless `Agent`。阶段 1—3 已完成三种 API identity、`AgentEvent 3.6`、唯一 journal writer、十六个生产工具、plan/review completion guard、取消/失败分流、累计 checkpoint、逐轮 `transformContext` 预算压缩和内容寻址多模态/资源句柄投影。utilityProcess 的唯一生产入口现为 `OpenDesignPiRuntime`；旧自研通用循环及其测试已删除，没有双循环或 fallback，设计事务、权限、凭据、revision、journal 和恢复仍由 OpenDesign 边界拥有。完整生产提示词、十六工具、200K 配置和八轮多模态循环已通过，Pi transcript 不含 inline base64 或 SVG XML；当前待同一 commit 的 macOS/Windows protected package 与 packaged Agent smoke 后关闭迁移。固定版本的 `AgentHarness.prompt()` 仍抛出 `HarnessNotImplemented`，Pi Coding Agent、TUI、文件/shell 工具、凭据和资源发现不进入产品路径。详细裁决见 [ADR-0020](adr/0020-pi-headless-agent-loop-migration.md)。

### 当前模型 Provider 边界

桌面设置页实现版本化 `ModelProviderCatalog v3`。每个 Provider profile 只保存对话推理所需的稳定 ID、名称、启用状态、对话 API 格式、鉴权方式、Base URL 和模型能力列表；能力区分 tool use、图片输入与 reasoning，不包含图片生成。当前对话 API 格式为 OpenAI Responses、OpenAI Chat Completions 与 Anthropic Messages。Provider API Key 按 `providerId` 由 Electron `safeStorage` 加密后存入 Main-only `WorkspaceStore`，Renderer 只能读取 `hasApiKey`，不会收到明文或密文。v1/v2 Catalog 确定性升级到 v3，v2 中的图片生成字段在迁移后剥离。

Agent composer 在每个 Conversation 中选择 `Provider/Model` 和模型支持的 reasoning effort。`AgentRequest 3.6` 把选择、发送时选区、单一 Mutation Target 和可选的内容寻址附件显式放入 `run.start`，run journal 保存对应快照与附件元数据；Main 只解析并执行该会话选择，并从可信 Model Profile 补入上下文预算。发送时选区只作为模型上下文，`opendesign_edit_hierarchy`、`opendesign_arrange_layers`、`opendesign_update_image` 与 `opendesign_import_svg` 等写工具必须携带检查结果中的稳定资源 ID，不能把该选区或用户执行期间变化的实时选区当作写目标。图片生成由独立的应用级 `GlobalImageGenerationSettings v1` 配置，拥有启用状态、API adapter、Base URL、鉴权方式、独立 API Key 和用户模型 ID。它位于设置页单独的“图片生成”入口，不写入 Project、Conversation、`run.start` 或生图 tool 的 Provider/Model 参数；切换、保存或删除 Conversation Provider 都不能覆盖或补全生图配置。当前 adapter 为 `openai-images`，使用 `/images/generations`，首个验证模型是 `gpt-image-2`，但模型 ID 由用户填写且没有运行时名称分支。后续不同协议通过版本化窄 adapter 增加，不改变 Agent tool 参数或重新并入 Provider Catalog。

一条消息最多包含 6 个附件，单个不超过 16 MB、合计不超过 32 MB。Main 按真实内容与受控扩展识别图片、SVG 和受支持文档，不要求用户预先选择类型；raster 图片使用 `image_<sha256>`，文档使用绑定 MIME 的 `file_<sha256>`，SVG 使用绑定 `image/svg+xml` 的 `svg_<sha256>`。PDF/DOCX/UTF-8 文本文档在 Main 中提取为最多 200,000 字符的只读参考上下文，DOCX 先经过条目数、展开大小、压缩比、加密和路径检查；SVG 不提取为文本，也不作为 Provider image/document block，只把 handle/name/byteSize 投影给模型并等待 typed import tool。只有包含 raster 图片的请求才要求模型声明 `imageInput`；纯文档或 SVG 句柄请求可以发送给文本模型。文件选择器、内容/扩展名/大小校验、SHA-256 存储和完整性复验都在 Main 中完成，模型 bridge 不接受 utility process 提交 inline base64、SVG XML 或任意路径。`ParentModelGateway` 通过内部、受校验的 model bridge 把可序列化请求交给 Main；Main 在发起网络请求时才解密对应 Conversation Provider 凭据、解析获准附件 ID，把 raster 图片转成原生多模态 block、把文档转成带不可信边界标记的 text block，再通过固定 adapter 适配三种协议。SVG 只在 `opendesign_import_svg` 执行时由 Main 复核当前 Run 授权并物化到 Renderer worker。生图请求则由独立 `ImageGenerationHost` 解密独立凭据并执行。模型桥接受完整生产设计工具契约，并同时限制单工具 schema 与工具集合总大小；任何跨进程请求/响应校验失败都会回传可关联的失败终态，不能只写日志后丢弃。取消通过关联 `requestId` 的 `AbortController` 传递。生产模型流由 Main 同时执行 180 秒首响应、120 秒流空闲和 15 分钟总时限 watchdog；图片生成有独立 10 分钟上限，二者都会向实际 fetch 传播取消。应用启动时还会把 JSONL 中孤立的 started Run 和 pending tool 终结为可恢复错误，避免重启后保留假运行状态。该链路不授予 Agent 原始凭据、任意网络入口或文件系统能力。十六个 typed tools 只操作 Main 绑定到 run 的 Design File、可信 Page/计划 Frame capture target、默认 Page Mutation Target、获准后的同文件 effective document target、Run-scoped plan/review、当前 run 明示引用、只读 capability manifest、独立全局生图配置或 Main 原生 SVG import/export 入口，并通过受校验的事务/附件/审批/交付桥执行。用户当前活动 tab 和 viewport 不参与工具目标解析。SVG 导入/导出都要求先 inspect，只接受稳定资源 ID；导入执行一次原子事务并自动选中新根，导出由 Main 打开保存框，模型不接收 SVG 源码、内部 ID 前缀或路径。Page 结构审批已实现精确 Run/tool/approval 绑定、拒绝、发送回滚和终态回收；每次 run 的完整外发数据预览、通用跨资源 Main approval bridge 和完整工具审计策略链仍未实现。详细决策见 [ADR-0007](adr/0007-main-hosted-model-provider.md)、[ADR-0008](adr/0008-multi-provider-model-catalog.md)、[ADR-0013](adr/0013-global-gpt-image-generation.md)、[ADR-0014](adr/0014-standalone-global-image-generation-settings.md)、[ADR-0015](adr/0015-versioned-design-capability-manifest.md)、[ADR-0018](adr/0018-agent-design-plan-and-visual-review.md)、[ADR-0023](adr/0023-versioned-svg-interchange-service.md) 与 [ADR-0029](adr/0029-contextual-page-structure-approval.md)。

Conversation 的原始 append-only journal 与模型上下文投影分离。Agent Runtime 在完整 run 边界把旧事件写成累计 `context.compacted` checkpoint，并在同一 Run 的每个 Provider turn 前重新预算；较早的 assistant/tool 段在超限时进入临时有界 checkpoint，当前用户原文和最近完整 tool call/result 段继续保留。checkpoint 只含有界消息摘录、附件元数据、工具统计和最新 design revision，原始 Timeline 与工具审计不删除。模型投影会同时限制超长单字段和大量短字段组成的超大结构化工具结果，原始 journal 仍保存完整审计。Main 注入所选 Model Profile 的 `contextWindow/maxOutputTokens`，Agent 对文字、图片、文档、工具 schema 和输出预留做保守 token 估算；有可信模型窗口时 token 预算是唯一硬门禁，本地字符限制只用于缺少模型窗口元数据的保底路径。固定协议装不下返回 `model_context_incompatible`，最小必要上下文仍过大才返回 `context_budget_exceeded`；两类错误按 system、tool schemas、Conversation/tool results 和请求 framing 提供估算分账。模型可见设计工具使用紧凑跨 Provider Schema，所有工具输入仍由完整运行时 Schema 重新验证。服务端模型元数据探测、精确 tokenizer/image 预算、可替换语义 compactor 与上游超限单次恢复仍未完成，详见 [ADR-0016](adr/0016-durable-agent-context-compaction.md) 与 [ADR-0017](adr/0017-model-token-budget-authority.md)。

专业设计回归使用 `fixtures/professional/manifest.json` 作为样张证据索引。每个样张分别保存固定 prompt、干净初稿、一个可校验 refinement 事务和预期最终 `.opendesign` 文档；生成器记录 SHA-256，并由 `fixtures:check` 阻止漂移。当前自动化只证明文档结构、Path/外观/图片语义、EditorRuntime 历史与 Leafer 场景投影，不把这些结构证据冒充像素视觉、真实 Agent 工具轨迹、专业导出或 macOS/Windows 实机验收。

用户请求停止后，Renderer 立即把对应 Run 显示为“正在停止”并去除流式活动光标，但在 `run.completed` 或失败终态到达前仍保持并发占用。终态会兜底结束该 Run 遗留的 partial message、tool 与 approval 活动态，避免对话中残留看似仍在运行的蓝色光标。

失败按“是否还能可靠地继续模型循环”分类，而不是按任意一层是否抛错分类：

- 可恢复工具/业务失败：参数校验、节点不存在、目标越界、revision conflict、审批拒绝、Renderer 工具超时或设计工具桥拒绝。它们写入 `tool.failed`，作为结构化 tool result 回给仍可用的模型；`EditorRuntime` invariant 失败还保留有界 `commandId / nodeId / path / message`、稳定 fingerprint 和 `inspect-and-revise` 恢复动作。失败事务不改变 revision，Runtime 会阻止随后的设计写，直到 `opendesign_inspect_document` 成功；相同输入与 fingerprint 的盲重试被有界抑制。模型可以重新检查、修正参数、换方案或向用户解释，Run 不由中间层直接终结。
- 需要用户动作但模型仍可回复：活动 Design File 已切换、目标不可用或用户拒绝授权。工具失败仍回给模型，由模型说明需要的用户动作并自然完成本轮。
- 不可继续的 Run/基础设施失败：模型请求或响应桥损坏、Provider watchdog 超时、Agent 进程/协议事件异常、Run 注册/可信绑定丢失。此时已经无法安全地继续同一循环，Main 取消对应 Run，发送可关联的 `agent.error`/终态，Renderer 解除输入和画布的运行状态并向用户显示错误。

任何一类失败都不得只写终端日志。能继续的必须进入模型上下文，不能继续的必须进入用户可见终态；同一 `requestId`/`runId` 用于关联、审计和释放资源。

Main 在应用 `userData/diagnostics/events.jsonl` 中维护有大小上限和单代轮转的结构化诊断日志。事件只包含时间、级别、来源、稳定错误码、错误消息、应用/平台版本，以及可用的 Conversation、Run、Request、Tool Call、Project 和 Design File ID；设计事务 invariant 事件可附带单条工具失败的有界 command/node/path issue 与恢复动作，但不记录 Prompt、附件正文、设计正文、Provider 凭据或完整工具参数。不可继续的错误和明确系统通知通过同一事件投影为不透明桌面通知，编辑器视图中停靠在画布右下并避开 Agent composer，其他视图停靠窗口右下；错误在用户关闭前保持，用户可一键复制当前事件的完整关联信息交给 Agent 排查。普通可自动恢复的 workflow 门禁仍静默；带 invariant details 的失败显示低打扰 warning，便于用户看到具体目标并复制诊断。

Agent composer 还支持粘贴和拖入图片/文件。模型可按需调用 `opendesign_read_image` 读取当前 run 已附加的图片，或用户在当前 prompt 中精确明示的绝对路径、`file:` URL 和 HTTP(S) 图片 URL；Main 只做 source 授权、受限读取、内容寻址和完整性校验，识别由模型完成。tool result 内保存 attachment metadata，下一轮由 Model Gateway 解析成真实多模态图片块。`opendesign_place_image` 可把同一 attachment 以受信任的 asset + image node 原子事务嵌入画布。`inspect_document` 只返回引用 asset 的名称、类型、尺寸、source 类型和扩展键，不把 data URI、外部 URI 或像素内容复制进工具结果；Agent Runtime 对当前轮和旧 journal 中意外出现的超长工具字段还会在模型投影时省略，避免一张图片把下一轮上下文顶爆。远程读取不携带 Cookie 或 Provider 凭据，并限制协议、重定向、超时与大小。通用网页文本读取和隔离截图仍是后续 `fetch_reference` / `capture_reference` 能力，不把仅获取 HTML 描述为已经看见页面视觉。

当设计需要原创位图时，模型可调用 `opendesign_generate_image`。工具输入只有 prompt、计划中声明的 role、size、quality 和 output format，不能指定 Provider/Model；Main 只读取独立 `GlobalImageGenerationSettings v1` 的 adapter、Base URL、鉴权、凭据和用户模型 ID。当前 `openai-images` adapter 已用 GPT Image 2 验证；同协议的新模型不需要增加模型名分支。Main 校验 plan/role、HTTP/JSON/base64/大小/取消，把结果写入现有内容寻址 attachment store 并只授权给当前 Run。结果返回 attachment metadata 和多模态引用，但不会自动修改文档；模型必须继续调用带相同 role 的 `opendesign_place_image`，才能通过 `put_asset + insert_element(image)` 的同一事务、revision 和 undo 历史进入计划 Frame。`editable-composition` 不允许 `final-single-image`；单图模式必须引用用户当前消息中明确要求扁平图片的原文。未配置全局生图服务时工具明确失败，不回退到 Conversation Provider。

参考图分析、确定性图片处理和 AI 图片编辑是三个不同边界。`read_image` 只让多模态模型理解参考图；当前 Image service 已提供 Image 节点的非破坏 placement/crop 几何，检查器与 `opendesign_update_image` 通过同一 planner 更新 placement 或替换来源，替换不会覆盖原 asset，并只在无其他引用时随同一事务清理旧 asset。后续 mask、adjustment/filter 继续由该服务产生确定性可撤销结果；局部重绘、扩图、背景替换、重打光和风格统一则由未来独立 `edit_image` adapter/tool 创建新的派生 asset。当前 `openai-images` 只实现新图生成，尚未实现编辑；原始 asset 与任何 AI 派生 asset 必须分离并记录来源，禁止覆盖原图。

`opendesign_capture_canvas` 只渲染当前 Run 绑定 Design File 的可信设计目标：计划 Frame 已建立时导出该 Frame，否则导出绑定 Page。Main 从 Run/plan 状态产生 `captureTarget`，Renderer 用 captured revision 创建与活动编辑画布分离的 Leafer 投影，再把有界 JPEG 通过 Main 附件导入边界变成内容寻址图片。用户同时切换 Design File、pan、zoom、resize 或改变选区不会改变像素、document revision 或 mutation target；生成 skeleton/cursor/reveal 也不会进入截图。它不会截取桌面、其他窗口或应用。Agent 在实质设计写入后可把该图片作为多模态结果回读，再根据实际渲染结果迭代。该能力不等同于网页抓取或外部页面截图，后两者仍属于后续 `fetch_reference` / `capture_reference`。

`EditorRuntime` 提供版本化、引擎无关的设计预检，`inspect_document` 对当前 Mutation Target 返回 Path、渐变、光晕、模糊、blend、mask、图片和文字的实际特性计数，并识别空内容、不可见/无绘制外观、缺失资源、非有限世界 bounds、完全越出 clipping Frame 与根图层碎片。该预检不替代 Leafer 绘制或像素视觉基线；它用于在调用 `capture_canvas` 前排除结构上必然失败的结果。

### 9.1 Conversation 与 `homeProjectId`

Conversation 是持久会话。目标模型为每个 Conversation 保存 `conversationId` 和创建时确定的 `homeProjectId`；后者只提供默认浏览位置、相对引用起点、策略提示和 UI 归档位置，不构成 sandbox 或文件权限。Conversation 后续可以引用其他 Project，且不改变 `homeProjectId`，也不把外部目录自动附加到 home Project。

Conversation 列表按 `updatedAt` 降序排列。Main 在接受新 Run 以及收到 assistant/tool/终态活动时推进持久时间，Renderer 在同一事件链中立即重排本地投影；因此发送消息后当前会话马上置顶，重启后顺序与持久状态一致。

每个 run 保存其实际作用域和权限快照。Project 被移动或归档后，会话审计记录仍应有效；旧会话迁移到默认 Project 时，不得把历史路径自动转成 attached root 或持久授权。

### 9.2 Working Set、Mutation Targets 与 Capabilities

目标运行模型明确分离三类集合：

| 集合             | 回答的问题           | 典型内容                                             | 不代表什么           |
| ---------------- | -------------------- | ---------------------------------------------------- | -------------------- |
| Working Set      | 本次推理可以看到什么 | 固定 revision 的文件、Page、节点、外部文件和检索结果 | 不授予写权限         |
| Mutation Targets | 本次计划要改变什么   | Design File/节点范围、输出文件、预期 revision        | 不代表调用已经获准   |
| Capabilities     | 主体最多能请求什么   | 主体、资源选择器、操作、有效期、配额和来源           | 不替代审批或执行隔离 |

一个写调用必须同时满足：资源已列入 Mutation Targets、主体持有匹配 Capability、所需 Approval 已完成，并且执行符合 Sandbox 约束。三类集合不得从 `homeProjectId`、当前选区或彼此隐式扩大。上下文可读不等于可写，多目标计划也不等于跨文件原子事务。

### 9.3 Attached roots 与 per-run references

Project 可以保存零个或多个经用户或受管策略批准的 attached roots。Main 为每个 root 登记稳定 ID、规范化边界、允许操作、来源、有效期和撤销状态；Agent 只获得资源 ID 或不透明句柄，不获得可任意拼接的绝对路径。Attached root 建立持久关联，但每次工具调用仍需匹配 Capability。

用户可以通过文件选择器、拖放、打开文件或明确命令创建 per-run reference，把未附加目录中的文件或其他 Project 的资源只加入当前 run。Run 结束、取消或权限撤销后，临时句柄失效；该引用不改变 Project 归属，也不会自动成为 attached root。

### 9.4 跨项目多目标与并发

一次 run 可以跨 Project 指定多个 Mutation Targets。每个目标单独携带 Project、Design File、`baseRevision`、能力和审批，并通过各自的 `DesignTransaction` 提交。当前目标架构不承诺跨 Design File 原子提交；发生部分成功时，UI 必须逐目标显示结果、冲突和可用的撤销或补偿动作。

多个 Conversation 可以并发运行。只读操作固定到 revision 后可并行，不同 Design File 可以独立提交；同一 Design File 的权威 runtime 按 `baseRevision` 做乐观并发控制。过期事务返回 `conflict`，Agent 重新读取、重新预演，并在作用域和审批仍有效时重试；运行时不得静默覆盖、自动重放语义不明的命令、建立会话私有事实副本或以长时间项目级锁掩盖冲突。

### 9.5 工具优先级与回合

一个典型回合包含：解析用户目标、固定三类作用域、构建最小上下文、选择工具、完成策略与审批、执行、读取结构和渲染结果、视觉复核、形成后续动作并输出可审计事件。上下文按需拉取，优先传递结构化摘要和相关节点，避免默认上传整个设计文件或无界截图。

内置 Agent 优先使用 typed design tools。默认工具集不暴露裸 `fs`、通用 Bash/shell 或任意命令执行；确需文件、进程或网络能力时，只能调用 Main 托管的窄工具。设计写操作生成 `DesignTransaction`，包含 Design File、基准 revision、作用域、命令列表和可读摘要；高影响事务先预演并返回差异，应用后进入同一 Design File 的统一撤销历史。模型输出永远不等于执行授权。

## 10. 双向 MCP

MCP 是内置设计 Agent 的互操作和生态边界，优先级低于应用内完整设计闭环。MCP Server 不替代内置模型接入，外部客户端也不能获得比内置 Agent 更宽的设计权限或绕过同一事务历史。

### 10.1 OpenDesign 作为 MCP 客户端

Agent 可以连接用户配置的 MCP Server，以读取设计素材、代码上下文、品牌数据或业务系统。每个连接独立声明 transport、身份、可用工具、资源和提示词，Tool Runtime 在调用前执行 schema 校验、Capability 检查、Approval、Sandbox、超时和输出大小限制。外部 Server 返回的路径或资源标识不自动成为 attached root、per-run reference 或 Mutation Target。

### 10.2 OpenDesign 作为 MCP 服务端

外部获准客户端可以通过稳定 Workspace、Project、Design File、Page、节点或 root handle 查询摘要、读取选区、请求导出或提交受限设计事务。设计写操作进入与内置 Agent 相同的 Tool Runtime、`DesignTransaction` 校验、权威 `EditorRuntime`、revision 冲突和审计链。服务端不得默认暴露模型密钥、任意文件读取、原始引擎句柄、未保存的全量文档或无提示写权限。

### 10.3 共同策略

两个方向共享 Capability 标识、风险等级、Approval 记录、来源标签、审计事件、撤销信息和断开机制。连接身份与资源身份分离；切换 Project、Workspace 或用户，以及句柄、目标或 revision 改变后，必须重新计算授权范围。MCP 工具不得接受模型可控的任意本地 `filePath` 并直接加载、创建或保存文件；兼容适配器只能在 Main 的可信边界内把用户明确选择的文件转换为受限句柄。

## 11. Trust、Capability、Approval 与 Sandbox

Agent、skills、MCP 和所有外部资源调用依次经过四层控制：

1. **Trust** 对代码、调用主体和数据来源分类。内置控制代码可以比第三方扩展更可信，但模型输出、文档文本、网页和 MCP 返回值始终是不可信输入。Trust 影响默认策略，不直接授予动作。
2. **Capability** 是 Main 可验证的最小权限，绑定主体、资源选择器、操作、有效期和配额。Project 归属、Working Set、连接成功或 skill 声明都不能自行生成 Capability。
3. **Approval** 把用户或受管策略的决定绑定到具体动作、目标、revision、影响摘要和不可变调用参数。目标或风险变化后重新评估；Approval 不能绕过被禁止或不存在的 Capability。
4. **Sandbox** 限制获准代码或工具的文件、网络、进程、时间、内存和输出。Sandbox 是执行隔离，不替代前三层授权判断。

四层在同一策略链中协作，但不得合并语义。每个审计事件关联 Workspace、Conversation、run、主体、工具、Working Set 摘要、Mutation Target、Project、Design File、base/current revision、审批和结果。

## 12. Skills 安全模型

Skill 是包含说明、参考资料、脚本或资产的扩展包，应默认视为不受信任内容。运行时先解析清单并显示来源、版本、完整性和请求能力；只有用户或受管策略可以授予权限。

加载说明不等于执行附带脚本。脚本应在受限环境中运行，并受工作目录、文件路径、网络域名、命令、时间、输出和资源配额约束。Skill 内容、MCP 返回值、设计文档文本和网页内容都可能包含提示注入，不能改变系统策略或提升权限。

当前 `@opendesign/discovery` 已能在隔离边界内发现 user/project/builtin `SKILL.md` 和分层 `AGENTS.md`，处理来源优先级、符号链接逃逸与内容哈希；生产 Agent、管理 UI、能力审批和审计链尚未消费这些结果。因此用户自定义 Skill/提示词当前仍是低优先级目标，不能描述为已可用。未来设计 Skill 可以约束风格、方法与评审标准，但不能替代真实设计工具或扩大写入权限。

详细的开放源码和扩展边界见 [ADR-0004](adr/0004-agent-open-source-boundaries.md)。项目自带 UI 设计工作流见 `../.agents/skills/ui-design/SKILL.md`。

## 13. 历史引擎迁移记录

早期 OpenPencil 原型验证过单 Design File、多 Page 和完整编辑器嵌入，但同时引入第二份页面、图层、历史和任意 `filePath` 工具边界。OpenDesign 保留“单文件多 Page”的产品结论，不采用其文档状态、运行时或路径授权方式。当前 OpenPencil 固定提交 `449f31dd8b7df12965f65d9da774597332fc153d` 继续作为产品行为与验收矩阵参考：工作台层级、Pen/锚点编辑、画布 overlay、属性面板、图片裁剪、SVG import/export 与模板回归值得对照；能力矩阵见 [OpenPencil 能力对照](openpencil-capability-benchmark.md)，节点编辑裁决见 [ADR-0027](adr/0027-versioned-vector-point-editing.md)。

OpenPencil vendor/runtime、旧 Canvas2D 产品包、手写 React 画布交互及其构建/发行资源均已移除。缺失的专业能力继续通过 OpenDesign 公共语义、LeaferJS 和可替换成熟服务实现，不能以能力尚未完成为理由恢复 fallback 或双写。历史原因见 [ADR-0005](adr/0005-opendesign-owned-editor-runtime.md)、[ADR-0006](adr/0006-project-conversation-agent-scope.md)、[ADR-0009](adr/0009-leafer-rendering-and-interaction-engine.md) 与 [ADR-0011](adr/0011-professional-design-capability-architecture.md)。

## 14. 数据、隐私与恢复

- 本地文档采用原子写入，保留可恢复快照或操作日志，并为格式升级提供显式迁移。
- 当前每个 Provider 的 API Key 由 Main 使用 Electron `safeStorage` 分别加密；Renderer 与 Agent 只看到脱敏 Catalog 或 canonical model events。密钥不写入 Project、日志、提示词或 Renderer 存储。
- 用户明确选择的 Agent 附件默认保存在本机 `~/.opendesign/attachments`；只有在发送包含该附件的 Conversation 消息时，Main 才把对应图片内容或本地提取的文档文本交给当前选择的外部模型。图片要求模型声明 `imageInput`，文档不授予原文件或目录访问。项目正文、Utility journal 和 model bridge 不保存原始路径或 inline base64。
- 发送给外部模型或 MCP 的每段数据都带来源、Working Set 与资源作用域，并受 provider 配置、Capability 和 Approval 约束。
- 日志默认去除设计正文、提示词、令牌、附件内容和工具参数。当前支持从通知复制单条结构化诊断；后续批量诊断导出必须先允许用户预览。
- Agent 与 MCP 写操作逐目标记录主体、Conversation/run、工具、参数摘要、Project、Design File、base/current revision、结果和撤销句柄。

## 15. 质量属性

### 响应性

指针、键盘、缩放和选区更新不得等待 Agent 或远程服务。长任务异步执行、可取消，并以渐进状态更新 UI。

当前 Leafer adapter 直接消费 `DesignTransaction` 的 `DesignChangeSet`。相邻 revision 只遍历活动 Page 的结构 ID，并为 added/changed/removed 节点及引用变更 asset 的节点重建投影 spec；未变 spec 保持引用稳定，reconcile 只访问该 affected set，只对实际变化的 data、transform 和父子顺序调用 Leafer。普通 revision 不再隐藏 Editor、重放整棵场景或强制更新 tree bounds；只有变化与当前选区存在祖先/后代关系时，才刷新对应选中元素的 bounds。首次挂载、Design File/Page 切换、revision 断档和交互失败恢复仍使用全量可丢弃投影作为正确性回退。固定节点规模、效果复杂度和帧时间的真实 Electron 基准仍需持续记录；不能通过建立第二份可写状态、跳过 revision 或牺牲选区准确性换取表面流畅。

### 可恢复性

Renderer、Agent 或引擎子系统异常后，主进程应隔离故障并尽可能恢复最近的持久状态。单个 Design File 的事务要么完整提交，要么不产生可见修改；跨文件多目标计划可能部分完成，必须保留逐目标状态、冲突与撤销或补偿信息。

### 可替换性

模型 provider、MCP transport 和低层渲染后端都通过契约接入。升级基线必须通过兼容性与视觉回归验证。替换渲染后端不得改变 OpenDesign 文档、事务或 editor state 语义。

### 可测试性

契约使用确定性 fixtures 和 contract tests；引擎适配器验证快照、事务与事件；Agent 使用录制或伪造工具响应测试取消、重试、三类作用域、四层安全和同文件 revision 冲突；跨项目多目标覆盖部分失败与恢复；关键 UI 进行键盘、可访问性与视觉验证。

## 16. 演进顺序

当前演进顺序由 [`roadmap.md`](roadmap.md) 维护：在已经建立 capability manifest 后，先完成固定样张、渲染诊断与实机证据，再按精确矢量 → 图片/文字/海报交付 → 布局/组件/变量 → 导入导出 → 完整 Agent 权限与 MCP 的依赖顺序推进。

阶段顺序不承诺发布日期，但每一阶段必须保持唯一事实状态、可运行、可验证、可撤销，并且不得恢复旧引擎作为过渡入口。
