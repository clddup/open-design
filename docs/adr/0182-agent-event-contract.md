# ADR-0182：Agent Event 单一契约

状态：已接受

## 背景

Agent `utilityProcess` 产生的事件会依次经过 Runtime producer、Main Supervisor、AgentHost、Preload 和 Renderer。此前 `AgentEventSchema` 虽已存在，但 `isAgentEvent` 又手写校验嵌套 failure、Session history selection 与 Run failure state；`agentEventValidationError` 再次选择 union 分支并生成字符串。Supervisor 对普通事件最多完整检查两次，AgentHost 随后重新检查并重新解释；Preload 对失败事件静默丢弃。结构事实、领域规则、错误定位和失败关联因此不在同一入口，合法事件有重复开销，非法事件可能只表现为消息停止。

## 决策

- `@opendesign/agent-contracts` 的 `AgentEventContract` 唯一组合 canonical `AgentEventSchema`、discriminant 对应的真实事件分支和 Agent Event domain refinement。字段、枚举、长度、unknown key 与 union shape 只由 executable schema 定义；failure 一致性、history primary selection 和 history failure state 只由 refinement 定义。
- Contract 返回稳定的结构化 `RuntimeContractIssue { code, path, message, recovery }`。原 `isAgentEvent` 与文本解释函数仅保留为消费同一 Contract 的兼容 facade，不再复制规则。
- Agent Runtime producer 解析一次后才跨进程发送。Main `AgentSupervisor` 对每条 utility-process message 解析一次，将结果同时用于 ready/connected handshake 和 AgentHost；AgentHost 在先处理非 Agent bridge envelope 后直接消费该结果，不再重新校验。
- 非法事件只提取通过窄 identity schema 验证的 `runId/requestId`：Main 取消关联 Run，并投影一个合法、可见、可关联的 `agent.error`。Preload 也不再静默丢弃 Main 发来的非法事件，而是投影合法的 `invalid_main_event`，不透传其余不可信字段。
- 本切片不改变事件协议字段、durable journal、Timeline 顺序或 Renderer 消息模型，也不增加兼容双写。

## 验证

Agent Contract 测试覆盖 discriminated event 字段路径、failure code/message、一致的 history primary selection 和 Run failure state。Agent Runtime、Supervisor、Host 与 IPC Router 定向测试覆盖 producer 拒绝、一次解析后的 handshake、非法 Run 取消、合法错误投影和 request correlation；Agent Contracts/Desktop TypeScript、ESLint、Prettier 与 production build 覆盖跨进程入口。
