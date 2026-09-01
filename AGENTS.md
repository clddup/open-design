# OpenDesign 协作指南

本文件适用于仓库根目录及其所有子目录。更深层目录中的 `AGENTS.md` 可以为局部代码补充规则，但不得放宽这里定义的安全、依赖和架构边界。

## 产品方向

OpenDesign 是 AI-native 通用设计平台。UI 设计是第一能力和首个质量标杆，但产品模型、文档模型和工具体系不得把能力限制为 UI，也应支持 Logo、海报、品牌物料、演示图形及后续设计类型。

OpenDesign 是跨平台桌面产品。macOS 与 Windows 是同级一级支持平台，必须分别在原生系统完成构建、安装和产品 smoke，任一平台失败都阻塞桌面发布；不得用一个平台的结果推断另一个平台可用。Linux 保留目标和兼容边界，但当前阶段不阻塞 macOS/Windows 里程碑。

桌面端采用 Electron 外壳和 Web 画布。界面应体现高质量、低 Web 感的 Codex 式桌面体验：克制、紧凑、层级清晰、键盘友好，并以工作台、面板、检查器和命令为核心，而不是营销页式卡片、巨型标题或装饰性渐变。

## 事实来源

- 阅读 `docs/product-and-architecture.md` 了解产品范围、系统边界和目标架构。
- 阅读 `docs/design-capability-baseline.md` 与 `docs/roadmap.md` 了解完整专业能力范围、当前缺口和依赖顺序；不得按临时反馈把 schema 演化成零散补丁集合。
- 阅读 `docs/adr/` 中已接受的决策；项目、跨目录 Agent 的作用域和安全模型见 ADR-0006，Workspace 级 Conversation 与 Run 目标见 ADR-0094。改变决策前应新增或取代 ADR，不要静默绕过。
- 阅读 `docs/engine-baseline.json` 获取文档协议与低层渲染后端的可复现版本。不得用浮动分支或“最新版本”替代固定版本。
- 阅读 `THIRD_PARTY_NOTICES.md` 了解直接引入的第三方组件及许可义务。

仓库当前已有 OpenDesign 自有的文档协议、编辑器运行时、事务历史和 Project/File 持久化；生产画布已按 ADR-0009 迁移到固定版本的 LeaferJS 适配器。旧 Canvas2D 产品包以及 OpenPencil 的 vendor/submodule、host、preload、IPC、构建入口与发行资源已经移除，不得重新引入兼容 fallback 或双写路径。OpenDesign 继续拥有持久化设计事实与所有事务，Leafer 场景只是一份可丢弃的当前 revision 投影；已实现协议与引擎的固定版本和验证状态记录在 `docs/engine-baseline.json`。不要把 attached roots、跨目录 Capability、Main approval bridge 或完整 MCP 策略链等目标能力写成已经完成。

## 架构约束

