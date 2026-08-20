# ADR-0104：按交付类型路由设计 Skills 与证据媒介判断

- 状态：Accepted
- 日期：2026-08-20
- Design Plan：`1`（版本不变）
- Visual Review：`1`（版本不变）
- Built-in Design Skills：`1`（新增 Graphic bundle）
- 文档协议：不变
- 关联：ADR-0018、ADR-0050、ADR-0095、ADR-0098、ADR-0102、ADR-0103

## 背景

生产夏令营海报任务要求“真实可信”，Plan 却提交空 `rasterAssetRoles`，并明确假设“使用可编辑矢量形状营造照片式真实取景”。实际画面只用椭圆山体和矩形帐篷模拟真实活动，虽然可编辑，却没有人物、环境或活动证据。相反，若把所有交付强制改为位图，Logo、图标、信息图和明确的矢量插画又会失去结构与编辑价值。

同一非 UI Run 还暴露了独立协议错误：Plan 正确绑定空 skill refs，Visual Review normalizer 却无条件注入 UI refs；Coordinator 将两者比较后必然返回 `visual_review_skill_mismatch`。重试无法改变结果，Review 失败后继续 refinement 又产生第二条门禁错误。Compact first-slice 成功后会自动 capture，而通用“capture 后先 review 再写”门禁同时阻止已在 Plan 中声明的首次图片放置，使正确的“先建立构图、再生成并放置图片”流程也无法完成。

## 决策

### LLM 负责证据媒介判断

Design Plan v1 继续由模型根据 subject、audience、primary job、用户附件和明确风格要求决定 `rasterAssetRoles`，宿主不按 `poster`、`logo` 等类别机械强制生图：

- 当说服力依赖真实人物、活动、地点、商品、食物、室内空间、材质或环境时，优先使用用户授权图片或生成图片，并声明 `background`、`hero` 或 `supporting-content`；
- Logo、图标、图表、信息图、明确的矢量插画和不需要真实证据的任务优先使用可编辑矢量；
- 混合交付由图片提供主体证据，矢量与文字负责排版、品牌、遮罩、图表和装饰；标题、日期、价格、Logo、CTA 等必须保留为可编辑文档节点，不烘焙进生成图片；
- 基础几何不能被描述为照片式真实。图片服务不可用时保留有效可编辑构图并报告缺失证据，不用假矢量主体冒充完成。

这是模型的设计判断，不是确定性布局规则。Main 只在 Plan 已声明角色后约束生成、附件、放置目标、稳定 artboard、active target、revision 与权限，不替模型猜测题材。

### 内置 Skill 按 deliverable 路由

`@opendesign/design-skills` 在原三个 UI skills 外新增两个固定版本和内容哈希的 Graphic skills：

- `graphic-visual-direction v1`：主题证据、媒介选择、图片生成构图、矢量优先场景与混合排版；
- `graphic-capture-critic v1`：主题证据、素材融合、远距信息层级、交付工艺与真实性审查。

UI 继续绑定 UI bundle；poster、logo、brand-asset、illustration、presentation-visual 与 other 绑定 Graphic bundle。首个 Provider context 仍静态携带有界的 deliverable-scoped bundle，并要求模型只激活匹配当前交付类型的 skill，不增加 `read_skill` 或额外 Provider/tool 往返。

Main 是 Plan 和 Review skill refs 的唯一事实源。模型 schema 不提交 refs；Plan normalizer 按 deliverable 绑定本地 refs，Review 注册时直接使用 active Plan refs。Review normalizer 的临时候选值不能覆盖 Plan，也不能再以 UI refs 拒绝非 UI Review。

### 已声明图片的首次放置属于初稿补全

Compact first-slice 可以先提交真实 artboard、可编辑文字、色彩与图片构图区域，以缩短首个真实画面时间；它不能在该工具内生成图片，也不能把占位几何描述为最终主体。

若 active Plan 已声明可放置 raster role，且 target 正处于 compact slice 自动 capture 后的 `captured` 状态，则允许该 role 的首次 `place_image` 作为初稿补全穿过“先 review 再 refinement”门禁。图片写入仍走 canonical transaction，并使旧 capture 失效、target 回到 `drafted`；模型必须重新 capture，再进行 Visual Review。其他 capture 后写入仍必须先 review。

## 后果

- 真实场景类任务不再因“全部可编辑”而默认退化成假照片式几何，同时不会把所有 Logo、图标和插画强制 rasterize。
- 非 UI Visual Review 不再稳定失败，Review refs、Plan refs 与持久恢复状态保持一致。
- 首切片仍能快速产生真实画布变化，图片生成只增加题材确实需要的模型调用；不会为每个小步骤重新请求模型或截图。
- 全部内置 skills 的静态 context 大于原 UI-only bundle，仍受固定预算测试约束。发布前须用相同 prompt、模型和工具预算比较首个可用画面时间、成功率与视觉盲评，不能以规则存在宣称质量已解决。
- Skill 只影响设计与审查判断，不授予工具、网络、文件、凭据、Capability、Approval 或 Mutation Target。

## 验证

- 固定哈希、唯一 ID、deliverable 路由、refs 顺序与 bundle 大小测试；
- poster/graphic Plan 自动绑定 Graphic refs，模型回抄的 stale refs 被 Main 丢弃；
- non-UI capture 可注册 Review，Coordinator 最终持久 refs 精确等于 active Plan；
- 已声明 hero role 的首次图片放置可在 compact slice capture 后执行，未声明 role、错误 artboard、错误 target 和普通 refinement 继续拒绝；
- 图片放置后旧 capture/review 证明失效，必须重新 capture；
- design-skills/desktop 定向测试与 typecheck，随后通过 macOS/Windows 打包与 packaged Agent smoke。

## 复审条件

当宿主能在首轮前可靠分类 deliverable、需要动态缩短 skill bundle、开放用户/Project skills、增加本地素材检索，或固定样张证明静态 Graphic bundle 对速度或质量无净收益时复审。不得通过把所有交付强制位图、把所有交付强制矢量，或恢复模型回抄 refs 来规避本决策。
