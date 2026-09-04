# ADR-0265：Main 持有 Agent Plan 执行事实

## 状态

接受。

## 背景

此前 Timeline 把模型声明的 Plan 当作展示数据，再通过工具请求、进度文案、失败消息和 label 匹配猜测步骤状态。结果是 UI 可以显示某步完成，但 Main 没有对应设计 revision；也可能在前序步骤未完成时展示后续步骤执行，最终 Run 与 pending Plan 同时出现“完成”。这既不是 Codex 的显式 Plan 状态机，也不符合 Cursor 可审阅且实时反映执行进度的 Plan 体验。

## 决策

1. Main 在 Delivery Ledger 中持有唯一 `planExecution`：稳定 `planRevision`、target 顺序、稳定 `stepId`、step kind、状态和开始/完成 revision。Renderer 只投影该 ledger。
2. 全部 target 形成一条串行链，状态只允许 `pending → in_progress → completed`。completed 必须为连续前缀；只要仍有 pending，就必须恰有一个 in-progress；任何时刻最多一个 in-progress。
3. Plan 注册时 Main 激活首个实现步骤，并为每个 target 自动追加最后一个 host-owned `review-refine` 步骤。模型声明的实现步骤不得伪装为 review 门禁。
4. Apply 只能从当前 active step 开始按稳定 ID/label 顺序提交。成功 material transaction 根据 Renderer 返回的 committed step 与 revision 证据完成所覆盖的连续步骤，并激活直接后继；失败、请求事件、进度文本和无 revision 操作不能推进状态。不存在由模型单独声明步骤完成的更新工具。
5. Capture 在实现步骤未完成时返回当前真实步骤，不进入 review。`review-refine` 只能由可信 capture/review/refinement/verification 链完成；模型不能直接完成它。
6. Plan amendment 显式增加 `planRevision`，已经开始的步骤必须保留 ID、顺序、label 与 kind。verified target 的 execution 必须全部 completed。
7. Completion Guard 在任何步骤 pending/in-progress 时拒绝 Run completion。Timeline 不再读取 tool name、label、message 或 `rNNN` 文案推断状态。

## 结果

- 用户看到的勾选、进行中和待处理状态与 Main 的真实执行、revision 和交付状态一致。
- 前序未完成不能越过，Run 不能在 Plan 未完成时宣称成功。
- Provider 参数错误或事务失败只影响当前动作，不会凭消息文本错误推进步骤。

## 验证

- Contract：completed prefix、单 active、pending suffix、review 末位、稳定 target/step ID、revision 字段和 verified 一致性。
- Main：stale revision、跳步、缺少 material evidence、host-owned review、成功后激活直接后继及 amendment 保留。
- Renderer：工具 requested/progress/failed 不改变 Plan；只有最新 Main ledger 更新 UI。
- Completion：存在 pending/in-progress step 时拒绝终态。
