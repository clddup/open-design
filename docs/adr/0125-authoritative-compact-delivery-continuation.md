# ADR-0125：权威 compact brief 与无重规划 continuation

> 部分决策已由 ADR-0301 取代：不再物化或校验自动生成的 monochrome/32/24/16 evidence nodes。

- 状态：Accepted
- 日期：2026-08-21
- DesignDocument / transaction / revision：不变
- Design Plan：仍为唯一内部交付契约；compact 首切片由 Main 绑定完整 Run brief
- 模型工具阶段：新增 first-slice continuation 披露阶段
- 关联：ADR-0018、ADR-0050、ADR-0095、ADR-0120、ADR-0121、ADR-0122、ADR-0123

## 背景

生产 Run `run_1787305993375_1` 已命中 ADR-0122 的 compact first-slice，但仍在约 7 分 8 秒后失败。四次主要 Provider 等待约为 76、74、109 与 117 秒；真实首切片事务和 capture 只占约 1.5 秒。首切片成功创建四个真实 Frame，却只完成一个 Logo 方向，并被快速确定性门禁标为整个 Concept Exploration 已 verified。随后模型 inspect 并两次生成 11–13 KB 的完整 Plan，最终因相同 Logo evidence ID 同时承担 monochrome 与 32 px 角色而连续 schema 失败。

根因不是单个字段：compact Plan 的 `briefFidelity` 来自模型缩写的 objective，而非 Run 原始请求；Provider schema 隐藏了已有的 Logo exploration 契约；首切片只允许一个 materialized region；任意首个 material revision 后又重新暴露 full Plan。ADR-0122 的“首个像素优先”因此只缩短了入口，没有形成可持续的完成路径。

## 决策

### Main 绑定完整 Run brief

`GlobalTaskCoordinator` 持有的原始 Run prompt 是 compact Plan brief fidelity 的权威来源。模型 objective 继续用于短标签和视觉概括，但不得覆盖、缩窄或替代用户的完整交付要求。Main 将原始 prompt 按有界 500 字符片段写入现有 `briefFidelity.requiredContent`；模型不可通过隐藏字段回写另一份 brief。

该绑定不授予新权限，也不改变 Conversation、Run targetSet、Page、Frame、revision 或事务边界。完整 brief 保留在可信 Plan 与 journal；返回模型的 first-slice 结果只包含 continuation 所需的 target、Frame、region、Logo evidence、ledger、revision、capture 和 semantic-step 摘要，不重复发送完整文档 diff、visual-system prose 或 brief 数组。

### Compact Logo exploration 进入首轮契约

Provider 首切片 schema 公开已有的 `logoOutputs` 与 compact `logoExploration`。用户明确请求多方向 Logo exploration 时，模型必须在首轮声明：

- 恰好三个不同 generative principles；
- 三个稳定 concept root；
- 每个方向独立的 monochrome master 与 32/24/16 px evidence IDs；
- 第一 target 的完整 concept region 集合。

Main 从原始 prompt 识别明确的“三个/three directions/concepts”要求。缺少 exploration 时，在任何 allocation 或 material revision 前返回可恢复的 `design_workflow.logo_exploration_required`，要求修正同一个 compact call；不要求 inspect，不允许先画一个方向再冒充完整 exploration。

首切片现在可在 1–3 个真实语义阶段内 materialize 一个或多个已声明 region，总元素预算仍为 32。若未能一次完成所有 region，capture 的既有结构门禁保持 target 为 drafted，并精确指出缺失 region/evidence；已提交内容保留，模型直接继续该 target。

`monochromeNodeId` 可以合法复用同一方向的 32 px evidence node。跨方向 evidence、concept/root 身份和三个 ordered size nodes 仍必须稳定且无冲突。

### 成功首切片后不再暴露 full Plan

new-design surface 的 first-slice 成功产生 revision 后进入 continuation 工具阶段。该阶段使用已注册 Plan，并从模型工具目录移除 `opendesign_define_design_plan`；模型直接使用 apply/checkpoint、capture、inspect recovery 和所需专业材料工具完成未完成 target。普通 existing-design Run、附件/授权依赖、真实恢复和后续用户修改仍走 general Plan 路径。

系统提示明确：first-slice 返回的 Plan、稳定 IDs、ledger、revision 和 capture 是继续执行所需上下文。没有具体 recovery 证据时，不得再次 inspect 或重述完整 Plan。

## 用户可见行为

- 多目标任务仍先一次创建所有真实 Frame roots。
- 多方向 Logo 首个画板可以在一个 compact call 中连续出现多个真实方向；超过预算时，后续直接补齐，不回到几分钟的 Plan prose。
- 一个方向、一个 clean layout 不再能被当成明确要求的三方向 exploration 完成。
- Timeline 继续只消费真实 committed semantic revisions；模型文字和内部 Plan 不成为设计进度。

## 后果与边界

- Provider 首轮 schema 增加了 Logo 专用的少量可选字段，但删除了成功后第二份完整 Plan 的正常路径；对多方向 Logo，这些字段是完成门禁所需事实，不是展示性 prose。
- 快速模式仍不运行独立 Provider Critic。它现在能证明完整声明的结构和 Logo optical evidence 存在，不能证明主观审美优秀；固定盲评与打包产品性能样本仍保持开放。
- 自然语言 brief 的任意语义覆盖尚不能完全由确定性代码证明。当前 Main 对明确多方向 Logo 要求执行强门禁，其他 deliverable 继续依赖完整 target/region 声明、brief fidelity、结构检查和精细模式 Critic。

## 验证

- compact schema 测试覆盖 Logo exploration/outputs 可见、多个 planned region 同轮 materialize、32 元素总预算不变。
- Main 测试覆盖完整 Run prompt 覆盖模型缩写 brief，以及明确三方向 Logo 缺少 exploration 时零 revision 失败。
- Logo Plan/inspection 测试覆盖 monochrome 与 32 px 合法复用，同时缺失任一方向或 optical evidence 阻止 verification。
- Agent Runtime 测试覆盖 first-slice 成功后进入 continuation 且不再披露 full Plan，并将 first-slice 结果压缩为稳定 continuation 摘要。