- Renderer 只负责界面、交互和 Web 画布，不得获得原始 Node.js、Electron IPC 或任意文件系统访问能力。
- Preload 只暴露小型、类型化、可验证的能力接口。主进程必须校验 IPC 的发送方、参数、权限和生命周期。
- 内置垂直设计 Agent 是主产品路径。Agent Runtime 使用 TypeScript，运行在 Electron `utilityProcess` 中，并通过可替换 provider adapter 直接接入多种大模型。Agent 崩溃、取消或模型提供商异常不得带崩主进程或破坏画布状态。
- 目标资源层级固定为 `Workspace → Project → Design File → Page → Frame/Artboard → Layers`。Conversation 是 Workspace 一级实体；`originProjectId` 只记录不可变创建来源，`filedProjectId` 只提供可空、可移动的组织关系，Project 不是文件系统 sandbox，也不隐式授予项目目录权限。
- Conversation 是持续 Agent 上下文，Run 只是单条用户消息触发的一次执行。失败、取消、超时或 Provider 异常只能终结当前 Run；下一条消息必须能继续读取同一 Conversation 的历史、历史用户附件、当前 Design File 与已提交 revision。Main 可以为新 Run 重新签发最小能力，但不得要求用户重新上传同一 Conversation 的附件，也不得让失败 Run 的 response identity、半截 tool call、active lease 或错误状态污染后续 Run。
- Provider 已返回的 Assistant text 与 reasoning summary 是按原始顺序追加的 Conversation 事实。Plan、tool、状态卡、完成门禁、重试、失败和取消只能追加各自事件，不得清空、替换、重排或冒充模型消息；UI 可以默认折叠 reasoning 与工具过程，但不得隐藏真实 Assistant text。
- Working Set、Mutation Targets 与 Capabilities 必须分别建模。上下文中可读不等于可写，被列为写目标也不等于已经授权；三者不得从 Conversation 的组织字段、当前选区或彼此隐式推导。Run `targetSet` 才是实际 Project/Design File/Page 的权威来源。
- 项目可保存经批准的 attached roots；一次 run 也可持有不改变项目归属的 per-run references。跨目录、跨项目和多目标操作必须使用稳定资源 ID 或 Main 签发的句柄，并对每个目标单独解析能力、审批与 revision。
- 权限控制分为 Trust、Capability、Approval 与 Sandbox 四层。四层职责不得合并：可信度不授予能力，能力不替代高风险动作审批，审批不扩大请求范围，sandbox 不充当授权策略。
- Main 拥有路径解析与规范化、root/handle 登记、凭据、策略决策和工具执行代理。Agent Runtime、Renderer、skills 与 MCP 不得取得原始凭据、任意路径能力或未代理的工具执行入口。
- 内置设计 Agent 优先使用 typed design tools 和 `DesignTransaction`，不注册或暴露裸文件系统与通用 Bash/shell。确需文件、进程或网络能力时，只能调用 Main 代理的窄工具，并经过同一策略、审批、隔离和审计链。
- 设计操作必须通过版本化的 OpenDesign 事务契约进入唯一 `EditorRuntime`。UI、Agent、MCP 和导入器不得建立第二份可写文档状态，也不得依赖具体渲染后端 API。
- OpenDesign 拥有文档 schema、节点语义、事务、revision、diff、history，以及持久的 selection/tool/viewport session state。LeaferJS 适配器负责生产渲染、场景投影、viewport 机制、坐标转换、命中测试、选择器和直接操作；其对象、类型和私有序列化不得越过 `@opendesign/leafer-engine`。手势结束后必须生成一条 OpenDesign 事务，失败时从权威快照恢复。
- Agent 先生成可校验的设计命令或事务，再由受信任的主机执行。禁止让模型直接修改引擎内存、项目文件或 Electron 特权状态。
- MCP 是次级互操作边界，不替代内置 Agent。OpenDesign 可以作为客户端调用外部 MCP 服务，也可以作为服务端向获准客户端暴露设计能力；两种方向都必须复用内置 Agent 的同一事务入口，以及同一套能力声明、参数校验、同意和审计策略。MCP 工具参数不得成为任意本地 `filePath` 后门。
- 多个 Conversation 可以跨 Project 并发运行。不同 Design File 独立推进；同一 Design File 的写入以 `baseRevision` 做乐观并发控制，过期事务必须返回 `conflict`，不得静默覆盖、按会话建立第二份事实状态或用长时间项目级锁掩盖冲突。
- Skills 是不受信任的指令与资源包，不是权限授予。加载 skill 不得自动获得 shell、网络、密钥、文件系统或 MCP 权限。

## 代码与变更原则

