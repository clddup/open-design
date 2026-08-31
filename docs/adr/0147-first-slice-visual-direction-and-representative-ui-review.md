# ADR-0147：首切片视觉方向前置与代表 UI 审查

状态：Accepted，取代 ADR-0122 中“由宿主从已画元素反推普通 design intent / visual system”的决策，并扩展 ADR-0127 的自适应 UI 质量路径。ADR-0152 进一步要求后续 UI target 也保持可编辑的 target-specific hierarchy，不得把代表 target 的视觉系统降级为单 Text 占位结构。ADR-0233 已取代本文中 first-slice 直接提交 `semanticObjects` 和首稿无条件进入 refinement 的部分。

## 背景

生产样张反复把“炫酷、科技感、专业”等宽泛形容词收敛为纯色同心圆、渐变方块、统一圆角卡片和解释性 caption。内置 design skill 已把无业务依据的扫描环、装饰渐变和同半径卡片列为模板症状，但 compact first-slice 为缩短首轮输出删除了模型输入中的 `designIntent`、`visualSystem`、每个 target 的 `objective/layout/spacing`、`rasterAssetRoles` 与 `semanticObjects`。Main 在材料提交后再从现有颜色、字体和几何反推保守默认值，等于允许模型先画最低成本几何，再为结果补写理由。

同时，普通新建 UI 在内部 fast 编排中只经过 exact-revision capture、确定性布局和结构检查。该路径能证明节点合法、没有越界和交付 Frame 有材料，不能证明形状具有产品因果、构图张力、材质层次或工艺质量。因此生硬基础几何也会直接进入 `verified`。问题不是圆、方块或渐变本身非法，而是没有可见构造逻辑的默认几何被当成完成结果。

恢复完整 Plan-only Provider turn 会重新增加首屏等待；对每个 target 都串行增加 Critic 又会放大多页面任务。需要在同一次 first-slice 调用中恢复最小但完整的设计判断，并只在视觉系统首次落地处增加审查。

## 决策

### 同一次 first-slice 调用先定方向再画

模型可见的 compact first-slice 契约在同一次工具调用中重新要求一份简短的整体方向，而不是逐元素解释：

- `designIntent`：subject、audience、primary job、可见 visual thesis、causal signature motif、字体/材质/构图语言与反模式；
- `visualSystem`：形态、色彩、表面层次、字体和 effect 的具体关系；
- 每个 target 的 `objective/layout/spacing`，用于说明真实产品任务和空间策略；
- `rasterAssetRoles`，为空也必须显式提交；需要真实人物、地点、活动、商品、头像或封面时不能用几何冒充证据；
- 可选 `semanticObjects`，让模型在首轮判断共享导航、稳定控件或内容模式是否应成为 Component/Instance，普通 wrapper 和装饰不得组件化。

这些字段与 `firstSlice.elements` 在同一个 Provider tool call 中提交，不增加 Plan-only 往返。Main 只绑定可信宿主事实：完整原始 brief fidelity、内置 skill refs、quality profile、当前 Run reference 与 Page/revision/ID namespace；不再覆盖模型的视觉方向，也不再从已经画出的元素反推理由。

模型字段使用短文本和有界列表，不能输出长篇设计作文。结构 Schema 只证明字段完整和类型合法；形容词或事后合理化不能证明视觉质量。系统提示要求首个真实切片直接体现 thesis 和 motif，最终仍以 capture 证据验收。

### 审查首个新建 UI 代表 target

内部 fast 编排中的新建 UI，只对 `targetOrder[0]` 且 `artboard.mode=create` 的首个代表 target 启用一次有界独立 Critic 闭环：

1. 首个材料 revision 立即真实提交并显示，不等待 Critic 才 reveal；
2. clean exact-revision capture 进入独立 draft Critic；
3. 作者根据结构化失败项完成一次材料 refinement；
4. refined revision 完成第二次 exact-revision capture，并在确定性布局、结构与组件检查 clean 后进入 `verified`，不再请求第二个 Provider Critic。

同一 Plan 的后续 UI targets 复用已经审查的 visual system，继续使用确定性布局、结构和组件检查，不为每页重复增加 Provider Critic。`artboard.mode=existing` 的普通局部编辑不因本决策增加 Critic。Logo 继续保持已有的有界独立审查语义；其他 graphic/brand 路由不在本切片扩大。

### 不建立几何黑名单

不全局禁止圆、同心结构、渐变、方块、深色或发光效果。Critic 检查的是：

- 形状是否由 brief 的产品动作或含义推导，而非 caption 事后解释；
- 去掉品牌文案和强调色后，轮廓、负形、节奏、构图或材质是否仍有识别度；
- 同心结构是否具有非均匀节奏、切割/遮挡、层次或明确焦点，而非默认 primitive 堆叠；
- 在目标缩放和小尺寸下是否仍保持光学平衡与识别锚点；
- capture 是否落实了声明的 thesis/motif，而非只满足节点数量和几何合法。

## 后果

- 首轮固定 system + tool context 从约 30 KB 增至约 32.8 KB，测试保留 34 KB 的有界上限。增加的是模型必须作出的简短设计决策，不恢复完整 Plan-only turn，也不能为了旧任意字节线再次删除关键语义。
- 新建 UI 的首个 target 增加一次独立 draft Critic 请求和中间一次真实 refinement，但首个材料 revision 仍先显示；refined capture 与后续 targets 不重复 Provider Critic。相比 draft/final 双 Critic 少一次最昂贵的串行 Provider 往返。
- 本决策能阻止“结构合法即审美完成”，不能保证任意 Provider 都具有顶级品牌设计能力。固定 UI/Logo 盲评和打包产品 `T1/T2/T_all` 仍是最终证据。
- 长 PRD 的范围遗漏由 ADR-0148 的用户确认 Delivery Plan 单独解决；该范围门禁不能冒充审美质量，本决策也不能冒充完整交付范围。

## 验证

- first-slice Provider schema 缺少 `designIntent`、`visualSystem`、target 任务/布局/间距或 `rasterAssetRoles` 时返回准确结构路径；Main 保留模型值并只绑定宿主元数据。
- first-slice 编译保留 raster roles 与 semantic object/component 决策。
- fast 新建多 target UI 的首 target draft capture 缺 Critic 时失败关闭；review 后必须产生真实 refinement，refined capture 只做 exact-revision 确定性验收，完成后下一 target 不再创建 Critic context。
- fast brand asset 与 existing-artboard UI 保持原有非扩大的 Critic 路由；Logo 保持已有审查路径。
- production first-slice context 保持单个生成工具加 recovery inspect，固定协议低于 34 KB；该静态门禁不冒充真实 Provider 时延或视觉盲评。
