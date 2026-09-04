# ADR-0297：交付范围建立后滚动执行

- 状态：Accepted
- 日期：2026-09-03
- 更新：2026-09-04
- DesignDocument：不变
- 取代：ADR-0148 的人工范围确认、ADR-0234 的预建全部空画板

## 背景

长 brief 需要完整 Delivery Scope，防止模型只做代表页面却宣称完成；但 Scope 是执行范围事实，不是设计成果或权限授予。把全部目标立即写成空 Frame 会污染画布、提前推进 revision、增加一次 Renderer 事务，并让模型在首个真实内容之前承担无价值的 existing-artboard 状态。

跨 Page、跨目录、外部上传、付费和高风险破坏操作已有独立 Capability/Approval 边界，不应借 Scope 重复审批或预建空内容。

## 决策

- Main 仍按 broad/direct 策略决定是否要求 `opendesign_review_delivery_scope`，并校验完整 target、顺序、稳定 ID、画板尺寸和交付内容。
- Scope 工具保持 `approval: never`，只记录完整目标及宿主保留的稳定 Frame ID、Page、位置和尺寸；它不调用 Renderer、不修改 DesignDocument、不产生 revision。
- 每个滚动 executable Plan 只绑定当前目标。其第一次材料事务原子创建该目标 Frame、实际 region 与有意义内容；未激活目标继续只是 reservation，不出现在画布。
- 用户可见 Timeline 显示真实 Scope 与 Plan ledger，不把 reservation、空画板或模型说明冒充设计进展。
- Page 生命周期及跨 Page 写入继续使用独立 Page structure approval；本决策不扩大 Run `targetSet`、文件、目录、网络或外部服务权限。

## 后果

长任务仍多一次必要的模型 Scope 输出，但删除一次空画板 Renderer 写入和后续 existing/create 状态切换。首个文档 revision 必须同时包含当前画板与真实可编辑内容；后续目标按 Scope 顺序滚动创建。

## 验证

- Scope 调用后文档节点和 revision 均不变化，ledger 中目标保持 `pending`。
- 24-target Scope 不在画布预建 24 个 Frame。
- 首个 first-slice 只创建当前一个 Frame 与真实内容，其他 reservation 不进入文档。
- continuation 保留 Scope reservation；完成、取消和失败仍按 Run 生命周期清理内存状态。
- Page structure approval 仍按 Run、tool call 与明确 action 生效。
