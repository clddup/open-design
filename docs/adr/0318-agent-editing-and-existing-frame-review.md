# ADR-0318：编辑与现有 Frame 审核不依赖流程许可

- 状态：Accepted
- 日期：2026-09-09
- 关联：ADR-0094、ADR-0200、ADR-0315、ADR-0316、ADR-0317
- 取代以全局串行 Plan、当前生成阶段或创建 Run 决定普通编辑与审核资格的旧策略。

## 决策

OpenDesign 的 Plan 记录真实执行，模型决定何时编辑、生成其他已声明画板、审核或结束。普通编辑继续经过作用域、权限、revision 和文档 invariant 校验，不能因为审核服务断连、审核步骤未完成或目标过去已经 verified 而拒绝插入、替换和重构。

每个 target 保留自己的实现与审核步骤；不同 target 可以分别推进；已经生成的目标各自保留原审核元数据和步骤，回头审核时不得混用另一目标的 brief、参考图或必需素材。修改已验证目标会清除旧 verified、递增 planRevision 并以稳定 ID 重开审核步骤。再次审核失败或发现截图已过期只使验证失效，不伪造材料写入 revision。Renderer 按稳定步骤 ID 投影新状态，身份不同的历史 Plan 保留原记录。

capture 支持可选的显式 target，含 inspected frameId、模型声明的 deliverable，以及可选 qualityProfile 和 referenceAttachmentIds。Main 核对真实 Frame、当前 Page/文档作用域与附件授权。普通新 Run 可以直接审核现有设计，使用真实 Conversation 用户需求与固定内置设计 skill，不要求重新生成 Plan 或改写文档。省略 target 保留当前生成目标或 Page 截图行为。

独立 Critic 返回后再从 Renderer 读取当前 revision。若已变化，返回旧截图与审核结果并明确 verified=false、要求重新检查；不得让旧结果将当前设计标为通过。Critic 不可用仍是可恢复工具失败，模型决定下一步。已通过同 revision 的历史证据不因一次服务故障被改写为设计缺陷。

生成工具重新披露可选 referenceStrategy 与标准 qualityProfile，由共享权威 Schema 派生，Main 只绑定可信身份和节点 ID。模型声明实际参考图与 UI 检查对象；未声明的安全区/交互目标是未检查，而不是通过。Critic 接收实际检查数量，显式撤下参考图后不沿用旧参考比对要求。

## 契约与兼容

新增 capture 可选字段，空输入仍兼容；使用同一 CaptureCanvasContract 产生 Provider Schema 和错误路径。复用既有质量与参考契约，没有新的意图分类器、流程服务、权限机制或自动审核重试循环。

Delivery Ledger v4 与 Agent 协议结构版本不变，放宽的是跨 target 状态组合。现有记录继续可读；旧构建可能拒绝新产生的并行进度组合，不承诺降级读取。完成 Plan 或 Run 不会替代精确 revision 的审核事实。

## 验证边界

定向回归覆盖真实 Main、Renderer 工具执行与 EditorRuntime 事务：审核故障后插入/替换及撤销、修改后复审、普通下一 Run 显式审核、审核等待期间并发编辑、参考图与质量信息传递、Plan 投影和契约一致性。图像捕获输出与模型服务使用测试替身，不宣称真实模型视觉质量或双平台产品 smoke 已通过。仅执行单 worker 相关测试、类型检查与变更文件静态检查，不运行全量测试或 Electron。

### 实际执行的验证命令

```sh
pnpm --filter @opendesign/desktop exec vitest run src/main/agent/global-task-coordinator.test.ts src/main/agent/design-plan-editing.integration.test.ts src/main/agent/explicit-canvas-review.integration.test.ts src/main/agent/design-plan-registration.test.ts src/main/agent/design-delivery-stage-projection.test.ts src/main/agent/design-plan-apply-execution.test.ts src/main/agent/design-capture-review-tool-handler.test.ts src/main/agent/explicit-canvas-review.test.ts src/main/agent/design-visual-critic.test.ts src/shared/design-generation-tool.test.ts src/shared/design-capture-tool.test.ts src/renderer/features/agent-conversation/timeline-projection.test.ts src/renderer/features/agent-conversation/timeline-plan-status.test.ts src/agent/system-prompt.test.ts --maxWorkers=1
pnpm --filter @opendesign/desktop exec vitest run src/main/agent/global-task-coordinator.test.ts src/main/agent/design-inspection.test.ts --maxWorkers=1
pnpm exec vitest run packages/workspace-contracts/src/index.test.ts packages/agent-contracts/src/design-delivery-stage.test.ts --maxWorkers=1
pnpm --filter @opendesign/desktop typecheck
pnpm --filter @opendesign/workspace-contracts typecheck
pnpm --filter @opendesign/agent-contracts typecheck
```

首组 164 项中，一项旧断言未包含新增恢复说明；同步断言后，第二组 Coordinator 与 inspection 共 46 项通过，其余首组用例已通过。Agent 相关合计 170 项不同用例通过，另有两包契约 16 项通过。变更文件运行 ESLint、Prettier 和 git diff --check。三个子 Agent 交叉审核发现的保存竞态、旧 target 步骤清理及审核元数据串用问题均已修复并补回归。
