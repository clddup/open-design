# ADR-0117：无作者上下文的独立视觉 Critic

- 状态：Accepted
- 日期：2026-08-21
- DesignDocument：不变（`1.36.0`）
- Agent tool contracts：不变；`record_visual_review` 降为 recovery path
- 关联：ADR-0075、ADR-0098、ADR-0099、ADR-0116

> ADR-0233 已取代本文中 Draft 必须返回至少两条 refinement 且必然进入 refinement 的部分；独立上下文、exact revision、宿主阈值和真实失败后的 refinement 继续有效。

## 背景

既有 Visual Review 把 deliverable-scoped critic skill 注入作者 Agent，再由同一个模型提交文字评价。Main 只校验字段完整、九项通用 criterion 文本、至少两个 `failedCriteria` 和 refinement 数量；它没有发起独立视觉请求，也没有对截图评分。因此作者可以在结构和文字上满足协议，同时让通用方块 Logo、弱轮廓、模板化 UI 或未完成 App Icon 进入 refinement，最终 capture 又只受确定性几何门禁约束。文档中“独立 critic”的表述与运行事实不一致。

质量门禁不能依赖作者自证，也不能把完整 Conversation、reasoning、tool history 或文档重复发送给第二个模型。Critic 必须绑定 exact revision、输入有界、输出可验证，并由宿主而非模型裁定 pass。

## 决策

每次无确定性 layout error 的生产 Frame capture 由 Main 通过当前 Run 的已配置视觉模型发起一个全新的 stateless request：

- session 只使用 `${runId}:visual-critic`；请求仅包含最新用户 brief、active Plan 的当前 target/visual system/brief fidelity/design intent、exact-revision JPEG attachment，以及该 deliverable 的本地 review skills；
- Critic 复用 Run 的 provider/model 身份，但不继承作者的 reasoning effort；当前模型必须支持 image input 与结构化 tool use，后续独立模型配置不改变 scorecard 或账本契约；
- 不包含作者 assistant messages、reasoning summaries、tool calls/results、此前自评、完整文档或其他 target；
- 模型只能调用一次内部 `opendesign_submit_independent_visual_critique`，不能获得任何设计写工具；附带 prose、额外 tool call、缺失/额外 criterion 均失败封闭。输出为每项 `1..5` 整数分和可见证据；Draft 还必须返回至少两条可执行 refinement；
- Main 严格验证 criterion 集合和字段，再自行计算平均分、critical threshold、failed criteria 与 pass，忽略模型的主观“通过”声明。

所有 deliverable 继续使用九项通用非补偿 criterion。Logo 额外强制：concept divergence、black silhouette、counterform/contour、optical balance、16/24/32 px recognition、monochrome、symbol-wordmark relationship、app-icon optical redraw 与 component/system integrity。Logo 的 concept divergence、silhouette、counterform、small-size、app-icon redraw 和 template avoidance 必须至少 `4/5`；其余 critical UI/graphic criterion 至少 `4/5`，普通 criterion 至少 `3/5`，整体平均分至少 `3.5`。

Draft capture 的独立 scorecard 自动成为当前 target 的可信 review，并直接进入 refinement，替代作者额外调用 `record_visual_review` 的普通路径。Final capture 再运行一次 critic；任何 threshold failure 保持 `refined`，返回具体 failed criteria/refinements 并允许定向继续修改，只有 clean layout + critic pass 才进入 `verified`。`record_visual_review` 暂保留为明确 `reviewEligible=true` 时的 legacy recovery，不再是生产默认。

ADR-0095 的第二个 checkpoint action 同步从 `review-refine-and-capture` 收口为 `refine-and-capture`：它消费上一 clean capture 已返回的独立 Critic findings，只提交 refinement，再由宿主捕获精确新 revision。作者 review 不再作为复合工具输入，避免自动 review 后被重复登记并卡住账本。

## 后果

- 作者模型不能再用自己的解释批准自己的画面；最终 Logo/UI 必须在精确截图上通过宿主评分阈值。
- Draft critic 的输入远小于作者 Conversation，并替代一轮作者自评；Final critic 增加一次有意义 checkpoint，但避免每个小步骤都截图/审查。
- 当前默认仍复用 Run 选择的同一模型能力，只隔离上下文与请求状态；后续可增加独立 critic model 配置或多模型 blind review，不改变本契约。
- Critic 是视觉质量门禁，不修改文档，也不替代 Layout Quality Report、Component provenance、人工验收或专业样张。
- Pattern/Style Reference/Brand Context、高阶组件库和生成 rubric 仍需继续改善作者首稿；本 ADR 先阻止低质量结果冒充完成，不宣称仅靠审核已经解决生成审美。

## 验证

- 请求隔离：一个 user message、一个 exact-revision image reference、无作者历史、无设计工具；
- schema：criterion 精确集合、1..5 整数、证据/refinement 边界、缺失/额外字段和非 tool response 失败封闭；
- Logo：单个 critical 低分即阻断，其他高分不能补偿；全项达标才 pass；
- Coordinator：draft 自动 reviewed、final 低分保持 refined、final pass verified、revision 不匹配拒绝；
- Provider/attachment：复用 Main 凭据和内容寻址 attachment resolver，不向 Renderer、Agent Runtime 或 critic 暴露密钥与路径。
