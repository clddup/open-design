# ADR-0152：质量守恒的逐目标 UI 交付

- 状态：Accepted
- 日期：2026-08-25
- DesignDocument / transaction / revision：不变
- 扩展：ADR-0050、ADR-0127、ADR-0147、ADR-0151
- 取代：ADR-0123 中“UI target 顺序仅为建议”和“结构 clean 即可交付任意后续 UI target”的部分

## 背景

生产 Run `run_1787630879071_1` 为同一 Page 下 24 个微信小程序界面。运行约 22 分钟，`T_plan≈262s / T1≈328s / T_all≈1339s`；43 次 Provider 请求累计约 1289 秒，65 次 Renderer 工作累计约 12 秒。首个登录 target 经一次独立 Critic 发现 `visual-thesis / signature-decision / template-avoidance / subject-specificity` 失败并完成 refinement，首页和 AI 入口随后单独起草。

之后模型在一笔 42 命令事务中同时写入剩余 21 个 target，每个 target 只有画板、后补的计划 Region 和一层包含整页标题、行、箭头、按钮文案的巨大 Text。每个 capture 的 `checkedNodeCount=3 / checkedTextNodeCount=1`，但 `deterministic-fast-delivery` 仍逐个写入相同 revision `417` 的 `reviewRevision/verifiedRevision`，最终声称 24 个页面全部完成。

Plan 已为每个 target 声明不同 hierarchy、asset integration、数据图形、角色头像、播放器、内容封面或操作结构，内置 UI skill 也禁止卡片模板。失败原因不是缺少计划形容词，而是系统提示明确允许“一笔事务覆盖多个画板”，Main 把 active target 降为建议，并让后续 UI 仅凭“非空 Region + 无越界”完成。模型因此选择了最便宜、最容易通过 schema 的背景加单 Text，而不是执行已经声明的设计。

为每个 target 都增加同步 Provider Critic 会把 24 页面流程继续放大；只让 review 更严格也只能在坏稿提交后反复打回。质量必须在 authoring 边界先守住，同时保持首个真实 revision、代表 target Critic 和后续确定性验收的有界执行模型。

## 决策

### UI active target 恢复为材料写边界

Plan 仍一次原子分配全部真实 Frame，用户可以立即看到完整交付范围。材料写入只允许当前第一个未完成 UI target：普通 Apply、图片放置、Hierarchy、Arrange、Vector、Component、Style/Variable 和其他解析到 target 的材料工具共用同一 Main guard。当前 target capture/verification 后才推进下一 target。

一笔事务可以覆盖当前 target 内已知的 navigation、Hero、内容、数据、底栏等真实语义步骤，但不能同时起草多个 UI artboard。Logo exploration、非 UI graphic 组合和没有 UI delivery Plan 的普通批量编辑不受此限制。相邻 Apply + Capture 应使用现有 checkpoint 合并，逐目标不等于逐层增加 Provider 往返。

### 单 Text 不是 UI 首稿

新建 UI target 的首次材料事务若只有一层 Text，Main 在 revision 前返回 `design_workflow.ui_draft_structure_incomplete`。换行、空格、箭头或其它字符不能代替独立标题、控件、行、导航、数据与视觉元素。

exact-revision inspection 在确定性 verification 前重复同一结构检查：create target 若最终只剩一个 Text leaf，同样不能进入 verified。该门禁只证明 UI 没有被压扁成文本占位，不按节点数量评判审美，也不禁止合理的圆、渐变、卡片或极简设计；首个代表 target 的像素 Critic 继续负责视觉命题、模板症状与工艺质量。

### Skill 与工具说明描述真实执行模型

UI skill、系统提示、Apply 与 Capture 工具说明统一要求：

- 实现每个 target 已声明的 hierarchy 与 asset integration；
- 标题、行、按钮、导航、数据和视觉证据保持独立可编辑；
- 完成并 capture 当前 UI target 后再写下一 target；
- 后续 target 可以复用已审查视觉系统，但不能复用占位结构；
- checkpoint 用于合并同一 target 的已知 Apply + Capture，而不是批量填充多个 artboard。

## 后果

- 24 页面流程不会再用一笔低质量事务批量制造 21 个“背景 + 文本”页面，也不会把相同 revision 的结构占位逐页标记完成。
- 逐目标会减少单次批量输出，但不恢复每层一轮模型调用，也不为后续每个 target 增加独立 Critic；真实总时延仍主要取决于 Provider，应继续以 `T1/T2/T_all` 和 checkpoint 使用率测量。
- 确定性结构门禁不是审美评分。它消除已证实的最低成本伪交付；真实视觉质量仍由前置 design intent/skill、首个代表 target Critic、目标特定内容与人工/固定样张证据共同证明。
- active target 不改变 Page、capability、revision、undo 或恢复语义；全部 Frame 仍一次分配，失败 target 的已有有效 revision 仍可恢复。

## 验证

- 多 target UI Apply 同时写两个 artboard 时在 Renderer revision 前返回 `active_ui_target_required`；完成当前 target 后下一 target 可写。
- 首次 UI Apply 只有一个 multiline Text 时在 revision 前返回 `ui_draft_structure_incomplete`。
- exact-revision inspection 中 create target 只剩一个 Text leaf 时不能通过 deterministic verification。
- 首个新建 UI target 仍经过一次有界独立 Critic + refinement；后续 target 不新增逐页 Critic。
- 系统提示和 UI skill 不再允许跨 target 批量填充，并明确 checkpoint 只合并当前 target 的 Apply + Capture。
- 生产复验使用 1/4/12/24 target UI 样本记录 `T1/T2/T_all`、每 target leaf 结构、Critic 次数、checkpoint 次数与盲评结果；自动化结构测试不能冒充该产品证据。
