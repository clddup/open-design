# ADR-0312：已有节点可在授权页面内跨画板移动

- 状态：Accepted
- 日期：2026-09-06
- 关联：ADR-0305、ADR-0306、ADR-0311

## 决策

node entry 仅包含已有节点的 `move_element` 及这些被移动节点的属性更新时，按重新归组/移动处理，不再因为来源和目的地属于不同 Plan 目标而拒绝。

Main 复用精确 inspection、Page 绑定和结构位置处理，不推断用户文本，也不将移动记作目标创建。返回空步骤目标集合，去掉旧 steps/rebaseGuard；提交后用真实 ChangeSet 更新来源和目的画板的物理成员与材料状态，不自动完成实现步骤。

为避免移动把 Plan 根移到错误页面或不再保持 Frame，沿用 ADR-0311 的 Main 内部终态身份校验。Renderer 继续校验 Run 授权范围和完整预览，EditorRuntime 继续保证循环、引用、事务原子性与一次 undo。

`move_element` 的现有局部坐标语义不变，需要世界坐标保持的重新归组仍可使用已有 hierarchy reparent 语义；本次不在宿主默默变换模型声明的几何。

## 边界

node entry 可与现有 hierarchy/arrange entry 同笔执行，仍由整批最终预览与实际 ChangeSet 负责原子性和归属，不因 entry 数量切回另一套授权规则。node entry 内混合 insert/delete/shared-resource 时仍不作为纯移动，也不放开跨 Page 权限。无精确 inspection 的情况保持原执行路径，不新增第二套恢复门禁。

## 验证

真实 Main→Renderer→Runtime 回归：将 Profile 分组移入 Home，成员及后代只归属 Home，两个目标原 Plan 步骤状态不变，一次 undo 恢复原父级。自循环和未授权其他 Page 的目的节点均失败，原 Doc/ledger 不变。

这是一类明确操作的解除误拦，不代表全部跨目标混合编辑和删除生命周期已经完成。
