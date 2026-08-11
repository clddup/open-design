# ADR-0006：项目、多会话与跨目录 Agent 作用域

- 状态：已接受
- 日期：2026-08-07
- 补充：ADR-0002、ADR-0004 与 ADR-0005
- 迁移说明：旧引擎移除已经关闭；专业能力延续路径由 ADR-0009、ADR-0011 定义

## 背景

OpenDesign 需要同时支持多个项目、多个长期会话、一个设计文件中的多个页面，以及一次 Agent run 对多个设计文件或外部目录的受控引用。当前协议以单个 `documentId`、revision 和选区为主要运行作用域，session store 也只记录会话事件；它尚未定义 Project、`homeProjectId`、attached roots、跨项目多目标或完整的目录权限模型。

把 Project 当作 sandbox 会混淆产品组织与安全边界。项目可能没有本地目录，也可能关联多个目录；同一个目录可能由用户附加到不同项目；一次任务还可能临时引用项目之外的文件。反过来，仅把路径放进提示词或 MCP 参数也不能构成可审计的授权。

多个 Conversation 还可能同时修改同一 Design File。会话隔离不能演变成多份可写文档状态，也不能依赖覆盖式保存解决竞争。项目模型、上下文模型、权限模型和事务并发需要独立但可组合的定义。

## 决策

### 资源层级与身份

OpenDesign 的目标产品层级固定为：

```text
Workspace
└── Project
    └── Design File
        └── Page
            └── Frame / Artboard
                └── Layers
```

- Workspace 是一个用户工作环境，聚合项目、会话入口、策略和连接配置。Workspace 不是对整个磁盘的授权。
- Project 是组织、检索、默认上下文和持久配置单元。Project 不是 sandbox，也不因资源显示在项目中就授予读取或写入权限。
- Design File 是持久化、revision 和冲突检测的基本设计文档单元。一个 Design File 包含一个或多个 Page。
- Page 是 Design File 内的顶层设计空间。Frame/Artboard 是 Page 中表达界面、版式或导出边界的容器；Layers 是其下可排序、可组合的节点树。Frame/Artboard 仍属于通用节点语义，不把内核限制为 UI 设计。

每层使用稳定、不依赖绝对路径的 ID。路径只由可信主机映射为资源 ID 或临时句柄；重命名和移动不得改变 Design File 身份。一个 Design File 在任一时刻有一个权威 `EditorRuntime` 状态和单调 revision。

### Conversation 与 Project

Conversation 是持久会话。它包含 `conversationId` 和创建时确定的 `homeProjectId`；后者提供默认浏览位置、相对引用解析起点、策略提示和 UI 归档位置，但不构成权限边界。移动或归档 Project 不得破坏会话审计记录。

Conversation 可以在后续 run 中引用其他 Project。引用其他 Project 不会修改 `homeProjectId`，也不会把相应目录永久附加到 home Project。每个 run 都记录实际 Working Set、Mutation Targets、能力快照、审批和执行结果，避免用会话归属推断真实作用域。

### Working Set、Mutation Targets 与 Capabilities

三类集合分别建模并在 run 开始及工具调用前校验：

- **Working Set** 描述本次推理可读取的上下文，包括 Design File、Page、节点、外部文件、检索结果和固定 revision。它回答“模型本次看到了什么”，不授予写权限。
- **Mutation Targets** 描述本次计划允许改变的资源，包括一个或多个 Design File、节点范围、输出文件或受控外部资源。每个目标携带资源 ID、目标 Project、预期 revision、允许的变更种类和生命周期。它回答“计划要改什么”，不代表调用已经获准。
- **Capabilities** 描述某个主体可请求或执行的动作，例如 `design.read`、`design.mutate`、`file.read`、`file.write`、`network.fetch` 或受限进程工具。能力绑定主体、资源选择器、操作、有效期、来源和约束；它回答“策略最多允许什么”。

一个资源可以只在 Working Set 中，也可以同时是 Mutation Target。写入必须同时满足：目标显式列入 Mutation Targets、调用方持有匹配 Capability、所需 Approval 已完成、执行环境满足 Sandbox 策略。任何集合都不得从另一个集合、当前选区或 `homeProjectId` 隐式扩大。

### Attached roots、per-run references 与跨项目多目标

Project 可以关联零个或多个 attached roots。Attached root 是用户或受管策略明确批准并由 Main 登记的目录句柄，包含稳定 root ID、规范化边界、允许的操作、来源、有效期和撤销状态；它不是传给 Agent 的裸绝对路径。附加 root 只建立可发现的持久关联，实际调用仍需匹配 Capability。

Per-run reference 是只在单次 run 内有效的资源引用。用户可以通过选择器、拖放、打开文件或明确命令，把未附加目录中的文件或其他 Project 的资源加入本次 Working Set 或 Mutation Targets。Run 结束、取消或权限撤销后，临时句柄失效；引用不会自动变成 attached root。

