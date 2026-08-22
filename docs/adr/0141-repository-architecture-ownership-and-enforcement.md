# ADR-0141：全仓架构所有权、依赖方向与可执行门禁

- 状态：已接受
- 日期：2026-08-23
- 关联：ADR-0001、ADR-0006、ADR-0046、ADR-0086、ADR-0094、ADR-0140

## 背景

ADR-0046 已用完整业务切片拆出多组 Renderer feature、Main IPC host 和产品 service，workspace 生产依赖图当前无环，`EditorRuntime` 仍是文档、revision、history 与 selection 的唯一权威，Leafer 对象也没有越过 `@opendesign/leafer-engine`。这些边界应保留。

但“包图无环”和“入口文件变短”不能证明架构合理。全仓审计发现现有 `architecture:check` 只覆盖 Electron 目录越界、workspace manifest 依赖基线和 package cycle，不能识别以下问题：

- `App.tsx` 用彼此独立的 `view`、Project、Conversation 和 Design File 状态表达同一次导航，异步打开没有 latest-wins 提交门禁；资源缺失时会落入 Editor，而不是显式 loading/error destination；
- `AppContent` 在 destination 分支前建立几乎全部 Project、Agent、Editor、Canvas、Image、Import/Export 和 Workbench controller，仍然充当应用级 service locator；
- `WorkspaceRuntime` 已拥有活动 Design File 身份与名称，Project feature 又维护 `activeProject` 和 `fileName` 镜像，保存、重命名和切换依赖双写；
- Main 的 Agent 进程、Run、预检、Continuation、reference 和异常退出清理没有统一 supervisor，启动流程也不是可回滚状态机；
- 审计时 `@opendesign/tool-runtime` 尚未成为真实生产边界，跨进程 tool wire contract 也仍由实现包导出；
- 无生产调用者的旧 Design Engine/MCP adapter 暴露独立 open/save/apply/undo/redo 生命周期，可能演化成第二份文档权威；
- 审计时 Renderer、Main、Preload、Agent、Shared 内部源码图、进程 package allowlist、未声明依赖、声明但未使用依赖和私有 deep import 尚无机器门禁。

因此 ADR-0140 完成的是其中列出的 Image、Workbench、Conversation、Project、Canvas、Diagnostics 与 locale catalog 迁移，不代表 Renderer composition、导航所有权或全仓架构治理已经完成。此 ADR 修正其过早的完成表述，但不推翻已落地的 feature owner。

## 决策

### 以唯一 owner 和完整生命周期作为模块边界

模块拆分的验收单位不是行数或文件，而是一个 owner 是否同时持有：稳定资源身份、状态转换、异步任务、取消、错误恢复、清理和定向测试。纯 view 只消费 view model 与语义 command；入口只负责 provider、application host、navigator、destination composition 和全局 overlay。

不得通过互相回调的碎片、通用 Context、兼容 facade 或第二套 store 隐藏仍未迁移的所有权。高频 Canvas 状态不进入应用级 Context；文档、revision、history、selection 和 viewport 继续由现有 Runtime/session owner 持有。

### Renderer 使用原子 destination，不机械引入 Web Router

建立唯一 `AppNavigator`，用判别联合表达可渲染 destination：

```text
workspace
project(projectId)
conversation(conversationId)
editor(fileKey)
settings(returnTo)
invalid(requestedDestination, reason)
```

异步打开必须 `begin` 一个递增 transition epoch，只有最新 epoch 可以把已经解析成功的资源身份与 destination 一次提交。旧请求的成功、失败和 finally 都不得覆盖新意图。资源不存在、删除或加载失败进入显式 invalid/error destination，不再静默显示 Editor。

当前 Electron 使用 `loadFile(index.html)`，此切片不安装 `BrowserRouter`：Router 不能修复多 owner 和迟到提交，`BrowserRouter` 刷新也不能映射打包文件。后续只在确实需要返回栈和嵌套 route boundary 时采用 Memory Router；需要可复制深链和重启恢复时再采用 Hash Router。文档内容、revision、selection、tool、viewport、panel、modal、form、Run 和 capability 不进入 URL route state。

### 活动资源身份只保留一份

`WorkspaceRuntime` / Workspace session 继续拥有活动 Design File 身份、当前 Runtime 和文件名。Project catalog 只保存 manifest；`activeProject` 从 `activeProjectId + catalog` 派生。删除 React 层 `setActiveProject` / `setFileName` 双写，保存和重命名只提交对应 owner，再从 snapshot 投影 UI。