- 优先保持包边界清楚：桌面外壳、Agent 契约、设计契约、引擎适配器、工具运行时和 UI 不得形成循环依赖。
- 新功能先扩展通用设计语义，再增加具体渲染或格式适配。不要把 CanvasKit、浏览器或第三方编辑器对象泄漏到公共契约。
- 所有跨进程、跨插件和模型生成的数据都视为不可信输入，并在边界处进行运行时校验。
- 长任务必须可取消，并提供进度或阶段状态。画布交互和窗口响应不能等待模型、MCP 或磁盘任务同步完成。
- 用户内容默认留在本地。任何上传、遥测或外部模型调用都应清楚标示数据范围，并遵循显式配置和最小披露原则。
- 不要复制第三方编辑器实现来绕过产品边界。升级低层渲染、文字或几何依赖应作为独立变更完成，同时更新固定版本、基线 JSON、第三方声明、兼容性测试和对应 ADR（若契约或风险改变）。
- OpenPencil 的单文件多页模型可以作为调研输入，但其 MCP 按调用接受任意 `filePath` 并直接加载或保存目标文件的方式不得照抄。完成 ADR-0005 与 ADR-0006 定义的移除门禁后，必须删除 OpenPencil 运行时、发行资源和 vendor 依赖，不能保留无期限 fallback 或双写路径。
- 不要提交生成物、密钥、访问令牌、用户设计文件或模型会话内容。

### 契约与校验单一事实源

- 该约束覆盖完整 Agent 生成链，而不只覆盖 first-slice 或首屏：Delivery Scope、Plan、First Slice、Apply、Checkpoint、Capture、Review、图片读写与放置、组件/层级/排版/矢量工具、Agent/Provider Event、Main/Preload IPC、Workspace/Conversation 持久化以及最终 DesignDocument/事务协议都必须按同一原则收敛。可以分阶段迁移，但不得把单个工具迁移完成描述为整个流程已解决。
- 每个 Agent tool、Provider 输入、跨进程事件和 IPC payload 必须只有一份权威结构 Schema。Provider 可见 Schema 必须从该 Schema 派生；不得另外手写一份字段、required、enum、union、长度、范围或未知字段规则。
- 不得为同一输入并行维护 `isXxx()`、`exactKeys()`、`normalizeXxx()`、`explainInvalidXxx()` 或等价的重复结构判断。结构 parse、错误路径和 Provider 投影必须从同一 Contract 入口产生。
- 校验职责固定分层：Schema 只管字段结构；Domain refinement 只管跨字段关系、ID 唯一性、父子结构和总量预算；Main guard 只管 Page、capability、revision、当前状态和可写目标；EditorRuntime 只管文档 invariant、引用和事务原子性。同一规则不得在多层重复定义。
- Normalizer 只能注入当前 Page、权威 Run prompt、固定 skill refs 等可信宿主事实；不得静默修复任意非法模型输入，也不得在宿主绑定中新增 Provider 不可见的结构门禁。
- 所有契约失败统一返回结构化 `code/path/message/expected/actual/recovery`；Timeline、诊断、恢复和测试使用稳定 `code/path`，不得通过解析错误文本推断类型。Union 必须先按 discriminant 选择真实分支，错误必须指向具体字段。
- 契约迁移只有在旧结构校验、重复 normalizer 和错误解释路径被删除，Provider/Runtime 一致性测试、真实复杂 fixture 与失败字段路径测试通过后才算完成。只新增 `Contract.parse()` 但保留旧事实源，不得声称已经整改。
- 用户可以容忍偶发一次模型参数错误，但同一 fingerprint 不得连续消耗完整 Provider 往返。首次错误必须返回准确字段路径与可执行恢复；重复错误必须抑制并保留已提交 revision，不得长时间零画布变化地循环。
- OpenDesign 是编辑器而不是流程管理系统。当前 Design File 中的用户内容和历史 Agent 产物都保持同等可编辑，不得按创建 Run、Conversation、模型或工具建立写入所有权。Run `targetSet` 只限定本次作用域，revision 只处理并发，二者都不得阻止用户重构已存在的设计。
- Typed 专用工具是原子语义、并发安全和效率入口，不是互斥权限孤岛。普通 Figma 式编辑（选择、移动、缩放、重组、替换外观、删除、重建）不得仅因“应改用另一个 OpenDesign 工具”而失败；宿主应自动编译/路由，或让通用事务直接执行。只有 capability、approval、stale revision、外部资产授权和文档 invariant 可以形成硬拒绝。