一次 run 可以拥有跨 Project 的多个 Mutation Targets。每个目标单独记录 Project、Design File、base revision、能力和审批。跨文件操作是一个可审计的多目标计划，而不是伪装成单个原子 `DesignTransaction`：每个 Design File 仍通过自己的事务提交并报告成功、冲突或失败；产品必须展示部分完成状态和可用的撤销或补偿动作，不能宣称提供尚未实现的跨文件原子提交。

### 四层安全模型

所有内置 Agent、skills、MCP 和外部资源调用依次经过四层控制：

1. **Trust** 分类代码、调用主体和数据来源。内置控制代码可以比第三方 skill 更可信，但模型输出、设计文本、网页和 MCP 返回值始终是不可信输入。Trust 只影响策略默认值，不直接授予动作。
2. **Capability** 是主机可验证的最小权限。它限制主体、资源、操作、时间和配额；Working Set、Project 归属、MCP 连接成功或 skill 声明都不能自行生成 Capability。
3. **Approval** 是用户或受管策略对具体高风险动作、目标和影响的决定。审批必须显示实际资源与操作，绑定不可变的调用摘要；参数、目标、revision 或风险变化后重新评估。Approval 不能绕过不存在或被策略禁止的 Capability。
4. **Sandbox** 限制获准代码或工具的执行环境，包括文件、网络、进程、时间、内存和输出。Sandbox 是故障与攻击的最后隔离层，不替代 Trust、Capability 或 Approval。

### Main 拥有特权与工具执行

Electron Main 是本地特权的权威代理。Main 拥有：

- 路径选择、规范化、符号链接与路径穿越检查，以及 root ID、资源 ID 和文件句柄映射。
- 操作系统安全存储中的 provider、MCP 和网络凭据；下游只获得受限调用结果或短期不透明句柄。
- Capability 解析、策略决策、Approval 绑定、审计关联和撤销。
- 工具执行代理及其生命周期。实际重负载可放入受限 worker 或 sandbox，但 Main 保留授权、派发和结果校验的所有权。

Renderer、Agent `utilityProcess`、skills 和 MCP 不接收原始凭据，也不把任意路径或命令交给系统 API。Main 在每次执行时重新校验句柄仍有效且目标仍位于获准边界内，防止授权后路径被替换。

内置垂直设计 Agent 是首选产品路径。它优先使用 typed design tools，所有设计写入生成 `DesignTransaction`；默认工具集中不存在裸 `fs`、通用 Bash/shell 或任意命令执行。确需外部文件、进程或网络时，只能调用 Main 托管的窄工具，并经过上述四层控制、参数 schema、超时、配额和审计。

### MCP 复用同一执行面

OpenDesign MCP Server 和 MCP Client 都复用内置 Agent 的 Tool Runtime、Capability 标识、策略、Approval、审计和撤销语义。外部 MCP Client 提交的设计写操作进入同一个 `DesignTransaction` 校验与 `EditorRuntime`，不能获得第二条写路径或比内置 Agent 更宽的默认权限。

MCP 协议层使用 Workspace、Project、Design File、Page、节点和 root handle 等稳定标识。兼容适配器可以在可信边界内接收用户选择的文件，但面向模型或外部客户端的工具不得接受任意本地 `filePath` 并直接加载、创建或保存文件。

### 多会话与并发

多个 Conversation 和 run 可以跨 Project 并发执行。调度器按资源建立短生命周期并发键，不使用全 Workspace 或全 Project 长锁：

- 只读操作固定到明确 revision，可以并行。
- 不同 Design File 的事务相互独立，可以并行提交。
- 同一 Design File 的提交由权威 runtime 按 `baseRevision` 做乐观并发控制，并在短提交区间内串行化。
- 过期事务返回结构化 `conflict`，包含当前 revision 和安全的重新读取入口。运行时不得静默覆盖、自动重放语义不明的命令或用会话私有副本获胜。
- 冲突后的 Agent 必须重新读取受影响上下文，重新预演，并在 Mutation Targets、Capability 和 Approval 仍有效时重试；高影响差异变化需要重新审批。

每个审计事件携带 `workspaceId`、`conversationId`、`runId`、主体、工具、Working Set 摘要、Mutation Target、Project、Design File、base/current revision 和结果，以支持跨会话追踪。

## OpenPencil 调研与边界

移除前固定调研的 OpenPencil `PenDocument` 将页面数组与节点树序列化到一个文档文件，说明“单个设计文件包含多个页面”是可行的产品模型。它的桌面 MCP 还支持在单次调用中读取 `filePath`（`save_document` 使用 `sourceFilePath`），当路径不同于主文档时直接加载该文件、应用命令并保存，`open_document` 甚至会为不存在的路径创建空文档。

OpenDesign 采用单 Design File、多 Page 的结论，但不照抄任意 MCP `filePath` 路由。该做法把资源发现、授权和执行压缩进模型可控字符串，无法表达 Project 归属、attached root、per-run reference、Capability、Approval 或同文件 revision 冲突，也难以安全处理符号链接和路径替换。

