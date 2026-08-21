# ADR-0121：生成深度与按请求范围的 Logo 交付

- 状态：Accepted
- 日期：2026-08-21
- DesignDocument：不变
- Agent/Workspace：Run 增加生成深度；verified 允许在独立审查通过后没有虚构的 refinement revision
- ModelGateway：增加受限 Provider latency profile
- 关联：ADR-0050、ADR-0072、ADR-0095、ADR-0110、ADR-0117、ADR-0120

## 背景

用户首先以“多久看到第一个真实可用画面”判断 Agent 体验。生产诊断已经证明主要时间不在本地画布：四目标 Logo Run `run_1787278047330_1` 的 Provider 65 次请求累计约 3,415 秒，Renderer 72 次工作累计约 24 秒；`T1` 约 287 秒，首次 reviewed 约 1,535 秒，最终仍因恢复循环失败。随后同 prompt 的 `run_1787296054202_1` 运行约 38 分钟后由用户取消：23 次 Provider 请求累计约 1,951 秒，Renderer 29 次工作累计约 13.6 秒；`T_plan=152 秒 / T1=328 秒 / firstReviewed=873 秒`，`T2/T_all` 均不可用。该 Run 先后出现 checkpoint schema 失败、未完成 Concept Exploration 就写第二 target、stale target 和错误工具路由。

现有 Provider 请求统一允许 180 秒首响应、120 秒流空闲和 15 分钟总时限。该上限适合长任务，但对单个 Logo/Icon 过宽。旧 Logo 契约又把一个标志、应用图标适配和完整三方向品牌探索混成固定工作量；独立 Critic 只给整个探索一个 `concept-divergence` 分数，差候选可以被两个较好候选平均掩盖。

## 决策

### 用户选择快速或精细

Composer 提供紧凑的 `快速 / 精细` 生成深度，默认快速，并随 `run.start` 固定到当前 Run。

- 快速：仍先提交第一个有意义的真实 revision；不扩展用户未请求的候选、页面或品牌物料。首稿 exact-revision capture 的确定性布局、结构、组件检查和独立 Critic 全部通过时，直接 verified，不制造一次没有设计依据的 refinement。
- 精细：仍必须优先第一个真实 revision；在首稿审查后执行一次有证据的 refinement，再 final capture。

两种模式使用同一布局、结构、组件和视觉阈值。快速减少的是无意义范围、等待和 elective refinement，不是质量门禁。账本允许 `reviewRevision → verifiedRevision`，也允许精细模式保留 `reviewRevision → refinementRevision → verifiedRevision`；不得为了满足旧连续字段假写一个 refinement revision。

### Provider 时限随 Run 深度选择

ModelGateway 请求增加 `latencyProfile`，只接受 `interactive / extended`。Agent Runtime 把快速 Run 映射为 interactive，精细 Run 映射为 extended；独立 Critic 使用同一 Run profile。Main 决定真实 watchdog：

- interactive：60 秒首响应、60 秒流空闲、5 分钟单请求总时限；
- extended：180 秒首响应、120 秒流空闲、15 分钟单请求总时限。

Agent utilityProcess 只能提交枚举 profile，不能提交毫秒值或扩大 Main 上限。超时仍失败关闭并保留已提交 revision，不把未审查内容伪装成完成。

### Logo 与 Icon 使用一个按请求范围的交付模型

Logo Plan 可用 `logoOutputs` 表达实际请求的 `symbol / wordmark / app-icon / lockups / usage-preview`，但该字段是非阻断 scope hint；遗漏不能让整次模型输出因 schema 失败。App Icon 是同一标志体系的光学适配，不增加独立 deliverable 类型。

单个 Logo/Icon 默认只做一个聚焦标志及真实 32/24/16 px 测试，不自动扩展为三方向、四画板品牌系统。只有用户明确要求多个方向或完整 Identity Exploration 时才声明三方向 `logoExploration`。

每个探索方向在绘制前建立因果链：品牌含义、可见几何机制、可记忆轮廓或负形锚点、16 px 保留特征。caption 能套到任意形状上的方案不得进入绘制。独立 Critic 在同一次 exact-revision 请求中为每个 concept 增加独立 critical criterion，检查轮廓占有性、construction logic、counterform/contour、32/24/16 px 识别、反模板和 thesis 一致性。任一候选失败则整组探索失败，不能由其他候选或平均分补偿，也不为每个候选增加独立 Provider 往返。

### 固定单标志性能与质量基准

固定评测增加 `OD-MARK-01`：一个 editable symbol Logo 加同一标志的桌面小尺寸适配，使用快速模式、一个 target，不要求三方向或完整品牌系统。打包产品 evidence 预算为 `T1 <= 60 秒`、`T_all <= 5 分钟`。超预算使评测 evidence 失败，但不作为普通 Run 的中途终止器。

## 后果与边界

- 单个标志不再承担完整品牌系统的固定成本；明确的四画板请求仍完整执行。
- 单次 interactive Provider 请求不再等待 15 分钟，但一次 Run 仍可能包含多次请求；成功率和总时长必须继续由打包产品 evidence 验证。
- 快速首稿只有在 exact-revision 独立审查通过时才能跳过 elective refinement；Critic 不可用或低分时不得完成。
- 每方向独立 criterion 会增加同一 Critic scorecard 的少量字段，但不增加 capture 或 Provider 请求次数。
- 当前没有真实 macOS/Windows `OD-MARK-01` 达标证据，不得宣称 60 秒/5 分钟目标已经实现。

## 验证

- Agent contract、Renderer composer 和 Main coordinator 测试生成深度的默认值、请求传递与快速首稿直达 verified。
- Model bridge、Pi adapter 和 ModelGateway 测试 latency profile 的跨进程保留与非法值拒绝。
- Logo Plan/first-slice 测试单标志不要求 exploration，多方向 exploration 仍要求三种 principle 和稳定 evidence。
- 独立 Critic 测试第三方向低分时整组失败，前两个方向不能补偿。
- `pnpm evaluation:check` 验证 `OD-MARK-01`、generation mode、性能预算与超预算 evidence 失败。
