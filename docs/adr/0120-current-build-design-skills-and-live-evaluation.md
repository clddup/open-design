# ADR-0120：当前构建内置设计 Skill 与真实样张评测

- 状态：Accepted
- 日期：2026-08-21
- DesignDocument：不变
- Agent/Design Plan：移除内置 skill 的功能版本与手工内容哈希，仅保留宿主绑定的稳定 ID
- 关联：ADR-0098、ADR-0102、ADR-0104、ADR-0117、ADR-0118、ADR-0119

## 背景

内置设计 skill 与应用源码一起构建，不是独立发布的扩展。旧实现仍为每个 skill 手工维护 `version` 和 SHA-256，并把 `{id, version, hash}` 写入 Plan、Review 与恢复状态。修改一行设计规则就需要同步更新注册表哈希，否则测试会因内容漂移失败。

OpenDesign 尚未正式发布，也不需要兼容旧实验 skill 引用。Git 提交和应用构建已经确定内置资源内容，额外的功能版本与手工哈希没有提供独立事实，反而制造维护失败。文件附件、设计资产和评测产物的内容寻址摘要属于文件完整性边界，不属于该问题。

视觉质量评测也需要区分固定输入和真实结果。静态 fixture 可以证明文档、渲染与事务重放，但不能证明模型能在打包产品中快速生成高质量 UI 或 Logo。

## 决策

### 内置 skill 使用当前构建内容

`@opendesign/design-skills` 只为每个内置 skill 定义稳定 ID、适用 deliverable、phase 和内容。Main 根据 deliverable 绑定当前构建中的适用 ID，并把 ID 写入 Plan、Review 与恢复状态；模型不提交这些字段。

内置 skill 不维护独立功能版本、手工内容哈希或迁移分支。应用更新后，未完成任务使用当前构建内容继续执行。未知、缺失、重复或顺序错误的 skill ID 仍失败关闭，避免模型或持久状态选择未注册方法包。

用户附件、DesignAsset、最终 `.opendesign` 和 capture 文件继续使用内容摘要验证实际字节。该摘要由宿主从文件生成，不要求开发者在修改规则时同步登记，也不表达功能版本。

### 固定 UI 与 Logo 真实评测

仓库提供固定场景：

- `OD-UI-01` 检查专业桌面工作台的信息层级、密度、状态、组件系统、模板规避和工艺精度。
- `OD-LOGO-01` 检查概念分歧、轮廓、counterform、光学平衡、小尺寸、Wordmark、App Icon、组件系统和原创性。
- `OD-MARK-01` 由 ADR-0121 增加，检查一个聚焦标志及同一标志的小尺寸桌面适配，并记录快速模式性能预算。

场景 manifest 直接引用仓库中的 prompt 文件，不维护需要人工同步的 prompt hash。Git 提交固定 prompt、rubric、模型上下文预算和首轮工具面。

真实打包产品 Run 后续输出有界 evidence：平台、应用构建、模型与上下文预算、首轮工具面、`T_plan/T0/T1/T2/T_all`、最终 captures、最终设计文件、独立 Critic 摘要和终态。只有成功 Run 可以进入视觉候选；失败 Run 仍计入成功率。

匿名评审 packet 只包含 prompt、rubric 和随机排序后的最终 captures。Provider、model、app、Run 和 Critic 身份保存在独立 key 中，不提供给评审者。每项标准独立评分，任一 critical 项低于阈值都不能由总平均分补偿。

## 后果与边界

- 修改内置设计规则不再触发手工版本或哈希维护失败。
- 稳定 ID 仍保证 deliverable 路由和宿主绑定，skill 不获得工具、文件、网络、凭据或写入能力。
- 当前切片只建立评测输入、evidence contract、匿名 packet 和宿主评分工具，不宣称视觉质量已经提升。
- 固定 UI/Logo prompt 不是产品内置模板，也不进入普通用户 Run。
- 真实 macOS/Windows 打包产品 Run、人工盲评、成功率和性能结果完成前，roadmap 的视觉质量主项保持未完成。

## 2026-08-22 外部 Skill 复审

复审 Taste Skill（MIT，`843c8dd4d18ccff0d5a9cd4b0b71d7dbf7278293`）与 Impeccable（Apache-2.0，`56f44523f76efdcec813e67b38ee550e49b16f48`）后，继续维持“不整体安装外部设计 Skill”的决策。Taste Skill 的主路径面向 Landing Page、前端代码和固定风格拨盘，Brandkit 又默认把品牌交付收敛为特定网格与暗色 editorial 展示；整体注入会增加上下文、绝对禁令和跨任务同质化。Impeccable 的完整 new-work、browser、hook、detector、subagent 和多轮 decision-comp 流程同样不进入 OpenDesign，因为它会增加首个真实画面时间，并绕开现有 typed transaction、capture 与权限边界。

只吸收不增加 Provider/tool 往返的通用判断方法：UI Plan 按当前 surface 的用户成功区分 persuade、operate、read 与 experience，其中 operate 强调熟悉性、扫描效率、完整状态和克制的状态动效；Logo Plan 把 product action、brief-specific metaphor fusion、negative space 与 letter-meaning fusion 作为可选概念生成方法。它们被压缩进现有 deliverable-scoped planning skill，不新增 skill、Plan 字段、运行时依赖、脚本、浏览器检查或 Critic 轮次。绝对风格禁令仍改写为可被明确 brief 推翻的审查信号。实际净收益继续由 ADR-0120 的固定场景、T1/T_all、成功率和匿名盲评证明，不能仅凭提示词变化宣称质量提升。

## 验证

- `@opendesign/design-skills` 测试验证当前 skill 集合不可变、ID 唯一、deliverable 路由正确、未知或错误顺序的 ID 被拒绝，并确认模型可见 bundle 不含功能版本和内容哈希。
- Plan 与 compact first-slice 测试验证 Main 覆盖模型伪造的 skill ID，并绑定当前 deliverable 的 ID 集合。
- `pnpm evaluation:check` 验证固定场景、匿名 packet、非补偿评分和证据文件完整性。
- 评测 packet 测试确认 reviewer 材料不泄露 Run、Provider 或应用身份。
