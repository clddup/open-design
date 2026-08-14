# ADR-0065：Component Set 成员生命周期 v2

- 状态：已接受
- 日期：2026-08-14
- 文档协议：`DesignDocument 1.22.0`（不变）
- 关联：ADR-0045、ADR-0063、ADR-0064

## 背景

ADR-0064 建立了真实 Component Set Frame、VARIANT 组合与 Instance 解析，但只能一次性 Combine。继续用通用 duplicate、reparent 或 delete 修改成员会破坏 Set invariant、default、property options 和 Instance assignment，因此成员生命周期必须是 Set 级事务，而不是 Renderer 特判。

## 决策

### 复用现有协议

成员加入、复制、移出和 Set 解散只组合既有事务操作，没有新增持久字段或操作类型，`DesignDocument` 保持 `1.22.0`。

`planAddComponentToVariantSet`、`planDuplicateVariant`、`planRemoveVariantFromSet` 与 `planDissolveVariantSet` 是唯一成员写入口。每个 planner 校验当前 Page、稳定 Set/Component/root 映射、锁定、完整 property collection、唯一组合、可逆 transform 和命令预算，并生成一个原子事务、一个 revision 和一个 undo entry。

### 几何、default 与 options

加入现有 Component 时，宿主把它的 world transform 换算到 Set local space，再以成员真实 bounds 和 authoring padding 重算 Set Frame。Set root 与全部成员在同一事务中反向重基准，因此 world geometry 不变。复制 Variant 由宿主深复制 Main subtree、生成稳定派生 layer IDs，并放到现有矩阵右侧；模型不生成内部逐层复制命令。

移出与解散先把成员 world transform 换算回 Set parent，再改变层级。每次成员变化都从最终成员 local transform 重新选择 top-left default，并从实际成员值重建 VARIANT options 与 default value。Set 永不为空；移出最后一个成员等价于解散。

### Instance 与引用迁移

成员移出前先用 Component Service v2 解析每个受影响 Instance 的当前有效成员。若当前视觉成员被移出，Instance 改为直接引用该 Component，并删除该 Set 的 VARIANT assignments；若初始成员被移出但当前解析成员仍留在 Set，则初始 `componentId` 改为当前成员。解散时所有相关 Instance 固化到当前解析成员并清理 Set assignments。

解散同时从所有 INSTANCE_SWAP preferred values 中移除该 Set，再清除成员 membership，删除 definition 和空 root。任何 Instance 预先无法解析时整个 planner 失败，不以默认成员掩盖损坏状态。

### 人工与 Agent 共用入口

Inspector 在 Set root 提供 Add variant 与 Dissolve，在成员 Main 提供 Duplicate variant 与 Remove from set；多选一个 Set root 和一个普通 Component 提供 Add to component set。`Cmd/Ctrl+D` 对 Set root 或成员调用同一 Duplicate Variant planner。

`opendesign_manage_components` 增加 `add-component-to-variant-set`、`duplicate-variant`、`remove-variant` 与 `dissolve-variant-set`。Agent 必须提交 inspection 中的 Set、Component 与 root IDs，以及新增成员的完整唯一 property map；Renderer 再验证稳定映射。人工和 Agent 不各自维护成员逻辑。

## 失败与恢复

- Set/root/member 过期、跨 Page、锁定、组合重复、属性不完整、transform 不可逆或命令超预算，在 revision 前失败。
- Auto Layout parent 下解散因无法保证 world geometry 而明确拒绝。
- preview 或 apply 失败时文档、selection、history 和持久化事实均不改变。
- 通用 duplicate/delete/reparent 仍受同一文档 invariant 约束，不能绕过 Set planner。

## 验证

自动化覆盖加入时 world transform、复制 subtree 与唯一组合、default/options 重算、成员移出后的 Instance 固化、解散、单 revision、undo/redo、typed Agent 输入、稳定 root 映射和人工 Inspector 入口。

## 后果

Component Set 从一次性 Combine 升级为可维护对象，且没有新增 schema 分支或 Figma 专用运行时。Canvas、Assets、SVG/位图和持久化继续消费同一 Component Service 解析结果。二维 property matrix editor、画布拖拽重排、Slot 与跨文件 Library 仍是后续独立切片。
