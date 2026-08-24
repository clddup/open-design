# ADR-0122：首个真实画面优先于协议回抄

- 状态：Accepted
- 部分取代：ADR-0147 已恢复同一次 first-slice 调用中的模型视觉方向，并停止由宿主从已画元素反推理由；本 ADR 的 host-state 路由、首个真实 revision 优先和不恢复 Plan-only 往返继续有效
- 日期：2026-08-21
- DesignDocument：不变
- Design Plan / delivery ledger：内部契约不变
- 模型首切片输入：减少必填规划元数据，Main 继续编译为同一权威 Plan 与事务
- 关联：ADR-0050、ADR-0080、ADR-0095、ADR-0102、ADR-0121

## 背景

真实四目标 Logo Run `run_1787296054202_1` 在约 38 分钟后由用户取消。Provider 共 23 次请求、累计约 1,951 秒；Renderer 29 次工作累计约 13.6 秒。`T_plan=152 秒 / T1=328 秒 / firstReviewed=873 秒`，第一个目标最终仍停在 `refined`，其余三个只有 allocated Frame。

该请求是新建四个真实画板，但正文中的“选择最强方向继续完成”命中了通用的“继续”负向关键词，因此没有进入 compact first-slice，而是退回完整 `define plan → apply → capture → inspect/recover` 链路。完整 Plan 又要求模型在任何像素出现前回抄 design intent、brief fidelity、visual system、每个 target 的布局说明、quality profile 与组件判断。独立 Critic 在快速 Run 的精修后仍可反复返回主观失败，使 target 长期停在 refined。

这些约束混合了三类不同责任：文档安全与 revision 正确性、首个可用画面、最终审美建议。把三者全部设为同步阻塞门，会让协议越来越完整而产品越来越不可用。

## 决策

### 主机状态优先于提示词关键词

当 Main 已提供 exact-revision inspection，当前 Page 没有材料内容，且请求具有创建意图时，正文中的“继续、调整、优化、refine”等后续阶段用语不再把 Run 路由到既有设计修改流程。Conversation continuation、附件、选区、Page lifecycle 和真实已有材料仍保持通用入口。

Main 以 inspection 中的空白 Page 事实消除长 brief 的词义歧义，并将这类 Page 创建请求稳定路由到只包含 `opendesign_generate_first_slice + inspect(recovery)` 的 new-design surface。`define_design_plan + apply_transaction` 留给 existing-artboard、Plan amendment、必须先读取材料或 compact schema 无法表达的操作。关键路径不再要求一个关键词分类器必须完美理解长提示词。

### 首轮只要求真实执行所需事实

first-slice 模型输入继续要求：deliverable、objective、目标稳定 ID/Page/Frame/region、第一目标的真实可编辑元素与语义步骤。以下重复性规划字段不再进入首轮 Provider schema：

- design intent 与 anti-pattern prose；
- brief fidelity 数组；
- visual system prose；
- raster roles 的空声明；
- target objective/layout/spacing/quality profile。

可信宿主从模型的当前 objective、target、region 和实际首切片颜色/字体/几何生成保守的内部默认值，再编译为现有唯一 Design Plan、allocation 和 canonical transaction。完整用户请求仍直接进入独立 Critic，不依赖这些默认摘要替代原文。首个真实 commit 后，模型可以通过完整 Plan amendment 声明特殊 safe area、素材证据、保留语义或视觉命题。

稳定 ID、parent-local geometry、先父后子、真实非容器内容、Page/Frame 作用域、revision、capability、事务 invariant 与确定性布局错误仍然失败关闭。收缩的是重复 prose，不是文档安全边界。

### 快速模式的主观质量循环有界

快速模式保持两条路径：

1. 首个 clean capture 的独立 Critic 通过，直接 verified；
2. Critic 未通过，执行一次聚焦 refinement。第二个 exact-revision capture 在确定性布局、结构与组件检查通过后 verified；仍未通过的主观 Critic 项以 `qualityAdvisory` 返回，不再驱动无限 refinement。

精细模式继续要求最终 Critic 通过。两种模式都不会放过越界、无效节点、错误 Page/Frame、stale revision 或未提交写入，也不会把 allocated 空画板当成完成。

## 用户可见行为

- 新建长 brief 首轮应直接产生真实 Frame 和首个可编辑内容，不先展示数分钟 Plan prose。
- Timeline 继续只把真实 committed semantic steps 当设计过程。现有 Renderer 已默认隐藏可恢复 schema/stale/guard 重试，因此本切片不新增另一套错误展示补丁。
- 快速模式最多经历一次主观精修；剩余建议不冒充阻塞错误。多目标请求仍继续处理未完成目标，不能把第一个画面宣称为整套完成。

## 后果与边界

- first-slice Provider schema 仍描述可选高级字段，输入 token 成本不会按同等比例下降；主要收益来自模型不再生成重复字段，以及避免一次 Plan-only Provider turn。
- 宿主默认 planning prose 只用于内部兼容与保守门禁，不代表高质量设计判断；像素质量仍由用户原文、内置 skill、真实 capture 和 Critic 判断。
- 本改动不证明 `T1<=60 秒` 已达成。需要在新构建上重放 `OD-MARK-01` 与 1/4/12 target 样本，并以真实打包产品诊断验收。
- 有附件或 existing-artboard 的请求仍可能需要完整 Plan/inspect；后续若这些路径继续成为主要瓶颈，应设计对应的直接事务入口，而不是扩大关键词列表。

## 验证

- 路由测试覆盖空白 Page 的长创建 brief 含“继续/调整”仍进入 new-design，以及已有材料的真实续改仍进入 general。
- first-slice 测试覆盖省略普通 planning metadata 后由 Main 归一化，并继续生成合法 Plan 与 canonical apply。
- Coordinator 测试覆盖快速首稿通过直接完成、快速首稿失败后一次 refinement、第二次主观 Critic 仍失败时以 advisory 完成。
- Agent Runtime 与 Desktop 分别通过受影响 typecheck；相关工具披露、系统提示、首切片和 Coordinator 专项测试通过。
