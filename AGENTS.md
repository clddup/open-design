# OpenDesign 协作指南

本文件适用于仓库根目录及其所有子目录。更深层目录中的 `AGENTS.md` 可以为局部代码补充规则，但不得放宽这里定义的安全、依赖和架构边界。

## 产品方向

OpenDesign 是 AI-native 通用设计平台。UI 设计是第一能力和首个质量标杆，但产品模型、文档模型和工具体系不得把能力限制为 UI，也应支持 Logo、海报、品牌物料、演示图形及后续设计类型。

桌面端采用 Electron 外壳和 Web 画布。界面应体现高质量、低 Web 感的 Codex 式桌面体验：克制、紧凑、层级清晰、键盘友好，并以工作台、面板、检查器和命令为核心，而不是营销页式卡片、巨型标题或装饰性渐变。

## 事实来源

- 阅读 `docs/product-and-architecture.md` 了解产品范围、系统边界和目标架构。
- 阅读 `docs/design-capability-baseline.md` 与 `docs/roadmap.md` 了解完整专业能力范围、当前缺口和依赖顺序；不得按临时反馈把 schema 演化成零散补丁集合。
- 阅读 `docs/adr/` 中已接受的决策；项目、多会话与跨目录 Agent 的作用域和安全模型见 ADR-0006。改变决策前应新增或取代 ADR，不要静默绕过。
- 阅读 `docs/engine-baseline.json` 获取文档协议与低层渲染后端的可复现版本。不得用浮动分支或“最新版本”替代固定版本。
- 阅读 `THIRD_PARTY_NOTICES.md` 了解直接引入的第三方组件及许可义务。

仓库当前已有 OpenDesign 自有的文档协议、编辑器运行时、事务历史和 Project/File 持久化；生产画布已按 ADR-0009 迁移到固定版本的 LeaferJS 适配器。旧 Canvas2D 产品包以及 OpenPencil 的 vendor/submodule、host、preload、IPC、构建入口与发行资源已经移除，不得重新引入兼容 fallback 或双写路径。OpenDesign 继续拥有持久化设计事实与所有事务，Leafer 场景只是一份可丢弃的当前 revision 投影；已实现协议与引擎的固定版本和验证状态记录在 `docs/engine-baseline.json`。不要把 attached roots、跨目录 Capability、Main approval bridge 或完整 MCP 策略链等目标能力写成已经完成。

## 架构约束

- Renderer 只负责界面、交互和 Web 画布，不得获得原始 Node.js、Electron IPC 或任意文件系统访问能力。
- Preload 只暴露小型、类型化、可验证的能力接口。主进程必须校验 IPC 的发送方、参数、权限和生命周期。
- 内置垂直设计 Agent 是主产品路径。Agent Runtime 使用 TypeScript，运行在 Electron `utilityProcess` 中，并通过可替换 provider adapter 直接接入多种大模型。Agent 崩溃、取消或模型提供商异常不得带崩主进程或破坏画布状态。
- 目标资源层级固定为 `Workspace → Project → Design File → Page → Frame/Artboard → Layers`。`Conversation.homeProjectId` 只提供默认组织与上下文锚点；Project 不是文件系统 sandbox，也不隐式授予项目目录权限。
- Working Set、Mutation Targets 与 Capabilities 必须分别建模。上下文中可读不等于可写，被列为写目标也不等于已经授权；三者不得从 `homeProjectId`、当前选区或彼此隐式推导。
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

## UI 质量基线

- 优先使用桌面信息架构：稳定的应用框架、可调整面板、画布中央舞台、上下文检查器、命令面板和明确状态区。
- 保持密度与呼吸感平衡。常用操作应近、快且可通过键盘完成；危险或低频操作应降低视觉权重。
- 选中、悬停、焦点、禁用、加载、错误和离线状态必须可辨识。不要只依赖颜色表达状态。
- AI 操作必须展示作用域、预期变更和执行状态，并支持取消；高影响变更应可预览、撤销或回滚。
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