OpenPencil 只作为历史调研与迁移记录，不是当前或目标 Agent、项目、权限或发行架构。ADR-0025 后续允许把固定上游提交作为产品行为、Pen/Path、SVG 和验收矩阵的持续参考；该参考不恢复任何 OpenPencil runtime、文档、权限、vendor 或发行边界。

## 当前实现与迁移

接受本 ADR 不表示目标能力已经完成。当前仓库已经具备 OpenDesign 文档 schema、多 Page 数据结构、单文档 `DesignTransaction`/revision、Workspace/Project/File 持久化与导航、可持久化的 Conversation descriptor、按 Conversation 隔离的会话时间线、单目标 Global Task 投影和基础 Tool Runtime 策略/审批接口。`homeProjectId` 已用于产品归档与 Main 目标校验，同一 Conversation 可在不同 run 中引用不同的已校验 Design File。Renderer 现在按 Main 已验证的 Run `documentId` 解析每个已打开 Design File 的唯一 `EditorRuntime`，而不是使用用户当前活动 tab：A 的 Run 会 retain A，用户切到 B 后 A 仍可写入和离屏截图，B 不接收 A 的 revision、selection 或生成展示，切回 A 直接读取其最新权威 snapshot。Project Design File 的人工和 Agent revision 由同一按文件串行的 autosave 协调器持久化；Agent 写工具在目标 revision flush 后才返回成功，窗口或应用退出前会 flush pending 文件，失败则保留 dirty 并报告诊断。Main 在 `before-quit` 只记录退出意图，到 `will-quit` 才销毁 Project/Agent 资源，macOS 在 Renderer 异步 flush 后恢复退出，Windows 复用同一状态机。Design File 重命名只通过稳定 Project/File ID 更新 manifest descriptor，不改变文档身份、relative path 或画布内容，并与 autosave 使用同一 Project mutation queue。独立打开的外部设计文件不被静默自动覆盖。当前每个 Agent run 仍只拥有单个 Design File/Mutation Target，尚未实现完整三集合、多 root、跨项目多目标、Main approval bridge或完整四层执行链。OpenPencil host、preload、IPC、vendor/submodule、构建入口和发行资源已经移除。

实现必须通过版本化契约和迁移逐步加入新身份与作用域字段。旧会话可以迁移到明确的默认 Workspace 和 Project，但不得把其历史路径自动转换为 attached root 或持久 Capability。

### 旧引擎迁移结果

OpenPencil host/preload/IPC、vendor/submodule、构建入口和发行资源已经删除；随后旧 Canvas2D 产品包与手写画布交互也由 ADR-0009 的 LeaferJS 路径取代。仓库不保留兼容 fallback、双写或隐藏入口。

本 ADR 中尚未实现的 attached roots、per-run references、跨项目多目标和完整四层执行链继续作为 OpenDesign 目标能力推进，但不再与旧编辑器的存在绑定。验证失败必须修复当前 OpenDesign 路径，不能恢复已移除引擎。

## 结果

### 正面结果

- 产品组织、推理上下文、写目标和权限不再混为一个“项目目录”。
- Conversation 可以保留稳定归属，同时安全处理跨目录、跨 Project 和多目标任务。
- 内置 Agent 与 MCP 共用事务和安全执行面，减少权限旁路。
- Revision 冲突为所有会话提供一致、可恢复的并发语义。
- OpenPencil 的可取模型与不可接受的路径授权方式得到明确区分，并具有可验证的退出条件。

### 代价与风险

- 需要增加 Workspace/Project 持久化、资源句柄、能力解析、多目标状态和迁移逻辑。
- 多目标操作在没有跨文件原子协议时可能部分成功，UI 和审计必须清楚呈现结果。
- Main 的可信代理职责增加，需要避免在主事件循环执行重负载，并持续测试路径竞态。
- 乐观并发可能要求 Agent 重读和重新审批，增加部分任务的交互成本。

## 验证

- Contract tests 覆盖三集合互不推导、`homeProjectId` 不授予权限，以及 per-run reference 到期失效。
- 安全测试覆盖路径穿越、符号链接替换、伪造 root handle、撤销、凭据泄漏、提示注入和裸 shell 请求。
- 并发测试覆盖不同文件并行、同文件 stale revision、跨会话重试、多目标部分失败与撤销。
- MCP contract tests 证明内外部调用进入同一 Tool Runtime 和 `DesignTransaction`，并拒绝任意本地 `filePath`。
- 仓库与发行资产审计证明旧引擎只存在于 ADR 历史说明，不存在可执行依赖、资源或可达入口。

## 复审条件

如果产品引入多人实时协作、远程 Workspace、跨文件原子事务、无本地路径的平台，或 Main 不再是本地可信代理，应复审资源身份、并发和能力承载方式。复审不得把 Project 简化为隐式权限 sandbox，也不得为 MCP 或其他 Agent 建立旁路写入。