应用常驻服务与 Editor destination 生命周期分离：autosave、durable Agent event bridge、Renderer design-tool host 和 diagnostics 可常驻；Canvas shortcuts/session、Workbench layout、Inspector/selection projection、Image edit 与人工 Import/Export 随 Editor destination 建立和释放。`EditorWorkbenchFeature` 应连同 controller、selection view model 和 workbench JSX 一起迁移，不能只搬 JSX。

### Main 使用 supervisor 和可回滚启动

Renderer↔Agent request/event routing 由 `AgentIpcRouter` 独占 sender/arity/payload 校验、Run/Request correlation、事件分发和 listener 清理；它不取得 Run、Provider、Project、Reference 或 Design 状态所有权。

后续建立唯一 `AgentSupervisor + AgentRunCoordinator`，持有 process generation、ready watchdog、Run/preflight/continuation lease 和异常退出清理，shutdown 使用 `quiesce → cancelAll → drain → graceful stop / timeout kill`。Main 启动迁入 `DesktopApplication.start()`：先构造未发布的 immutable services，逐步登记 disposer，以 IPC registration 为 commit point；任一步失败都记录诊断、逆序 rollback 并非零退出，不能留下部分可用的全局 service。

### Contracts、Tool Runtime 与 MCP 只有一条调用链

跨进程 request/event/result/failure wire contract 归 contracts 包；`agent-runtime` 只拥有模型循环，`model-gateway` 只拥有 provider adapter，Main Tool Runtime 统一拥有策略、审批、超时、取消、审计与派发。迁移完成前不把当前错误依赖登记成永久 baseline。

MCP 只能依赖 Main 提供的稳定 resource handle、revision、`DesignReadPort` 和 `ToolInvocationPort`。删除或降级无生产调用者的旧 `DesignEngineAdapter` open/save/apply/undo/redo 门面，不补成第二个引擎，也不允许任意 `filePath` 绕过 Project/Workspace capability。

### 架构规则必须逐步机器化

在正确边界迁移完成后扩展 architecture verifier：

1. 建立 Main、Preload、Renderer、Agent、Shared 与 workspace package 的源码依赖图和 cycle 检查；
2. 为每个 Electron 进程层配置允许依赖的 package tags/allowlist；
3. 拒绝 undeclared dependency、私有 deep import 和非法进程反向依赖；
4. 报告 declared-but-unused dependency，并在完成真实边界迁移后失败关闭；
5. 将 desktop app 纳入 workspace DAG，而不只检查 packages；
6. release 阶段从 lockfile 与实际产物生成依赖/license/SBOM inventory，而不是只检查 notice 文件存在。

门禁用于冻结已经正确的边界，不能通过内容 hash、源码数量或行数预算代替职责审查。

### 实施顺序

1. 完成并测试 `AgentIpcRouter`，保持 Phase 6 仍为进行中；
2. 建立 Renderer `AppNavigator` 与 latest-wins destination commit；
3. 移除活动 Project/Design File 名称镜像；
4. 提取完整 `EditorWorkbenchFeature`，再治理 Canvas/Settings/App 测试 fixture；
5. 建立 Agent supervisor 与 Main 可回滚 startup；
6. 迁移 Tool wire contract，随后加入进程 package allowlist/source graph；
7. 收口旧 MCP/Design Engine 门面；
8. 按 ADR-0046 顺序继续 EditorRuntime、Leafer、SVG 与 release inventory 治理。

每一步必须保持可运行，只做最小充分的定向测试、typecheck、lint、format 和 architecture check；不以本地原生安装包构建作为日常架构重构验证。

当前步骤 1—7 已落地：`AgentIpcRouter`、原子 `AppNavigator`、活动 Project/Design File 身份单 owner 与完整 `EditorWorkbenchFeature` 均已有定向测试。Workbench controller、selection projection、Image edit、人工 Import/Export 和画布 session 只随 Editor destination 建立；Settings 与 Workspace 会释放这些订阅，返回 Editor 复用同一权威 `EditorRuntime`。`AgentSupervisor` 持有单一 utility-process generation、ready/handshake watchdog、协议失败、异常退出和有界停止；`AgentRunCoordinator` 持有 Run→Conversation、preflight AbortController、continuation、Reference 与 Renderer/performance lease。进程级错误会中断 Global Task 并释放全部 Run lease，shutdown 按 `quiesce/cancelAll → Supervisor stop → detach/dispose` 执行。`DesktopApplication.start()` 使用显式 commit 和逆序 disposer 栈；`IpcRegistrationScope` 记录本次成功注册的 channel；Renderer load 失败会销毁未发布窗口，startup 错误在 rollback 后非零退出。Agent 握手不阻塞窗口首屏。步骤 8 和全仓治理仍保持进行中。

