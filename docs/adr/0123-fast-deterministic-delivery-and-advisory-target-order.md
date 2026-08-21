# ADR-0123：快速确定性交付与非阻断 target 顺序

- 状态：Accepted
- 日期：2026-08-21
- DesignDocument / transaction / revision：不变
- Design Plan / delivery ledger：状态字段不变，`activeTargetId` 从写入门禁降为捕获与展示调度提示
- 关联：ADR-0050、ADR-0095、ADR-0117、ADR-0121、ADR-0122

## 背景

生产诊断 `run_1787296054202_1` 运行约 38 分钟后被用户取消。23 次 Provider 请求累计约 1,951 秒，而 29 次 Renderer 工作累计约 13.6 秒。运行中的 `active_target_required`、stale target 和 checkpoint schema 拒绝没有保护新的权限或文档不变量，却让 Agent 再次请求 Provider。每个 target 的同步独立 Critic 又把快速模式变成多轮串行审查。

首 target 优先是体验调度目标，不应被实现成“任何其他已声明 Frame 的合法写入都失败”。独立 Critic 是有价值的主观质量工具，也不应与作用域、revision、结构和确定性布局检查混成同一安全门禁。

## 决策

### `activeTargetId` 只负责顺序提示

Main 仍先分配全部真实稳定 Frame roots，Timeline 与 capture 默认指向第一个未完成 target，首切片仍只在第一 target 提交有意义内容。

首个真实 revision 出现后，一笔 `DesignTransaction` 可以覆盖多个已声明 delivery artboard，只要每条命令都能解析到其稳定 Frame、使用当前 revision 且不越过 Run 的 Design File/Page 能力边界。单条 move/reparent/组合操作仍不得跨 artboard，Page-root 散落、未知节点、stale revision、重复 ID 与事务 invariant 仍失败关闭。

因此 `activeTargetId` 不再拒绝写入其他已声明 target。它只决定默认捕获目标、恢复顺序和用户界面焦点。模型已经知道多个 target 的完整操作时，应在一次 apply 中用真实 semantic steps 批量提交，不为账本顺序制造 Provider 往返。

### 快速模式不调用独立 Provider Critic

Composer 的快速模式同时关闭当前 Run 的扩展 reasoning。模型目录中选择的 reasoning 偏好继续保留给精细模式，但不能让 `high` 偏好把“快速”路径重新变成长时间思考。快速模式仍使用同一个 Provider 和模型；它缩短的是编排与推理深度，不改变 Run scope、工具权限、事务校验或用户要求的交付物。

快速模式的 target 在材料 revision 后必须完成一次真实 exact-revision Frame capture。Main 同步执行：

1. capture revision 一致性；
2. 确定性 layout quality；
3. exact-revision document inspection；
4. Frame/region/material/component structure 检查。

全部通过即把该 target 标为 verified。`reviewRevision` 记录本次可信宿主确定性 review 的 revision，不表示发生了 LLM Critic 请求。布局错误仍要求真实修复和再次 capture；组件策略建议保持非阻断。

精细模式继续运行无作者上下文的独立 Critic，并根据其截图证据完成 refinement 与 final capture。用户通过 Composer 的快速/精细选择决定是否支付这部分时间和质量成本。

### 新建交付与现有编辑按宿主事实路由

没有附件、选区或 continuation 的 Page 级创建请求，可以在已有内容旁分配隔离的新 artboard，因此使用紧凑首切片 surface。长 brief 中描述后续阶段的“继续完成”“调整小尺寸”等词，不再单独把请求降级为完整现有文档编辑链。

只有请求明确把修改动作指向“当前、现有、选中、之前”的对象，或宿主存在选区、附件、continuation、Page lifecycle 等事实时，首轮才进入 general surface。该路由只缩小模型可见编排面；Main 对重叠 artboard、稳定 ID、revision、权限与事务 invariant 的校验保持不变。

### Completion 与失败恢复

completion guard 仍要求请求中的每个 target 有材料并达到 verified，不能用文字把 allocated 空 Frame 冒充完成。快速模式不再因为缺少 Critic 或虚构 refinement 被自动续跑。

合法的跨 target 写入不再产生 recovery error。真正的 schema、revision、层级、作用域与布局失败仍返回结构化诊断；已提交 revision 保留且可撤销。

## 后果

- 快速模式每个 target 至少减少一次独立 Critic Provider 请求，并消除 Critic 失败驱动的 refinement 往返。
- 快速模式不再继承模型选择器中的高 reasoning 等待；需要长思考时由用户显式选择精细模式。
- 多阶段创建 brief 在非空 Page 上仍能先走紧凑首切片，不因描述后续步骤的普通动词误入完整工具面。
- 多 target 已知操作可以一次生成、连续提交，首 target 优先不再以错误重试为代价。
- 快速模式不承诺模型主观审美达到精细模式阈值；它承诺真实、结构有效、布局确定性 clean 且及时可见。需要截图审美审查时选择精细模式。
- 本决策取代 ADR-0050 中“材料工具只写 active target”及 ADR-0117/0121 中“快速模式也必须同步通过独立 Critic”的部分；其他事务、权限、revision 和确定性质量边界继续有效。

## 验证

- Coordinator 测试覆盖快速 capture 在不创建 Critic context 的情况下直接确定性 verified。
- 多 target 测试覆盖同一 apply 可授权多个已声明 artboard，而跨 artboard move/reparent 仍拒绝。
- 系统提示和工具描述明确首 target 是优先级、不是写入禁令，并区分快速确定性验证与精细 Critic。