### Agent Plan 执行事实

- 用户可见 Plan 必须代表真实执行状态，不能作为装饰性说明或根据聊天文案猜造。Main 是 Plan execution ledger 的唯一事实源；Renderer 只能按稳定 `stepId` 投影 ledger，不得解析 label、message、revision 文案或工具名称推断步骤状态。
- Plan 状态固定为 `pending → in_progress → completed`。全部 target 按声明顺序形成一条串行执行链：已完成步骤必须构成连续前缀，未完成步骤必须构成后缀，未完成时恰好一个步骤为 `in_progress`；禁止跳步、倒退、跨步骤并行和直接 `pending → completed`。
- 设计事务只有在命中当前步骤并产生真实 material revision 后才能完成实现步骤；review/refine 步骤只能由可信 capture、review、refinement 与 verified revision 证据完成。失败事务、消息文本和仅有工具请求不能推进 Plan。
- 修改 Plan 必须显式生成新的 `planRevision`，已经开始的步骤保持稳定 ID、顺序和语义。Run completion 必须与 ledger 一致；仍有 `pending` 或 `in_progress` 步骤时不得宣称完成，也不得让 UI 显示完成。

## UI 质量基线

- 优先使用桌面信息架构：稳定的应用框架、可调整面板、画布中央舞台、上下文检查器、命令面板和明确状态区。
- 保持密度与呼吸感平衡。常用操作应近、快且可通过键盘完成；危险或低频操作应降低视觉权重。
- Renderer 新建或实质修改的业务组件样式使用 `Component.module.scss`：CSS Modules 负责作用域，固定 Dart Sass 只做编译期预处理。全局样式仅保留 reset、语义 design tokens、应用 shell 和确实跨组件的布局/状态契约；不得继续向巨型全局 `styles.css` 追加组件私有规则，也不得拆成多份仍相互覆盖的全局 SCSS 冒充模块化。动态画布几何优先通过 CSS custom properties 传入 module，不引入第二套运行时 CSS-in-JS。
- 选中、悬停、焦点、禁用、加载、错误和离线状态必须可辨识。不要只依赖颜色表达状态。
- AI 操作必须展示作用域、预期变更和执行状态，并支持取消；高影响变更应可预览、撤销或回滚。
- 内置设计 skill 必须位于实际生成/审核上下文的高显著位置，不能只作为被长工作流提示淹没的被动文本。独立视觉审核以用户 brief 与 exact-revision capture 为主要证据，不得用作者自述的 thesis、motif 或 visualSystem 为像素缺陷辩护；任一非补偿标准仍要求实质 refinement 时不得同时判定交付完成。
- 画布坐标、缩放、选区、撤销栈和文档保存是高风险路径。修改时应补充针对边界条件、序列化和失败恢复的测试。
- 项目级 UI 工作应遵循 `.agents/skills/ui-design/SKILL.md`。

## 验证与交付

在变更范围允许时运行最小充分验证，并在交付说明中列出实际执行的命令。常用入口以根 `package.json` 为准，包括 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和聚合命令 `pnpm verify`。

提交或评审前检查以下事项：

1. 变更未绕过进程、引擎、MCP 或 skill 安全边界。
2. 公共契约的变化包含版本、迁移策略和失败行为。
3. 新第三方代码包含来源、固定版本、许可证和必要通知。
4. UI 变更覆盖键盘操作、焦点、缩放、空态、错误态和窄窗口。
5. 文档描述当前事实；尚未实现的内容明确标为目标或计划。
6. 涉及文件、窗口、菜单、快捷键、凭据、Agent 进程、打包或原生依赖的变化必须检查 macOS/Windows 等价行为；平台特例不能散落到公共契约。
