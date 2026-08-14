# ADR-0073：Agent 工具渐进披露与轻量首稿事务

- 状态：Accepted
- 日期：2026-08-15
- 文档协议：不变（`DesignDocument 1.28.0`）
- 关联：ADR-0016、ADR-0020、ADR-0048、ADR-0050、ADR-0072
- 参考：OpenPencil compact `batch_design`、segmented design prompt 与 layered design workflow

## 背景

OpenDesign 的专业能力持续增加后，生产 Agent 每轮都会把二十一个工具及完整 schema 发送给 Provider。当前模型可见完整 catalog 约 `148,350 bytes`；其中 `opendesign_apply_transaction` 约 `63,924 bytes`，Component 工具约 `25 KB`，Arrange 工具约 `11 KB`。这些能力对最终专业交付有价值，但一个简单新页面在 inspect、Plan 和首稿之前并不需要 Component Set、Variables、Vector Cut、专业导出或完整节点联合类型。

本机生产 journal 已证明 Renderer 不是主要等待源。`run_1786736509705_auto_1` 的自动续跑约 8 分钟，`T_plan=308.6s / T1=385.2s`；11 次 Provider 尝试累计约 435 秒，而 Renderer 10 次调用累计约 6.4 秒。此前 ADR-0072 限制了无进展恢复放大，却没有减少每次 Provider 请求携带的固定协议，也没有限制模型在首稿前面对的工具选择空间。

OpenPencil 的可借鉴点不是放宽 OpenDesign 的文件、权限或文档边界，而是用 compact batch、高层生成入口、分段 prompt 与 layered workflow 避免让每个阶段承担整个编辑器 API。OpenDesign 需要把这一原则转译到自己的 typed transaction、revision 和 Main policy 中，而不是重新引入第二套 DSL 执行器或让模型直接写文档。

## 决策

### 一个 catalog，两种模型可见视图

`AgentToolDefinition.modelDisclosure` 只声明 Provider 可见视图：

- `bootstrap: available | deferred` 决定工具是否进入轻量阶段；
- `role: inspection | plan | material-write` 提供可信阶段证据；
- `bootstrapDescription/bootstrapInputSchema` 可为同一工具提供更窄的模型契约。

它不创建第二个 executor，不授予 Capability，不改变 approval，也不替代完整 `validateInput`。Pi 对 bootstrap schema 做第一层参数验证后，调用的仍是原始 trusted definition、Main tool host 和唯一 `EditorRuntime`；执行前仍再次通过完整运行时校验。

### 初始 Bootstrap 固定为七个必要工具

新 Run 初始只向 Provider 暴露：

1. `opendesign_inspect_document`
2. `opendesign_define_design_plan`
3. `opendesign_read_image`
4. `opendesign_generate_image`
5. `opendesign_request_page_structure_access`
6. `opendesign_manage_pages`
7. `opendesign_apply_transaction` 的基础视图

当前七工具 canonical 请求约 `22,369 bytes`，相对完整二十一工具约 `148,350 bytes` 减少 `84.9%`。这是静态协议大小证据，不等同于真实 Provider 延迟已经同比下降。

成功 inspection 后进入仍然轻量的十工具视图，约 `26,732 bytes`。它只额外加入 `opendesign_get_capabilities`、`opendesign_export_svg` 与 `opendesign_export_raster`，保证纯能力查询和“inspect → export”不需要制造设计写入；Capture、Review、Component、Layout、Vector、Image mutation、Style 与 Variable 继续延后。

基础 apply schema 约 `7,087 bytes`，只覆盖 Frame、Group、Rectangle、Ellipse、Text、solid paint，以及 insert、基础 property update、move、delete；完整 schema 约 `63,924 bytes`。首稿可先提交导航、Hero、核心标志或主内容等最小有意义可编辑区域。它不接受 Path/Vector、Image asset、effect、Instance 或 replace_subtree；这些在真实首稿 revision 后由完整工具处理。

### 阶段切换由成功事实驱动

- inspection 后只进入十工具轻量视图，避免一次只调用一个工具的 Provider 在 Plan 轮重新承担完整 catalog，同时允许只读能力查询和显式导出；
- `artboard.mode=create` Plan 的真实 Frame allocation 是结构事实但不是材料内容，仍保持 bootstrap；
- 任一 `material-write` 角色工具成功返回 design revision 后，下一 Provider turn 使用完整二十一工具和完整 apply schema；
- Page lifecycle 是独立真实文档写入，成功后同样展开；
- `artboard.mode=existing` Plan 接受后直接展开，因为修改现有设计的第一笔合法写入可能就是 hierarchy、arrange、component、vector 或 image 专用操作；
- failed tool、inspection observed revision、Provider prose、Plan allocation 和可丢弃动画都不能冒充首个材料 revision。

同一 assistant turn 可以按顺序调用 Plan 与 bootstrap apply；Pi 继续串行执行并在工具之间推进可信 revision。即使 Provider 每轮只调用一个工具，初始 inspect、create Plan 和首稿三轮也保持七/十工具轻量协议。

### 动态上下文预算

工具视图变化时，Pi context adapter 必须以当前 canonical tools 重新计算 fixed protocol budget。完整视图不适配所选 Model Profile 时，在下一次 Provider I/O 前返回 `model_context_incompatible`，不能继续使用 bootstrap 预算或靠截断 Conversation 掩盖固定协议过大。

## 后果

- 专业能力继续存在，但不再对简单任务的每次早期请求征收固定 schema 成本。
- 首个真实画面仍只来自成功 `DesignTransaction`；没有 skeleton、partial JSON 或聊天进度旁路。
- Bootstrap 图形不是最终质量上限。首稿 revision 后完整 Vector、Component、Layout、Style、Variable、Image 和导出工具恢复，capture/review/refinement 门禁不变。
- 现有模型修改流程由 existing-artboard Plan 解锁完整工具，不需要制造一笔无意义基础写入。
- 当前尚未实现 OpenPencil 式并行 section agents、流式半事务解析或新的通用 DSL；这些不能从本 ADR 推断。

## 验证

- 生产 catalog 测试证明首轮只有七工具，inspection 后只增加 Capability/SVG Export/Raster Export 至十工具，两个阶段均不暴露 Component/Capture/Review，bootstrap 请求小于完整 canonical catalog 的五分之一，且 apply 使用基础 schema；
- Runtime 测试证明 create Plan revision 不展开、材料 revision 后恢复全部工具，existing-artboard Plan 后展开；
- Context 测试证明展开后重新预算，并在完整固定协议超出模型窗口时返回 `model_context_incompatible`；
- 完整二十一工具 adapter、完整 apply schema、validation、approval、revision 与现有生产 context loop 测试继续通过；
- 真实收益仍需使用打包产品重新采集 macOS/Windows、Grok/GLM/Codex 的固定 `1/4/12` target `T_plan/T1/T2/T_all` 样本。
