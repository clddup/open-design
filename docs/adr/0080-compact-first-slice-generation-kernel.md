# ADR-0080：空白画布的紧凑首切片生成内核

- 状态：Accepted
- 日期：2026-08-15
- Agent 协议：不变（模型工具 surface 为 Runtime 内部披露策略）
- 文档协议：不变（继续使用 `DesignDocument 1.30.0`）
- 取代：ADR-0078 对高置信空白画布新建设计的六工具首轮；其他请求继续使用 ADR-0078/general surface
- 关联：ADR-0050、ADR-0072、ADR-0073、ADR-0075、ADR-0078
- 参考：OpenPencil 固定提交 `449f31dd8b7df12965f65d9da774597332fc153d` 的 compact planner → host scaffold → subtask generation → single-writer atomic replay

## 背景

生产 journal 已证明 Provider 串行回合远慢于 Renderer apply。ADR-0075/0078 删除了独立 inspection 与 Plan 后固定往返，但 host-inspected 首轮仍向模型同时解释 inspection、Plan、图片读取、Page 授权/lifecycle 和基础 apply；通用 system prompt 还包含首切片不需要的完整专业能力规则。自动化测得该首轮六工具模型面约 `22,912` 字符，通用 system prompt 约 `50,343` 字符，不含实际 inspection 与用户请求。

OpenPencil 的固定源码没有在规划回合暴露等价的通用 typed-tool catalog。其 `LlmClient::CallRequest` 只有 system/user prompt、model/provider 和 timeout；planner 返回紧凑 JSON，宿主立即建立真实 scaffold，随后按 section/screen 生成节点程序。不同 screen group 的模型调用可以并发，但每个成功 buffer 仍由一个真实文档 writer 原子 replay。有效原则是专用短协议、宿主确定性工作和隔离生成，不是取消事务或把半截模型输出直接写进文档。

## 决策

### 保守选择专用 model surface

Runtime 只在以下条件全部成立时选择 `new-design` surface：Main 已提供 exact-revision inspection；请求不是 continuation；没有附件或选区；Mutation Target 是 Page；用户明确要求创建；没有编辑、读取、导出、Page lifecycle 等歧义意图；目标 Page 为空或仅含一个空 starter Frame/Group。其他情况保持 `general`，不隐藏图片、授权、Page 或专业编辑能力。

该 surface 首轮只暴露：

1. `opendesign_generate_first_slice`；
2. `opendesign_inspect_document`，仅用于 stale/conflict/失败恢复。

它使用独立约 4.5 KB system prompt并强制 `thinkingLevel: off`。当前两工具定义约 12 KB，固定协议合计约 16.5 KB；相对旧约 73 KB 降低约 77%。这些是静态字节事实，不冒充真实 Provider `T1` 样本。

### 一个模型调用编译为既有 Plan 与事务

`opendesign_generate_first_slice` 输入同时声明：

- 用户要求的全部 target 与稳定 Page/Frame/region ID；
- 紧凑 visual system、raster role 和 component/ordinary 决策；
- 第一 target 的少量真实 semantic stages；
- Group/Frame/Rectangle/Ellipse/Text 基础元素及显式字体 face identity。

Main 将其编译为既有 `DesignPlan v4` 和 canonical `DesignApplyToolInput`。模型不提供 `baseRevision`，不接触 Renderer/Leafer 对象，也不建立第二份文档或 executor。

### 分配与首切片共用一个 rollback-safe history group

Main 注册 Plan 后生成全部真实 artboard allocation commands，并在不提前修改 ledger 的前提下验证第一 target 的材料写入。allocation stage 与模型 semantic stages 合并为一次内部 apply；Renderer 使用既有 progressive semantic transaction，每个真实 stage 产生 revision，全部 stage 共享一个 history group和一次用户 undo。后续 stage 失败或取消时，Runtime 回滚该 group，文档内容恢复到调用前状态；回滚本身可以推进权威 revision，因此恢复必须继续以 inspect 结果为准，不能假设 revision 未变化。

成功后 Main 从 `committedSteps` 读取真实 allocation revision，先把所有 target 记为 `allocated`，再把第一 target 记为 `drafted`。空 Frame 仍不能 capture/review/verified。工具结果返回完整 Plan、allocation、first-slice、delivery 和最终 revision；模型下一轮自动切回 general expanded professional tools，紧凑工具消失。

## 后果与限制

- 用户在一个 Provider 回合后即可看到全部真实画板根和第一段真实可编辑内容；Timeline/cursor/reveal 只消费已提交 semantic revision，不播放假拖拽。
- 附件、必须先看的图片、已有画布修改、continuation、选区命令、Page lifecycle 和歧义请求不走快路径，避免用速度优化绕过权限或上下文依赖。
- 第一切片只使用基础元素；图片、矢量、组件实例化、布局、capture/review/refinement 等在成功后由完整工具继续完成。当前模型输入已由 ADR-0096 增加 target quality profile 并编译为 Plan v6；本 ADR 的 v4 与静态协议字节数保留为当时历史基线，不代表当前模型 surface 大小。
- 为把首次真实 revision 放在整页完整度之前，首切片固定为第一 target 的一个 planned region、1–3 个真实语义 stage、最多 24 个基础元素；其余 region 在成功切回完整工具后继续生成。这个上限约束 Provider 首次结构化输出，不改变全部 target 的稳定 Frame 分配、Plan v4、history group 或 ledger 语义。该历史容量值后由 ADR-0103 基于生产 25 元素登录页样本调整为合计 32；本 ADR 的 kernel、事务与 ledger 决策不变。
- 多 screen/target Provider 并行和 OpenPencil 式隔离 worker buffer 尚未实现。只有打包产品 `1/4/12` target 数据证明 `T_all` 仍主要受独立 target Provider 回合影响后，才评估“不同 artboard 并发生成、单 writer replay”；同一 Design File 仍不得并发写。
- 真实收益仍需 macOS/Windows 打包产品分别对 Codex/Grok/GLM 记录 `T_plan/T0/T1/T2/T_all`。静态协议降幅和自动化调用图不能替代该证据。

## 验证

- surface 分类覆盖空 Page、空 starter、附件、selection、continuation、已有内容和 Page intent；
- 首轮 catalog 断言仅含 first-slice 与 recovery inspection，成功材料 revision 后恢复 general expanded 工具；
- compact 输入覆盖唯一 ID、parent-first、第一 target、真实 region/material、字体和 canonical Plan/apply 编译；
- Main handler 覆盖 allocation-first committed revision、delivery 顺序和失败时不推进 ledger；
- completion guard 接受 Main 初始 inspection + composite plan/write，但仍强制 capture → review → refinement → final capture；
- 受影响包 typecheck、专项 Vitest 和固定协议字符预算作为仓库证据。
