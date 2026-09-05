# ADR-0305：独立节点编辑不作为计划画板创建

- 状态：Accepted
- 日期：2026-09-06
- 关联：ADR-0302、ADR-0304

## 问题

同一 Run 已登记 Plan 时，统一编辑工具的普通 node entry 使用计划创建校验。修改其他已存在画板的透明度也会因不属于 Plan 返回 `target_stale`。Plan 只能记录交付，不应成为已有设计的所有权边界。

## 本次实现

统一编辑工具收到单独一个 node entry 时，Main 用当前 revision 的真实 inspection 判断整批命令是否与 Plan 无直接或间接关系。该查询不是输入结构校验，也不读取用户文字猜意图：

- Plan 根、后代、祖先与预留 ID 都属于相关范围。
- 共享 Component Main 及其祖先/后代不走独立免记账路径；节点自身与祖先链都参与判断，避免漏掉共同布局容器的影响。
- 移动检查来源节点和目的容器；替换检查根、替代节点及其父子引用。明确局部操作之外的共享定义、未知引用、不完整 inspection 回原路径。
- inspection 不存在或过期时也回原路径，不给原本可执行的 Plan 内编辑新增检查门禁。

已证明独立的整批节点编辑复用现有 Page 绑定、结构绑定、namespace 校验、Renderer mutation target 与 EditorRuntime 原子事务。Main 不注入 Plan steps，不发送 rebase guard，成功后不推进或污染当前 Plan ledger。过期 revision 仍拒绝；用户可以正常 undo。

本次不增加公开工具、输入字段、模型回合或错误类型，不以 Normalizer 修补任意非法模型输入。First-slice 仍使用其原有计划创建路径。

## 明确未完成

混合 node/hierarchy/arrange 批次、跨计划画板移动、删除 Plan 根及共享资源的精确影响归属仍需后续统一处理。本次只打通能证明独立的完整 node entry，不宣称所有历史设计编辑限制都已消除。全局资源或未知影响不被当成“Plan 外节点”放行。

## 验证

Main → 编辑工具 → Renderer → EditorRuntime 回归：旧画板透明度实际改变、当前 Plan ledger 不变、旧 steps 不进入工具响应、stale revision 拒绝、一次 undo 恢复原值。域查询覆盖两端移动、共同祖先、逻辑 region、组件、替换后代与共享定义；原有 Plan 和 first-slice 测试继续执行。
