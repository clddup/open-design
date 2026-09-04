# ADR-0098：版本化内置 UI 设计 Skills 与结构化视觉命题

- 状态：Accepted
- 日期：2026-08-19
- Design Plan：`1`
- Visual Review：`1`
- Built-in Design Skills：`1`
- 文档协议：不变
- 关联：ADR-0018、ADR-0050、ADR-0072、ADR-0095、ADR-0096、ADR-0097
- 修订：模型回抄 skill refs 与六项 critic 已由 ADR-0102 取代；Main 绑定 refs，Visual Review 扩为九项。非 UI Graphic bundle 与证据媒介判断由 ADR-0104 扩展。

## 背景

现有 Plan、事务、capture 和确定性布局门禁可以阻止 Page-root 散落、越界、安全区、过小触控区和文字静默裁剪，却不能让“炫酷”“高级”“有设计感”转化为可验收的视觉主张。模型仍容易收敛到深色背景、白色居中卡片、紫色按钮、重复圆角容器等完整但普通的模板。

仓库的 `@opendesign/discovery` 已能发现 user/project/builtin `SKILL.md`，但生产 Agent 没有消费结果。若新增普通 `read_skill` 工具让模型自行决定读取，会增加一次 Provider/tool 往返、拖慢首个真实画面，并让不同 Provider 是否读取产生漂移。把更多建议继续堆进巨型 system prompt 又没有版本、来源和执行证据。

## 决策

### 独立的内置设计 Skill 包

新增 `@opendesign/design-skills`，首批包含三个真实 `SKILL.md`：

- `ui-visual-direction v1`：subject、audience、primary job、visual thesis、signature motif、字体/材质/构图张力与反模板规则；
- `ui-ux-structure v1`：任务层级、信息结构、真实状态、组件语义、可访问性与恢复；
- `ui-capture-critic v1`：视觉命题、signature motif、构图张力、字体性格、材质一致性和模板症状的非补偿式审查。

每个 Skill 固定内容 SHA-256、版本、适用 deliverable 和 phase。构建时把 UI bundle 自动装配到普通 Agent 与 compact first-slice 的首个 Provider context，不新增 `read_skill` 往返，不执行 Skill 内脚本，也不动态获取远端内容。Skill 是受信任产品指令，但不授予工具、文件、网络、凭据、Capability、Approval 或 Mutation Target。

本 ADR 的首批实现只路由 `deliverable=ui`。ADR-0104 已以独立版本加入 Graphic bundle，覆盖 Logo、海报、品牌、插画和演示视觉，并保持按 deliverable 路由，不能机械套用 UI 规则。

### 单一当前 Design Plan

生产工具、compact first-slice、持久任务恢复和 Renderer 只接受同一个 `DesignPlanToolInput version: 1`。产品尚未正式发布，旧实验契约 v2–v7 已从类型、schema、validator、compiler 和恢复读取路径中删除，不提供 fallback、alias 或迁移分支。当前契约一次包含 target、quality profile、component strategy、brief fidelity，以及：

- `designIntent.subject/audience/primaryJob`；
- `visualThesis` 与必须在首个真实 slice 可见的 `signatureDecision`；
- `typographyLanguage`、`colorMaterialLanguage`、`compositionTension`；
- 至少三个具体 `antiPatterns`；
- 由宿主绑定的当前内置 `skillRefs {id}`；skill 内容直接来自当前应用构建，不维护独立功能版本或手工内容哈希。

内部 UI Plan 必须精确记录内置 UI bundle；非 UI Plan 的 refs 为空。按 ADR-0102，模型 schema 不再提交这些宿主已知字段，Main 在 Plan、compact first-slice 与 review 边界注入精确 refs。视觉身份仍不能全部推迟到首稿之后。

Plan amendment 改变 design intent 或 skill refs 时，所有已经落地且受影响的 target 降回 drafted，并清除旧 capture/review 证明；稳定 target/Page/Frame/region/Component 身份仍按既有 amendment 规则保留。

### 单一当前 Visual Review

UI Plan 的 capture 只接受 `DesignVisualReviewToolInput version: 1`。Main 为 Review 绑定同一组固定 skill refs；模型按 ADR-0102 给出九项像素证据，并显式列出 `failedCriteria`。本 ADR 最初的六项为：

1. visual thesis；
2. signature motif；
3. composition tension；
4. typography character；
5. material coherence；
6. template avoidance。

ADR-0102 在同一 Review v1 当前契约中追加 `glance-legibility`、`subject-specificity` 与 `craft-precision`，并要求首稿至少暴露两个真实失败项。

这些项不相互补偿：色彩好不能抵消构图模板化，可访问性合格不能证明独特性。Main 拒绝缺字段、skill refs 不匹配或非当前版本的 review；refinement 继续通过 canonical typed transaction 和 exact-revision capture 执行。

## 调研取舍

方法来源固定为研究参考而非运行时依赖：Anthropic `frontend-design`（Apache-2.0，`0a64e398ec6bb34a494f0c347e8ccae53a862f8e`）提供反模板化视觉方向；Impeccable（Apache-2.0，`f88b2837a7d7c3182e46307bbbb091a1ed547571`）提供 shape/critique/bolder 与非补偿审查思路；Vercel Web Interface Guidelines（MIT，`e3d624baaf29dc1fc645aff3e38f03e564d2d6b1`）和 Huey frontend-agent-skills（MIT，`2841c079dd8a9c634882227194dc42e25227710d`）补充交互、可访问性和 UX 结构。

不整体复制或安装这些包：它们主要面向前端代码、浏览器脚本和动态远端资料，与 OpenDesign typed design tools、utilityProcess、权限和 revision 事务边界不一致。仓库中的三个 Skill 是针对 OpenDesign 重写的自有产品指令。

## 后果与限制

- 首轮多出有界静态 context，但没有新增 Provider/tool 往返；context budget 测试同时约束 prompt 与 compact schema。
- 当前 Plan 让“设计感”从自由文本要求变成 Plan、首屏与 capture review 之间可追踪的契约，但模型审美判断仍不是确定性事实。
- 该切片不会保证任意模型都能生成优秀作品，也不替代图片素材、字体可用性、专业工具能力或人工盲评。
- 用户级/Project 级自定义 Skill、管理 UI、动态路由、冲突合并和审计尚未接入生产；`@opendesign/discovery` 仍不能被宣传为用户可用能力。
- UI 固定样张的同 prompt/模型/工具预算盲评，以及 macOS/Windows 打包产品的首个可用画面时间和成功率，仍是发布前验证项。

## 验证

- Skill 内容哈希、唯一 ID、不可变 registry 和 bundle 大小；
- UI 精确 refs、非 UI 空 refs、缺失/过期 refs 和空洞 design intent 的 schema/runtime 拒绝；
- compact first-slice v1 只编译当前 Plan v1，旧实验输入被明确拒绝；
- 首个 Provider request 实际使用包含三项内置 Skill 的 system context，且不增加工具调用；
- Main 对非当前 Plan/Review、错误 skill refs 的拒绝，以及 exact Visual Review v1 的接受；
- Plan amendment 对 intent/refs 变化的 target 降级；
- desktop typecheck、相关 Agent/Coordinator/context budget 测试和普通 Vite build。

## 复审条件

开放用户或 Project Skill、需要按任务动态缩短 bundle、Provider 对 schema 支持出现差异，或固定盲评证明静态 bundle 降低首屏速度/质量时复审。Logo/品牌/海报方法包已由 ADR-0104 落地。任何替代方案仍不得让 Skill 获得能力或绕过真实 capture/transaction 证据。
