# ADR-0163：Main 设计 Capture 与 Review 所有权

## 状态

已接受。

## 背景

`GlobalTaskCoordinator` 已唯一持有 Plan、delivery ledger、inspection、review 与 revision 规则，Renderer 也已通过隔离 Leafer 投影生成 exact-revision capture。但 Main 入口仍直接编排 capture target 解析、离屏截图、确定性布局报告、权威 inspection、独立视觉 critic 和 ledger 推进。公开 capture、first-slice 与 checkpoint 虽然调用同一段内联函数，生命周期仍没有可独立测试的 owner。

这段流程决定模型是否能继续修正或完成交付。若任一调用路径遗漏 revision 对齐、布局门禁或 critic 条件，就会出现画布未更新却宣称完成、同一失败反复调用、或确定性布局错误仍浪费一次 Provider 视觉审查的问题。

## 决策

1. `DesignCaptureReviewSession` 是一次 Main design-tool dispatch 内 capture/review 编排的唯一 owner。它绑定当前可信 `TrustedToolContext`、取消信号、`GlobalTaskCoordinator`、Renderer execute port 与按需取得的 `ModelProviderHost`。
2. 所有 capture 入口共用同一 `capture()`：公开 `opendesign_capture_canvas`、first-slice 自动 capture 与 checkpoint 自动 capture 不再各自维护流程。
3. capture 顺序固定为：
   - 从 coordinator 解析当前 Run 的权威 Page/Frame target；
   - Renderer 对该 target 生成 capture，并返回 observed revision；
   - 验证 capture 自带的确定性 layout-quality report；
   - 紧接着执行一次权威 document inspection，并要求 inspection revision 与 capture revision 完全一致；
   - 只有确定性布局无错误且 coordinator 判定该 target 需要独立审查时，才调用无作者 Conversation 上下文的 visual critic；
   - 最后由 coordinator 记录 capture/critic 并推进 delivery ledger。
4. 确定性布局有错误时不调用 Provider critic；错误仍由 coordinator 产生原有结构化恢复动作。revision 不一致时不推进 capture ledger。
5. `opendesign_record_visual_review` 的 Contract 解析、宿主 skill refs 绑定与 ledger registration 也由该 session 负责。Main 入口只委托，不再解释 review 输入或拼装 accepted 结果。
6. `GlobalTaskCoordinator` 继续唯一拥有 target、inspection、review、revision 和完成门禁；`MainDesignToolRuntime` 继续拥有协议、授权、超时、取消与 audit；Renderer/EditorRuntime 继续是唯一文档写入链。本决策不增加兼容 facade、第二份状态或新的 Provider 工具。
7. 本次只迁移所有权，不改变公开 schema、工具名称、capture 像素、layout-quality 规则、critic 评分、delivery 状态或错误语义。

## 结果

- Main 入口不再直接实现 capture/review 生命周期，first-slice、checkpoint 与公开工具无法产生分叉行为。
- Provider critic 不会在确定性布局已失败时继续消耗时间。
- exact-revision 对齐、调用顺序、错误分支和 ledger 推进可由一个窄测试文件验证。
- Page/Component、import/export 等剩余 design-tool policy family 仍需迁出，Phase 6 保持开放。

## 验证

- 非 capture/review 工具不会触碰 coordinator、Renderer 或 Provider。
- malformed visual review 在 registration 前返回准确字段路径；合法 review 绑定当前 Plan 的宿主 skill refs。
- capture 使用 coordinator 选择的 target，并在同 revision inspection 后才推进 ledger。
- capture/inspection revision 不一致时不记录 capture。
- layout error 跳过 attachment/critic；clean 且 eligible 的 capture 才运行 critic并把结果交给 coordinator。
- Desktop 定向 Vitest、typecheck、ESLint、Prettier 与生产 build 通过。
