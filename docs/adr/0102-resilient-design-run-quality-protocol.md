# ADR-0102：设计 Run 的可恢复质量协议

- 状态：Accepted
- 日期：2026-08-19
- Design Plan：`1`
- Visual Review：`1`
- Built-in Design Skills：`1`（内容哈希更新）
- Agent Event：`3.6`（协议版本不变）
- 文档协议：不变
- 关联：ADR-0050、ADR-0072、ADR-0095、ADR-0096、ADR-0098、ADR-0101

## 背景

生产 Run `run_1787137724225_1` 证明首个真实登录页切片可以一次提交到画布，但后续流程被协议自身放大：模型把 delivery Frame 列入 safe-area 节点，capture 以“Frame 不是自身 descendant”拒绝，Plan amendment 又禁止删除该错误节点；checkpoint 的根级 `additionalProperties: false` 与分支 schema 冲突；模型回抄 skill hash 错一个字符会浪费完整 Provider turn。另一 Run 又把 34,870 字符的校验参数写进 `tool.failed.message`，超过 Agent 协议 20,000 字符上限，使当前请求和下一次 session history 恢复连续失败。

同一登录页 capture 还暴露了视觉质量问题：内置 critic 把“深色背景 + 冷青线 + 同心圆 + 常规表单卡”判断为明显反模板，只报告一个材质错误。skill 已加载不等于像素质量达标，固定 hash 也不能充当审美证据。

## 决策

### 宿主拥有稳定元数据

模型面对的 Plan、first-slice 和 Visual Review schema 不再要求 `skillRefs`。Main 根据 deliverable 和当前本地 bundle 注入精确 `id/version/hash`，内部 Plan、review、恢复状态与审计结果仍保留这些 refs。模型负责设计判断，不负责逐字符复制宿主已经知道的哈希。

UI quality profile 只引用 delivery Frame 的真实 descendants。Main 接受 Plan 时删除 Frame 自引用；Layout Quality 对历史自引用做无害降级。材料开始后仍必须稳定保留 `targetId + Page + artboard Frame + region`，但 `safeAreaNodeIds` 与 `interactiveNodeIds` 是可修订验收策略，必须能随真实节点删除、替换和修复而更新，不能形成不可恢复闭环。

### 复合工具和失败边界必须自洽

checkpoint 的两个 `oneOf` 分支各自拥有完整 properties 与 `additionalProperties: false`；根级不再额外拒绝所有分支字段。普通 apply、review、capture 的 Coordinator、revision 与短路语义不变。

所有 `tool.failed` 在写 durable journal 和发布 Renderer 前限制为 20,000 字符。既有 journal 保持原始审计数据不变；session history 投影对历史超长 failure 做确定性截断摘要，对无效 details 继续只移除 details，不丢整条工具历史。可恢复的 populated Frame resize 路由错误归入 layout recovery，Timeline 默认折叠，不冒充用户级终态失败。

### Skill 生效由像素审查证明

内置 UI skills 增加以下约束：

- 在 25% thumbnail 下验证主任务、焦点与主操作的顺序；
- 移除品牌文案和强调色后，构图、字体、轮廓或材质仍需具有主题专属性；
- 检查对齐、间距、文字尺度、控件比例、边缘处理与平衡的工艺精度；
- 把无产品依据的深色冷青电路线、同心扫描环、HUD 微文案和泛安全术语视为模板症状。

Visual Review v1 的非补偿 criteria 从六项扩为九项，新增 `glance-legibility`、`subject-specificity` 与 `craft-precision`。首个 capture 至少暴露两个有实际影响的 failed criteria；确定性几何问题不能掩盖模板化或工艺不足。

## 后果

- 首轮和审查 schema 更小，减少 hash typo 与重复 token，不增加 Provider/tool 往返。
- Plan 的稳定身份边界与可变验收策略分离；旧 Run 的 Frame 自引用不会继续阻断 capture。
- 超长内部诊断不再毒化当前事件或下一次会话恢复；原始 journal 仍可审计。
- 更严格 critic 能阻止当前样张式的自我表扬，但仍不能把模型审美变成确定性事实；发布前仍需要固定 prompt 的人工盲评和 macOS/Windows 打包产品样本。

## 验证

- first-slice/Plan/review schema 测试证明模型输入不含 skill refs，Main 规范化后内部 refs 精确固定；
- checkpoint 测试证明合法 `apply-and-capture` 不受根级 schema 误拒绝；
- Plan/Layout Quality 测试覆盖 Frame 自引用、质量集合替换和历史降级；
- Agent Runtime 测试覆盖新 failure 发布前截断与第 59 项式旧 session history 恢复；
- Visual Review schema/fixture 覆盖九项 criteria 与至少两个失败项。