步骤 6 已完整落地：Main↔Agent 的 tool call/context/progress/result/failure schema、类型和语义校验由 `@opendesign/agent-contracts` 单一拥有，`agent-runtime` 不再兼容导出这些 wire 类型；Desktop shared 只保留 Renderer capture、阶段进度、性能和原生导入导出准备结果等 Renderer 专用契约。所有 Agent-facing design tools 由 `MainDesignToolRuntime` 使用同一份 `DESIGN_AGENT_TOOL_SPECS` 注册；Runtime 复核 semantic input、精确 Design File resource、Main 已记录的 Page 授权、TrustedToolResult、输出大小、硬超时、取消、调用冲突和 silent audit，再委托现有领域 dispatcher。`GlobalTaskCoordinator` 继续唯一拥有 Plan、ledger、revision、inspection、review 和目标规则；通用 runtime 不复制设计领域门禁。Agent utility process 原先直接解析 home path 并写 JSONL 的路径也已删除；`ParentSessionStore` 只发送受校验的 append/read/timeline/project 请求，由 Main 的 `AgentSessionStoreHost` 使用同一 `JsonlSessionStore` 持久化和恢复。新的 `architecture-policy.json` 按语义层分类 workspace package，而不是冻结精确依赖清单；TypeScript AST 门禁检查 Main/Preload/Renderer/Agent/Shared runtime package capability、Node/Electron builtin、相对进程越界、实际源码 runtime cycle、manifest undeclared/unused production dependency、workspace layer 方向和私有 deep import，并把 Desktop application 纳入同一 workspace DAG。Main 领域 dispatcher 的更细 service composition 仍属于后续步骤。

步骤 7 已完整落地：无生产调用者的 `@opendesign/design-engine`、`@opendesign/mcp-host` 和 `@opendesign/mcp-server` package 已删除，不保留兼容 re-export、fallback 或空占位。独立 `DesignEngineAdapter` 的 `open/save/apply/undo/redo` 生命周期不再存在，避免在 Workspace 与唯一 `EditorRuntime` 之外形成第二份文档权威。未来双向 MCP 必须由 Main 组合稳定 resource handle、revision、`DesignReadPort` 与 `ToolInvocationPort`，并复用现有 capability、approval、audit、取消和 Design Transaction 链后才能重新接入。

步骤 8 的 EditorRuntime 治理已开始但未完成：`document-diff` 现在单一负责 transaction、undo/redo 和 grouped history 共用的完整 `DesignChangeSet`，`EditorHistory` 单一持有 undo/redo stack、active group、rollback 与 `HistoryState`；Page、Asset/Image Derivation 和 Component/Library Source mutation 已进入各自完整 command family，共用无状态稳定 ID/树定位原语，`EditorRuntime` 不再实现这些命令。Element/Text、字体测量与 Auto Layout execution context 及最终 dispatcher 尚未迁出，后续 Leafer、SVG 与 release inventory 也仍保持开放。

## 后果

- `App.tsx` 和 Main `index.ts` 会继续收缩，但是否完成由状态和生命周期所有权决定，而不是目标行数。
- 导航不会再出现 destination 与资源身份不一致、迟到请求覆盖或资源缺失后误入 Editor。
- Agent 异常退出、取消、continuation、reference 和应用关闭最终将由同一生命周期 owner 收口。
- 包图、进程边界和源码依赖会从文档约定升级为自动门禁；迁移期间仍必须区分“已审计”“已决定”和“已实现”。
- 已完成的 feature controller、唯一 EditorRuntime、Leafer 投影边界和 typed Preload API 不重写。

## 验证

- `AgentIpcRouter`：sender 优先、参数/payload、history correlation、dispatch rollback、重复 registration 与 dispose。
- `AppNavigator`：判别联合、原子提交、latest-wins、settings return、invalid destination 与删除中的资源。
- Project/Workspace：活动 Project 派生、文件 identity/name 单 owner、保存/重命名/切换无双写。
- Main Supervisor/Startup：已覆盖单 process generation、ready timeout、握手顺序、协议不兼容、异常退出、并发 start、graceful/forced stop、并发 Run 取消、preflight/continuation/reference/Renderer lease 统一回收，以及 startup 并发调用、缺失 commit、部分 IPC、Renderer load 和 disposer 失败的逆序 rollback。
- Architecture verifier：进程 allowlist、源码 cycle、undeclared/unused/deep import 和 workspace app DAG fixtures。
- 每个切片执行最小相关 Vitest、Desktop typecheck、ESLint、Prettier 与 `pnpm architecture:check`；原生 macOS/Windows package/smoke 仍在发布门禁执行。
