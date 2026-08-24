# ADR-0127：自适应首屏质量与宿主绑定设计内容

- 状态：Accepted
- 扩展：ADR-0147 将新建 UI 首个代表 target 纳入一次有界独立 Critic 闭环；本 ADR 的单一自适应入口、内容语言、Page binding 与 Logo 构造逻辑继续有效
- 日期：2026-08-22
- DesignDocument / transaction / revision：不变
- 关联：ADR-0110、ADR-0117、ADR-0121、ADR-0122、ADR-0123、ADR-0125

## 背景

生产 Run `run_1787379798255_1` 的用户请求主要为中文，但画布标题、方向名称、说明和图层名全部成为英文。系统只约束了 Assistant 回复语言，没有约束设计事务中的可见内容。

同一 Run 从用户提交到取消约 12 分钟，Provider 六次请求累计约 742 秒，Renderer 十次响应累计约 3.4 秒。首个真实材料约 103 秒出现；后续两个 checkpoint 因模型把真实 Page `page_create_1787379786885_1` 的部分重复字段误写成与 Run 时间戳相似的 `page_create_1787379798255_1` 而失败。Page 作用域校验正确阻止了越权，但让冗余 Page ID 抄写错误浪费了多次 Provider 往返。

快速模式还统一关闭新设计首轮 reasoning，并跳过独立视觉 Critic。结构和布局检查无法判断 Logo 的概念、轮廓、反模板原创性或光学质量，因此三个基础几何块也能被标记为 verified。用户实际评价标准是“多久看到第一个真实且可用的画面”和最终质量，而不是选择内部编排深度。

## 决策

### 用户只看到一个自适应执行路径

Composer 删除快速/精细选择器。Provider/Model 与模型自身 reasoning effort 仍可选；执行编排由宿主根据当前请求、交付类型和真实 checkpoint 自适应决定，不要求用户理解 Critic、ledger 或确定性门禁。

所有新建设计都优先提交首个真实、可编辑且具有明确视觉命题的材料 revision。首屏不是 skeleton、占位稿或允许后续推翻的垃圾稿。模型支持 reasoning 且用户未关闭时，紧凑新设计首轮把 reasoning 有界在 `minimal/low`，避免无思考拼形状，也不继承 `high/max` 把首屏等待无限拉长；普通明确编辑继续直接执行。

普通、目标明确且确定性布局/结构足以验收的修改可以在 clean exact-revision capture 后直接完成。Logo/品牌识别仍在首个材料 revision 可见后执行一次有界独立 Critic，并根据证据完成一次 refinement；结构通过不能冒充审美通过。更多探索只在用户明确请求时发生。

### 设计内容语言是 Run 级宿主约束

宿主从当前用户消息推断主要语言，显式“使用中文/英文”优先于统计判断。该约束进入 request-specific system prompt，并覆盖：

- 画布可见文字、方向名、说明和 caption；
- semantic step label；
- Frame、Group、Layer、Component 与 asset 的人类可读名称；
- 生图 prompt 中要求的可见文字；
- Assistant 最终回复。

品牌名、产品名、明确要求的英文 Wordmark 与用户指定保持原文；稳定技术 ID 继续使用简洁 ASCII。英文 scaffold 名称不因出现在中文 brief 中就自动成为交付语言。

### Page 由可信 Run binding 决定

Page-scoped Run 且未取得跨 Page 结构授权时，模型操作中重复出现的 `insert_element/move_element.pageId` 由 Main 绑定到注册的 Mutation Target Page。计划 artboard、parent、node namespace、当前 revision 与 Renderer 祖先检查仍必须全部通过；模型不能借此选择其他 Page，也不能绕过 parent 或 target 校验。

取得一次性 Page 结构授权的 Run 不做该绑定，继续要求显式、已检查的多 Page 目标。长期模型工具 schema 应移除 page-scoped 命令中冗余的 Page 字段，由宿主编译目标；当前绑定先消除已证明的重复长 ID 抄写失败。

### Logo 首切片必须包含可执行构造逻辑

紧凑 Logo exploration 的每个方向除 principle 与 thesis 外，必须单独声明 `constructionLogic`：可见几何机制、ownable silhouette/counterform，以及在 16 px 仍存在的识别锚点。Compiler 原样保存该判断，不再用 thesis 加 principle 自动拼出空泛构造说明。独立 Critic 按这些冻结证据逐方向非补偿评分。

## 后果

- 用户不再为内部速度/质量权衡选择模式；首屏速度和审美质量成为同一执行策略的共同目标。
- Logo 会比纯确定性验收多一次有界 Critic 与一次 refinement，但首个真实 revision 先呈现，用户不会在空画布等待审查完成。
- 支持 reasoning 的新设计首轮可能比完全关闭 reasoning 略慢，但避免把低质量首屏和后续返工当作速度收益。
- 中文请求默认得到中文设计内容；精确品牌字符串与 Wordmark 不被误翻译。
- 相似长 Page ID 的局部抄写错误不再使合法 page-scoped 事务失败；真正的跨 Page、parent、plan、revision 和 namespace 错误仍失败关闭。
- ADR-0121/0123 中用户选择快速/精细、快速统一关闭 reasoning、快速 Logo 跳过 Critic 的部分被本决策取代；非阻断 target 顺序和 interactive Provider watchdog 继续有效。

## 验证

- System prompt 测试覆盖中文主消息、显式语言覆盖、品牌/Wordmark 保留和英文请求。
- First-slice schema/compiler 测试覆盖独立 `constructionLogic`。
- Coordinator 测试覆盖 fast-wire 自适应 Logo Critic，以及 Page-scoped 命令重复 Page ID 的可信绑定。
- Composer 测试确认不再显示 Generation depth，提交仍保留模型与 reasoning 选择。
- 生产复验需记录中文 Logo、中文 UI、单个现有节点修改三类 Run 的 `T1/T_all`、Critic 次数、最终截图与人工盲评。
