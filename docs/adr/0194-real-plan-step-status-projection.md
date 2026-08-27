# ADR-0194：当前 Plan 的真实步骤状态投影

## 状态

已接受。

## 背景

当前 Plan 已与不可变 Conversation journal 分离，并固定在 Agent 面板的任务区，但步骤只区分 pending/committed，还把 `r466` 一类内部 document revision 显示给用户。步骤完成主要依赖 label 与 revision 投影，缺少执行中和失败状态；verified target 还会按文案关键字猜测 review/refine 已完成。

这些信息既不符合用户心智，也不能解释画布为什么仍未变化。Plan 应展示可验证任务状态，而不是内部 revision、动画或由目标终态反推的假步骤。

## 决策

1. 当前运行中的 Plan 继续固定在 Conversation journal 之外的任务区；历史 Plan 留在原始消息顺序中。
2. Plan 步骤状态统一为 `pending / active / completed / failed`，右侧显示本地化产品状态，不显示 document revision。
3. active/failed 只来自同一 Run 中经过权威工具 Contract 解析的真实 semantic step input 与 tool requested/running/failed 状态；completed 只来自 Renderer 已提交 revision 后产生的 structured `committedSteps` 或对应 progress evidence。
4. progressive transaction 为每个真实 semantic step 分别返回 committed record，并在实际提交后逐项上报 progress；不按任意命令数量拆分，也不增加等待、动画或 Provider 往返。
5. 计划文案与实际 semantic label 相同的步骤原位更新；实际提交但未列入当前计划文案的步骤作为真实步骤追加到活动 target。verified target 不再按 review/refine 关键字推测某一步已完成。
6. semantic step progress 的格式化和解析由共享 `design-step-progress` 单一拥有，Timeline 与 Run experience 不再各自维护前缀或正则。

## 结果

- 用户看到的是待执行、执行中、已完成或失败，不再看到 `r466`。
- 工具失败会落到对应步骤；后续真实重试和提交会继续更新同一状态。
- Plan 不随 Conversation 消息滚走，消息列表仍保持原始顺序和内容。
- UI 状态不改变 DesignDocument、history、ledger 或工具权限，也不以动画冒充设计进展。

## 验证

- 同一合法 semantic step 的 requested、failed 与 committed progress 分别投影 active、failed 与 completed，未执行步骤保持 pending。
- active Plan 位于 journal `<ol>` 之外并默认展开；步骤区域不包含 revision 文案。
- progressive Renderer 事务继续保持单一 undo group，并为每个真实 semantic step 返回独立 committed record。
- Agent Timeline、Run experience 与 design-tool execution 定向测试通过。
