# ADR-0002：Agent 使用 TypeScript utilityProcess

- 状态：已接受
- 日期：2026-08-07

## 背景

OpenDesign 的 Agent 需要维护会话、调用模型、加载 skills、连接 MCP、执行多步工具循环，并支持流式输出、取消和恢复。这些任务具有不确定延迟和失败模式，也会处理来自模型与扩展的不可信数据。

将 Agent 放入 Renderer 会扩大页面被攻破后的权限和数据范围，并与画布响应性竞争。将 Agent 放入 Main 会使长任务、第三方 SDK 或未处理异常影响整个应用生命周期。独立外部守护进程提供更强隔离，但增加安装、升级和跨平台通信成本。

## 决策

Agent Runtime 使用 TypeScript，并由 Electron Main 通过 `utilityProcess` 启动和监督。初始核心循环参考 Pi/OpenCode 的小内核、事件化会话、工具驱动和可扩展 provider 思路；任何代码复用都必须单独完成来源与许可证审查。ADR-0020 已将固定 `@earendil-works/pi-agent-core 0.84.1` 的 headless `Agent` 切为 utilityProcess 唯一通用循环，旧自研 turn/tool loop 已删除；OpenDesign adapter、Main 权限和 Conversation/Design 事实边界保持不变。Pi Coding Agent、TUI 和固定版本中尚未实现的 `AgentHarness` 不进入产品路径。

主进程与 Agent 使用版本化消息协议。每条消息至少包含协议版本、请求 ID、会话 ID、类型、时间/顺序信息和结构化负载；设计相关请求还包含文档 ID、基准版本与选区作用域。协议支持流式事件、取消、超时、背压、健康检查和分类错误。

Agent Runtime 可以负责：

- 会话状态、上下文裁剪和 provider adapter。
- 模型流、计划循环、工具选择和结果解释。
- Skill 清单解析与 MCP 客户端会话。
- 向主机请求受控工具执行。

Agent Runtime 不直接拥有：

- Electron `BrowserWindow`、任意 IPC 注册或应用生命周期控制。
- 原始设计引擎句柄和绕过事务的写能力。
- 无范围文件系统、shell、网络、凭据或密钥访问。
- 根据 skill 文本自行提升权限的能力。

具有副作用的工具由可信 Tool Runtime 进行 schema 校验、策略判断、用户同意、执行和审计。模型 provider 密钥通过最小化接口注入使用，不出现在 Renderer、日志、skill 或 MCP 上下文中。

## 生命周期与故障处理

Main 启动 utilityProcess，完成协议握手后才开放 Agent 功能。协议不兼容、心跳超时、内存超限或异常退出时，Main 终止失效进程，保留可恢复会话记录，并向 UI 返回明确状态。

取消从 Renderer 经 Main 传到 Agent 和当前工具。进程退出不能留下半应用设计事务；事务提交由主机和引擎适配器保证原子性。自动重启采用限次退避，避免崩溃循环。

## 结果

### 正面结果

- Agent 故障与画布、窗口生命周期隔离。
- TypeScript 生态可以复用模型、MCP、schema 和流式处理库。
- 主机保留最终权限，Agent 核心仍可独立测试。
- 进程协议为未来的远程或沙箱运行时保留替换边界。

### 代价与风险

- 需要维护进程协议、序列化、取消和会话恢复。
- `utilityProcess` 不是完整安全沙箱，仍需 OS、Electron 和应用层最小权限控制。
- 大型画布快照跨进程复制成本高，必须使用摘要、分页或明确的数据句柄。
- Agent 与工具分离后，调试需要关联跨进程事件和请求 ID。

## 验证

- 使用 contract tests 验证协议版本、未知消息、错误负载和顺序异常。
- 测试模型挂起、MCP 断开、工具超时、取消、进程崩溃和重启恢复。
- 验证 Agent 无法直接读取未授权路径、访问 Renderer 或提交未校验设计写操作。
- 对上下文大小、流式背压、内存和长会话建立基线。

## 复审条件

如果 `utilityProcess` 无法提供所需的资源约束、打包一致性或安全隔离，应评估受限子进程、独立本地服务或 OS 沙箱。替换运行载体不应改变 Agent 与 Tool Runtime 的权限契约。
