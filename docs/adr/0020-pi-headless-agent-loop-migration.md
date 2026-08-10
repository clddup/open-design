# ADR-0020：通过 OpenDesign 适配器迁移到 Pi Headless Agent Loop

- 状态：已接受（分阶段迁移）
- 日期：2026-08-11
- 关联：ADR-0002、ADR-0004、ADR-0006、ADR-0007、ADR-0012、ADR-0016、ADR-0018
- 固定依赖：`@earendil-works/pi-agent-core 0.84.1`

## 背景

OpenDesign 已使用 `@earendil-works/pi-ai 0.84.1` 承载 OpenAI Responses、OpenAI Chat Completions 和 Anthropic Messages 的流式协议适配。`@opendesign/agent-runtime` 从初始基线起还声明了同版本 `@earendil-works/pi-agent-core`，但生产代码没有调用它，而是自行维护模型轮次、工具循环、取消、事件、预算和上下文压缩。

自有循环已经实现 OpenDesign 特有的 Conversation journal、Main 模型代理、revision、Mutation Target、typed design tools 和 plan/review 门禁，但也重复承担了成熟 Agent 内核的通用职责。Windows 的第八个 Provider turn 上下文溢出进一步证明：通用循环、工具轮次和上下文生命周期需要可复现的成熟底座，不能继续通过零散补丁扩展。

