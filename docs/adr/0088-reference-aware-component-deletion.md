# ADR-0088：引用感知的 Component 删除

- 状态：已接受
- 日期：2026-08-15
- 文档协议：`DesignDocument 1.33.0`（不变）
- 关联：ADR-0045、ADR-0063、ADR-0064、ADR-0065、ADR-0067

## 背景

ADR-0045 的首版生命周期直接禁止删除 Component Main 或包含 Main 的 Page。该规则能阻止悬空 `Instance.componentId`，但没有区分实例是否也位于同一待删子树：用户删除包含 Main 与 Instance 的完整设计 Frame 时，子树内部即将一起消失的引用仍会反向阻塞父 Frame，错误要求用户逐个查找和解绑。

Figma 当前允许删除 Main，现存 Instance 继续链接到 soft-deleted Main，并可从 Instance 恢复 Main。OpenDesign `1.33.0` 只保存可从 Page 到达的节点，尚无 soft-deleted Component source/tombstone 或跨文件 Library identity；直接留下引用会破坏当前文档 invariant。不能用悬空 ID 或 Renderer 私有缓存伪装同一语义。

## 决策

### 删除先规划完整引用闭包

人工 Layer 删除与 Page 删除在提交前读取当前权威 `DesignDocument`，计算所有顶层待删 root、完整后代集合、受影响 Component Main、Component Set、Instance、Component Property 与 preferred value。`canDeleteNodes` 不再因为选择是普通 Main 就禁用删除，但仍拒绝锁定子树、Boolean 结构破坏和只删除 Component Set 单个成员等不完整操作。

Agent 对“删除当前 Page 的全部设计但保留 Page”使用 `opendesign_manage_pages action=clear`，不再用通用 apply 猜测 root 删除与 Component detach 顺序。清空当前 Run-bound Page 不扩大 Page scope；清空其他 Page 仍要求一次性 Page structure access。该操作不要求新建 Design Plan、capture 或 visual review。

待删子树内的 Main 与 Instance 属于同一删除闭包，不再互相阻塞。待删子树外仍存活且解析结果依赖这些 Main 的 Instance，会先通过 Component Service 的当前 revision 投影保真 detach/materialize 为普通 Frame；嵌套 Instance 遵循同一规则，必要时物化最外层存活 Instance。Slot 转为普通 Frame，当前 override、外观、内容和稳定顶层 node ID 保留。

删除 Component Set 时必须包含完整 Set root 与全部成员。存活 Component 上指向待删 Component/Set 的 `INSTANCE_SWAP`、`SLOT preferredValues`、property binding 和 assignment 在同一计划中确定性清理；无法解析的现有引用在 revision 前失败，不猜测视觉默认值。

### 一笔事务与底层门禁

引用物化、property 清理、`delete_component`、`delete_variant_set` 和最终 `delete_element`/`delete_page` 组成一笔有序 `DesignTransaction`，只产生一个 revision、一个 history entry 和一次 undo。命令数量仍受公共事务预算约束；任一步失败时整笔不提交。

成功的 `clear` 由 Main 标记为可信 `deliveryDisposition=superseded`：当前 Run 的 Plan state 被移除，同 Conversation/Design File 的旧未完成 Global Task delivery 被取消，completion guard 立即允许本次删除任务结束，continuation scheduler 不再恢复旧 target。`clear` 是幂等命令；Page 已为空时返回成功但不产生 revision/history，仍终结遗留 delivery。空 Page 不进入 capture，因此 `no renderable bounds` 不是需要重试或忽略的异常分支。

低层 `delete_element` 与 `delete_page` 继续拒绝直接移除仍注册的 Main。该门禁保护导入器、旧调用方和模型生成的裸事务，调用方不能绕过引用规划留下不一致文档。人工 Layer controller 与 Page planner 共用 `deletion-operations`，不在 React 组件中维护第二套组件关系。

### 与 Figma soft delete 的边界

本切片对用户可见的核心结果与 Figma 一致：删除 Main 不要求先手工删除所有 Instance，存活设计保持当前视觉且可继续编辑。当前实现通过自动 detach 保持视觉，而不是声称已经支持 Figma 的 soft-deleted Main、Restore Component 或跨文件 Library 恢复。

若后续引入可恢复 Component tombstone，必须新增正式文档协议、迁移、Component Service 解析、Assets/Inspector 恢复入口、保存重开和 Library identity；届时以新 ADR 取代自动 detach 策略，不能把不可达节点塞入 `nodesById` 或依赖 Leafer 场景缓存。

## 验证

自动化覆盖：

- Frame 内 Main 与 Instance 同子树删除；
- Main Page 删除时其他 Page 的 Instance 保真物化；
- Agent 清空当前 Page、旧 delivery supersede、completion 直接结束且不自动续跑；
- 完整 Component Set 删除与单成员删除拒绝；
- 单 revision、undo 与保存事实；
- 底层裸删除仍保持引用完整性门禁。

## 后果

- 删除完整页面或设计 Frame 不再要求用户理解内部 Component 拓扑。
- 存活对象不会持有悬空 `componentId`，代价是删除 Main 后失去后续同步关系；undo 可恢复原 Main/Instance 关系。
- Figma 的 Restore Component 仍属于明确未完成的 orphan/Library 生命周期能力，不能描述为已实现。
