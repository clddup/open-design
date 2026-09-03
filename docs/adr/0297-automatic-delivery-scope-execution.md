# ADR-0297：交付范围建立后自动执行

- 状态：Accepted
- 日期：2026-09-03
- DesignDocument：不变
- 取代：ADR-0148 的人工范围确认、ADR-0234 的 Scope 审批

## 背景

长 brief 仍需要一份完整 Delivery Scope，避免模型只做代表页面却宣称完成；但该范围由当前用户 brief 和附件直接决定，普通情况下让用户再次点击“确认并开始”没有增加有效判断，只会延迟首个真实画布 revision，并产生一张无意义的审批卡。

Delivery Scope 是执行事实，不是权限授予。跨 Page、跨目录、外部上传、付费和高风险破坏操作已有独立 Capability/Approval 边界，不应借范围计划重复审批。

## 决策

- Main 仍按 broad/direct 策略决定是否要求 `opendesign_review_delivery_scope`，并继续校验完整 target、顺序、稳定 ID、画板尺寸和交付内容。
- Scope 工具改为 `approval: never`。合法输入由 Main 直接记录，并通过唯一 Renderer/EditorRuntime 事务一次分配全部真实 Frame。
- 用户可见 Timeline 继续显示“交付计划已建立”和真实 Plan/ledger 进度，但不显示“确认并开始 / 调整计划”或“仅本次允许”。
- 删除 Scope 的 call-scoped authorization、grant/revoke/preauthorization 和审批失败恢复路径。Scope 结构错误、revision 冲突或写入失败仍显式结束当前工具调用，不产生部分记录。
- Page 生命周期及跨 Page 写入继续使用独立 Page structure approval；本决策不扩大 Run `targetSet`、文件、目录、网络或外部服务权限。

## 后果

长任务仍多一次必要的模型 Scope 输出，但不再等待一次机械人工操作。Scope、滚动 executable Plan、Main ledger、串行步骤和完成门禁保持不变，因此自动执行不会把计划降级为装饰性展示，也不会允许模型缩减目标。

## 验证

- Delivery Scope tool catalog 不声明 approval，Main 不再保存 Scope authorization。
- 合法 Scope 直接分配全部目标并返回 `status: recorded`；失败不写入 Scope/ledger。
- Agent prompt、Completion Guard 和 Timeline 不再要求或宣称用户确认。
- Page structure approval 仍按 Run、tool call 与明确 action 生效。