Pi 当前把能力拆为多个包。评估依据包括 [Agent Core README](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)、[Agent Core package manifest](https://github.com/earendil-works/pi/blob/main/packages/agent/package.json)、[Compaction 说明](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)、[Coding Agent package manifest](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json) 和固定安装包的实际导出与运行行为。

## 固定版本调查

`@earendil-works/pi-agent-core 0.84.1` 使用 MIT License，要求 Node.js `>=22.19.0`，与当前运行基线兼容。该包不依赖 `@earendil-works/pi-tui` 或 `@earendil-works/pi-coding-agent`，并提供已实现的 headless `Agent`、工具循环、流式事件、取消、steering、follow-up、顺序/并行工具执行、`transformContext` 和工具前后 hook。

固定包同时导出 session、compaction 和 `AgentHarness` API。Contract spike 证明 `AgentHarness.create()` 可以构造对象，但 `AgentHarness.prompt()` 在 `0.84.1` 运行时明确抛出 `HarnessNotImplemented`。类型存在不等于功能可用；当前版本不得把 `AgentHarness`、lane 或其 durable session 描述为可用生产能力。

`@earendil-works/pi-coding-agent 0.84.1` 直接依赖 Pi TUI、内置 read/bash/edit/write 工具、cwd/session 文件、资源发现、图片 WASM 和 CLI 资源。即使 OpenDesign 不启动 TUI，该包也会引入不符合产品边界的依赖和默认假设，因此不采用该包。

## 决策

### 采用已实现的 `Agent`，不采用 Coding Agent 或未实现 Harness

OpenDesign 把固定 `pi-agent-core` 的 headless `Agent` 作为可替换的通用循环引擎。`@opendesign/agent-runtime` 通过自有 adapter 创建它，不让 Pi 类型进入 Electron 公共协议、Design Contracts、Renderer 或项目文件。

当前 adapter 强制执行以下约束：

- 工具名称必须使用 `opendesign_` 命名空间；不注册 Pi 内置 read、bash、edit、write、grep、find 或 ls。
- 所有工具强制顺序执行。一个 assistant 批次不能并行竞争同一 Design File 的 revision。
- Agent utility process 不接收 Provider API Key、OAuth token、`safeStorage` 密文或凭据解析器。
- Adapter 不启用 TUI、cwd 资源发现、全局/项目 extension、Pi settings、Pi auth、Pi session 目录、文件系统或 shell。
- Steering 和 follow-up 使用 `one-at-a-time`，避免一次注入多个排队指令改变工具目标。

固定版本的 `AgentHarness` 保持拒绝状态。后续只能在独立依赖升级中固定新版本，并用真实 `prompt → tool → compaction → recovery` contract tests 证明实现完成后再复审；不能根据类型声明或上游路线图移除拒绝门禁。

### OpenDesign 保留产品事实与权限

Pi Agent 只负责通用模型/工具轮次。以下状态和策略继续由 OpenDesign 拥有：

- Main-only Provider Catalog、`safeStorage` 凭据、网络 watchdog 和 canonical Model Gateway。
- 版本化 Agent IPC、Conversation/Run/Request/Tool Call ID 和结构化诊断。
- append-only Conversation journal、Timeline、会话排序、启动恢复和 Global Task 状态。
- Working Set、Mutation Target、Capability、Approval、Audit 和 Main 工具代理。
- `DesignDocument`、`EditorRuntime`、base revision、事务、history、undo/redo 和冲突处理。
- inspect → typed plan → write → capture → typed review → refinement → capture 完成门禁。
- 内容寻址附件、显式引用授权和 Provider 调用时的多模态解析。

`Agent.state.messages` 只是当前 utility process 中的模型执行投影，不成为第二份 durable Conversation，也不保存设计事实。Runtime 从 OpenDesign journal 恢复投影，并把 Pi 事件转换成现有版本化 journal/event 契约。

### Provider、消息和工具都经过 adapter

迁移增加四个窄 adapter：

1. Model adapter 把 OpenDesign `ModelGateway` 转成 Pi `StreamFn`，继续通过 ParentModelGateway 请求 Main。Adapter 不在 utility process 解析凭据或直接调用 Provider。
2. Message/event adapter 在 OpenDesign canonical message、Pi message 和当前 `AgentEvent 3.5` 之间转换。未知 block、超大字段和不完整 tool pair 必须显式失败，不能静默丢弃。
3. Tool adapter 把已校验的 OpenDesign tool definition 包装为 Pi `AgentTool`。实际执行仍进入当前 ToolExecutor/Main/Renderer host，Pi 不取得引擎句柄。
4. Context adapter 通过 `transformContext` 在每次 Provider call 前应用 OpenDesign token 预算、内容寻址附件和 checkpoint 投影。

Adapter 必须保持一条工具调用只有一个可信终态。工具业务失败转为 Pi error tool result 后继续模型轮次；模型桥、Agent 协议或可信 Run binding 失败仍终止当前 Run。

### 上下文和压缩分阶段迁移

生产切换前，现有持久 `context.compacted` 和 Run 内 checkpoint 继续作为权威行为基线。第一阶段把同一算法移入 Pi Agent 的 `transformContext`，保证每个 Provider call 都预算，而不改变 OpenDesign journal 格式。

Pi 导出的 compaction 纯函数可以作为后续语义 compactor provider，但不能直接接管 session。摘要必须保留 OpenDesign 的用户目标、计划、资源角色、已提交 revision、视觉审查、未完成事项和错误边界；精确节点与画面仍通过 `inspect_document`/`capture_canvas` 重新读取。任何 LLM 摘要调用继续走 Main 模型代理并纳入取消、预算、诊断和费用记录。

### 一次切换，不保留长期双循环

迁移期间生产入口继续使用当前 OpenDesign 循环，Pi adapter 只运行 contract/parity tests。满足切换门禁后，生产入口一次性切到 Pi Agent，随后删除被替代的自有 turn/tool loop、重复事件累加和重复上下文调度代码。

仓库不保留永久 feature flag、双写 session、静默 fallback 或按 Provider 选择不同循环。回滚只能回滚整个提交，不能让同一 Conversation 在两个运行时之间来回切换。

## 迁移阶段

### 阶段 0：依赖与 headless contract

- 固定 `pi-agent-core 0.84.1`，记录许可证和基线。
- 证明已实现的 `Agent` 可以执行两轮模型调用和一个显式设计工具。
- 证明 adapter 强制顺序工具、拒绝非 `opendesign_` 工具和重复注册。
- 门禁拒绝 `pi-coding-agent`、`pi-tui` 和当前未实现的 `AgentHarness`。

### 阶段 1：模型和事件 parity

- 适配 ParentModelGateway 的 streaming、reasoning、tool call、usage、identity、取消和错误。
- 在切换前对同一 mock transcript 比较旧 Runtime 与 Pi adapter 的 OpenDesign Agent events 和 journal 终态；切换后由生产 runner composition test 固化结果。
- 覆盖 OpenAI Responses、Chat Completions 和 Anthropic Messages 的 canonical 行为，不直接比较 Provider 私有 payload。

截至 2026-08-11，阶段 1 已完成 contract/parity tests。ModelGateway bridge 将 Pi user/assistant/tool-result context 转换为 OpenDesign canonical message，并把 canonical reasoning/text/tool-call stream 按相同 block 生命周期转换回 Pi event；identity、response ID、原始 stop reason、usage、取消、content filter 和失败均有明确终态。桥接器拒绝错 `attemptId`、重复/未知/未完成 block、block 类型漂移和 utility process 内的 inline image/base64，并已通过 `Pi Agent → ModelGateway → OpenDesign tool → 第二个 Provider turn` 的端到端测试。OpenAI Responses、OpenAI Chat Completions 与 Anthropic Messages 的 Pi/canonical API identity 往返均有独立覆盖。它不解析凭据，也不绕过 ParentModelGateway。

Pi run event adapter 使用唯一原子 journal writer，把 Pi model/message lifecycle 投影为当前 `AgentEvent 3.5`、`message.user`、`message.assistant` 和终态 `run.state`。切换前的双路径测试固定了成功 transcript、Provider failure 和“tool-use stop 但没有 tool call”的用户可见事件与 journal 语义；切换后 production composition test 直接比较完整 `OpenDesignPiRuntime` 和底层 adapter，旧循环与双路径测试已经删除。“tool-use stop 但没有 tool call”产生可见 `invalid_model_response`，不只留下 error 状态。

### 阶段 2：工具和完成策略 parity

- 包装十四个生产设计工具，并保留参数验证、审批、progress、revision 和附件结果。
- 覆盖可恢复 tool failure、不可恢复 bridge failure、停止、max turns、max tool calls 和 total token budget。
- 把现有 plan/review completion guard 接到 Pi turn 生命周期，不能只依赖 system prompt。

截至 2026-08-11，第一项与 `max tool calls` 已完成。一个通用 Pi tool adapter 直接复用十四个生产工具的原始标准 JSON Schema、OpenDesign 业务 validator、`ToolExecutorPort`、`ApprovalPort`、可信 Run context 和顺序执行，不为每个工具建立分支实现，也不把 TypeBox 私有标记发送给 Provider。Pi tool lifecycle 会写入现有 `tool.requested/progress/completed/failed`、approval 和 `design.revision` journal，并生成当前 `AgentEvent 3.5`；结构化结果仍按单字段/总量上限投影给模型，原始结果及内容寻址附件元数据进入 journal，inline base64 与 SVG XML 不进入 Pi transcript。测试覆盖成功的两轮工具循环、progress、revision、附件、业务 validator、审批拒绝、工具预算和非法 revision；桌面生产目录门禁证明十四个公开工具全部注册且三个 internal host 工具未暴露。迁移实现只从 `@opendesign/agent-runtime/pi-migration` 子入口导出，正式切换前不会因根 barrel 让旧生产 Agent bundle 提前包含未启用的 Pi loop。

现有 plan/review `CompletionGuardPort` 也已接到 Pi `turn_end`：无工具的候选完成在 review 决定前保持 provisional，不写 journal；拒绝时发送空 `message.completed` 清除临时内容，把可信反馈作为不持久化的内部 steering 注入同一 Run，允许后才持久化最终 assistant。拒绝上限、guard failure、max turns 与累计 total token budget 都产生明确 stop/error 状态。专项测试证明首轮拒绝后会发起第二次 Provider call，journal 只保留最终获准消息；达到上限时不会留下虚假完成。

阶段 2 已完成。用户停止或 signal abort 会把工具终态标为 `run_cancelled` 并将 Run 终结为 `cancelled`；若 Pi 因 listener、协议或 bridge 异常在 `tool_execution_end` 前进入 `agent_end`，adapter 会按工具开始顺序补齐唯一 `run_error` 终态，而不是留下 pending tool。工具终态采用“先投影、journal 成功后确认”的两阶段处理，fatal bridge/model failure 终止 Run，可恢复的 validation、approval、revision 和业务 tool failure 则作为 `tool.failed` 回到下一模型轮次。对应测试覆盖取消发生在 requested 与 execution 之间、异常 `agent_end` 的 pending tool 恢复、Provider failure 和业务失败继续。

图片附件在阶段 2 只保留内容寻址元数据和文字投影；阶段 3 已由 Context adapter 把获准附件解析为下一 Provider turn 的多模态引用，并迁移逐轮预算、压缩、journal 恢复和重启语义。

### 阶段 3：上下文、持久化和恢复 parity

- 从同一 OpenDesign journal 构建 Pi 模型投影，不创建 Pi session 文件或第二份 durable transcript。
- 覆盖历史 checkpoint、Run 内第八轮压缩、图片/文档引用、超大工具结果和预算分账。
- 覆盖应用重启、孤立 Run、pending tool、取消和 Conversation 排序恢复。

阶段 3 已完成。`prepareOpenDesignPiContext` 从唯一 journal 读取累计 `context.compacted` checkpoint 和未压缩事件，再构造可丢弃的 Pi 初始消息；`transformContext` 在每个 Provider turn 前复用现有 Model Profile/token/字符预算和 Run 内 checkpoint 算法。无法容纳固定 system/tool 协议与当前输入分别产生 `model_context_incompatible`、`context_budget_exceeded`，并在 Provider I/O 前经现有 Run event/journal 终态可见失败，不依赖抛出 `transformContext`。

附件只以经过校验的内容寻址元数据绑定到 run-local 消息对象；ModelGateway bridge 在 Main 边界前将 raster/文档投影为 `image_ref`/`document_ref`，SVG 只投影为 run-scoped handle/name/byteSize 并由 typed import tool 消费，工具原始结果继续进入 journal，Pi transcript 不持久化 inline base64 或 SVG XML。专项验证覆盖用户附件、工具返回图片、SVG 句柄、应用重建 Context adapter 后的引用恢复、原始 journal 保留和累计 checkpoint。完整生产 system prompt、十四个工具、200K Model Profile 与八轮三图 `capture_canvas` 循环已通过相同 `transformContext`，第八轮完成且 journal 保留七个原始工具结果。启动时的孤立 Run/pending tool 一次性终结和 Conversation 最近活动排序继续由唯一 SessionStore/Main 恢复链负责，Pi 不建立第二套恢复器。

### 阶段 4：生产切换与删除

- 在 macOS/Windows protected Agent build 和 packaged smoke 中运行相同 transcript。
- 将共享 Context 投影从旧 Runtime 模块抽成独立边界，切换唯一生产入口，随后删除旧通用循环和无用依赖/适配代码，不保留长期双循环或 fallback。
- 更新验证文档、包体基线、第三方清单和所有受影响 ADR。

唯一生产入口切换与删除已完成：`apps/desktop/src/agent/index.ts` 只实例化 `OpenDesignPiRuntime`，旧 `AgentRuntime` 类、执行循环及旧专属测试已删除；根 Agent Runtime 模块只保留 OpenDesign 端口契约和共享 Context 投影。生产 runner 持有 run cancellation、同 Conversation 串行、Context 准备和 Pi 生命周期组合，并从 journal 预加载历史 tool-call ID，禁止模型重放旧 ID 时二次执行。普通构建、本机 protected Vite 8 build、请求处理和生产 transcript 自动化已通过。当前阶段只剩同一 commit 的 macOS/Windows 原生 package 与 packaged Agent smoke；本地遵循不启动应用约束，没有把 protected build 冒充 packaged smoke。

## 切换门禁

生产切换必须同时证明：

- 当前 `pnpm verify` 全部通过，且 Pi parity tests 覆盖现有 Agent Runtime 的成功与失败分支。
- 完整生产 system prompt、十四个工具、200K Model Profile 和八轮多模态循环完成且不丢 journal。
- 工具批次顺序执行，同一 Design File 不出现并行 revision 写入。
- Renderer、utility process 和 Pi adapter 都无法获取原始凭据、裸文件系统或 shell。
- 图片、文档和 SVG 继续使用内容寻址引用；Pi transcript 不持久化 inline base64 或 SVG XML。
- 停止、Provider 超时、进程崩溃和协议错误都产生可见终态并解除 UI active Run。
- macOS 与 Windows 的 protected build、packaged Agent smoke 和产品级 Agent GUI smoke 使用同一 commit。

## 结果

OpenDesign 可以复用成熟、可测试的通用 Agent loop，同时保持设计平台的文档事实、权限和产品流程。迁移减少自有循环维护面，但增加一层消息、工具和事件转换；这些 adapter 是有意的架构边界，不能为了少写代码而移除。

固定版本调查也证明：第三方类型和宣传不能替代运行验证。`AgentHarness` 在未来可能减少 session/recovery 代码，但当前不可用；OpenDesign 必须继续以 contract tests 和固定版本事实决定采用范围。
