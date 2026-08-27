# ADR-0195：Logo 主视觉颜色策略与独立 Critic

## 状态

已接受。

## 背景

Logo 流程已经要求黑色轮廓、monochrome 和 32/24/16 px 证据，但这些测试要求反向影响了主视觉：模型容易把纯黑白几何当作正式方案，只把颜色放在展示背景或完全省略。多方向探索也只约束造型原则，没有约束各方向的配色语义；App Icon Critic 只检查光学重绘，没有明确检查桌面图标生态中的颜色区分度。

Monochrome 是必要的鲁棒性测试，不应默认成为品牌主方案。颜色是否有意义属于视觉判断，但“主方案是否声明品牌色”“是否把用户只要求的 monochrome 变体误解为 monochrome-only 主身份”可以在写入前准确约束。

## 决策

1. Logo Plan 与 compact First Slice 增加 `logoColorStrategy`：`brand-color` 是默认主身份；`monochrome-by-brief` 只在权威用户 brief 明确要求 monochrome-only 时成立。策略同时说明配色因果与 light/dark 适配。
2. `visualSystem.palette` 继续是主视觉 palette 的唯一事实；共享 Logo color domain owner 只检查是否存在明确 chromatic brand color，不建立第二份 palette。
3. 三方向 Logo exploration 的每个方向增加 `colorSystem.palette/rationale`。结构层拒绝纯中性色主方向和完全重复的 palette；是否只是表面换色仍由 exact-revision Critic 判断。
4. Design Plan 与 First Slice 共用同一个颜色 domain owner。Main 将 Run 的权威 prompt 传入 Contract，避免模型用“用户要求黑白”作为未经核对的例外。普通“包含 monochrome 变体/测试”不构成例外。
5. 独立 Logo Critic 增加非补偿判据：`brand-color-system`、探索时的 `color-system-divergence`，以及 App Icon 请求时的 `app-icon-ecosystem-distinction`。三项均为 critical，低于 4 分不能交付。
6. 每个方向的 Critic contract 同时携带该方向的 palette/rationale，并要求实际 capture 中颜色属于 mark，而不是只存在于 caption、展示底板或说明文字。
7. 内置 Logo planning/review skills 明确：主方案先做品牌色，monochrome 后做测试；App Icon 必须在 macOS/Windows 图标环境中保持颜色、质量与负形区分度。
8. 不增加 Provider 往返、逐方向 Critic、固定等待、功能版本号或兼容读取。产品尚未发布，旧开发期 Logo Plan 输入直接失效。

## 结果

- 默认 Logo 主方向不能再以纯黑白几何通过 Plan 和最终 Critic。
- 用户明确要求 monochrome-only 时仍可使用单色主身份；要求 monochrome 变体不会误触发例外。
- 三个概念方向同时具备造型和配色差异，不允许一套 palette 重复三次。
- App Icon 不只检查缩放和重绘，还检查真实桌面生态中的可识别性。
- 确定性 Contract 只判断可证明的配色声明；审美和实际像素兑现继续由独立 capture Critic 与后续固定盲评负责。

## 验证

- 纯黑白 `brand-color` palette 在 Plan 与 First Slice 都返回准确字段路径。
- `monochrome-by-brief` 会拒绝“包含 monochrome 测试”的普通 brief，只接受明确 monochrome-only 的权威 brief。
- 三方向重复 palette、缺少 chromatic color 分别返回结构化 issue。
- 独立 Critic 会因主品牌色、方向配色差异或 App Icon 生态区分度任一低分而失败。
- Planning/review skill bundle 仍保持既有上下文预算，并未增加工具或模型请求。
