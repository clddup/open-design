# ADR-0317：模型决定回复结束，交付与审核保留独立事实

- 状态：Accepted
- 日期：2026-09-08
- 关联：ADR-0098、ADR-0310、ADR-0315、ADR-0316
- 本决策取代以未完成 Plan、未验证 target 阻止正常 Run 结束，以及据此自动续跑的旧完成策略。

## 问题

Agent 已经如实说明设计是初版并列出审核发现，宿主仍以 `home.review-refine` 未完成拒绝结束，追加强制续跑消息，最终显示 `completion_guard_blocked`。Main、Workspace 契约与自动续跑调度器又分别将回复结束等同于交付验证完成。模型无法正常报告阶段成果或局限。

## 决策

1. 内置 Agent 不注册设计完成门禁，删除该门禁及专用的工具历史反推逻辑。模型结合真实 Conversation、当前文档和工具反馈决定下一步及何时结束回复，不按回复文本增加分类或例外判断。
2. `run.completed/complete` 与 Global Task `completed` 表示本条消息执行正常结束。Main 和 Workspace 契约不再要求此时所有 target 必须 verified；不修改任何真实审核结论、revision 或未完成 Plan 步骤。Renderer 继续按账本显示实际设计状态。
3. 正常结束的 Run 不因未完成交付被自动重启。现有预算中断恢复仍有界执行；取消、Provider 错误、权限、非法输入重复熔断及事务冲突仍按原路径处理。
4. 审核发现属于模型判断的证据。提示词要求区分已提交、已验证和未解决事项，不把结束回复说成通过审核。审核服务连接失败或超时保留为可恢复的结构化工具失败，已提交设计和 capture revision 不变；删除此分支的 `runTerminal`，让模型读取故障并决定下一步，仍由既有重复失败熔断防止无进展重试。界面明确显示审核不可用及原始原因，不再映射为“正在截图”或要求用户修改请求。

## 契约与迁移

Workspace 结构版本继续为 2，Delivery Ledger 继续为 4，Agent 协议不变。本次没有新增字段或状态，只删除 Run lifecycle 与 delivery 状态之间的额外 domain 限制；现有历史记录全部可读，不重写历史错误或用户内容。新构建可以保存“Run completed、设计未 verified”的组合，旧构建曾拒绝此组合，因此不承诺旧构建降级读取新任务记录。

## 验证与范围

生产 utilityProcess 入口配置配合真实 Pi Runtime 的回归覆盖：未通过审核的初版回复正常结束、没有额外 Provider 回合或完成门禁错误、真实回复和审核事实保留、下一条消息可继续。Main 与 Workspace 契约回归覆盖正常 Run 结束后保留未完成账本。调度回归覆盖正常结束不重启，以及预算、取消和错误边界。审核服务连接失败回归覆盖 Agent 可以说明未验证结果并正常结束、未重复写入、下一条消息继续，以及真实 Main 保留 captured/reviewed/refined 状态和 UI 展示实际故障。

本次不宣称已解决所有 Plan 对编辑的限制、普通新 Run 的原目标续审、审核期间 revision 失效或生成质量语义缺口。这些是已识别的独立问题；本决策先移除截图所示的回复结束门禁。

### 实际验证

- `pnpm --filter @opendesign/desktop exec vitest run src/agent/agent-response-completion.test.ts src/main/agent/agent-run-completion.test.ts src/main/agent/agent-continuation-scheduler.test.ts src/agent/system-prompt.test.ts src/main/agent/design-generation-review-failure.test.ts src/main/agent/design-capture-review-tool-handler.test.ts src/renderer/features/agent-conversation/timeline-presentation.test.ts src/renderer/features/agent-conversation/timeline-projection.test.ts`：55 项通过。
- `pnpm --filter @opendesign/desktop exec vitest run src/main/agent/global-task-coordinator.test.ts -t 'retains the capture without claiming verification when critic is unavailable'`：3 项通过，其他用例未运行。
- `pnpm exec vitest run packages/workspace-contracts/src/index.test.ts`：12 项通过。
- `pnpm --filter @opendesign/desktop typecheck`、`pnpm --filter @opendesign/workspace-contracts typecheck`，以及本次变更文件的 ESLint、Prettier 与 `git diff --check`。

测试使用单 worker，检查串行执行；没有运行全量测试、构建或启动 Electron。没有把模拟连接故障的自动化结果当成真实 Provider 连通性或 macOS/Windows 产品验收。
