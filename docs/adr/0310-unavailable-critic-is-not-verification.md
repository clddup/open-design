# ADR-0310：审核不可用不等于审核通过

- 状态：Accepted
- 日期：2026-09-06
- 关联：ADR-0308、ADR-0309

## 决策

独立视觉审核已被请求但超时、响应不可用或缺失必要证据时，不能用几何/结构检查替代该次视觉结论并将目标标记为 verified。

- 保留真实画布、已提交 revision 和已成功的截图；记录 captureRevision，但不补 reviewRevision/verifiedRevision，不完成 review-refine 步骤。
- 已有的失败审核与 refinement 状态保持；已有 review 关联的 captureRevision 不被后续失败截图覆盖，不伪造新的 reviewRevision 来满足证据顺序。最新尝试只更新对应捕获状态，不将服务故障变成“没有缺陷”。
- 返回现有 `visual_critic_unavailable` 分类的结构化终态失败，首切片外层也原样传递该终态，不再包装成成功继续循环，结束本 Run 的重复尝试。模型不应为服务故障重画，也不应重复捕获同一画板来伪造进展。
- 此分类不再要求文档 inspection：查看文档不能修好不可用的审核服务。状态定义仍来自同一 Contract。
- 下一条用户消息仍可在同一 Conversation 中开始新的 Run；不锁定会话或撤销有效设计。

没有请求独立审核的其他既有确定性路径不在本次修改范围，用户也没有被要求增加新的审核轮次。本次删除的是错误的“失败即通过”回退。

## 验证

Main 回归证明画板保持 captured/reviewed、有效内容和截图保留、Plan review 步骤未完成。Capture handler 保留真实失败原因，Runtime 终态错误不产生第二次 Provider 回合，下一条消息可以正常完成。

自动化证明状态真实性，不证明模型审美已达标，也不替代双平台产品实测。
