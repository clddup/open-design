# ADR-0173：Renderer Design Tool Bridge 单一契约

## 状态

部分被 ADR-0302 取代。Bridge envelope、Trusted Context、capture target、response 与 correlation 继续有效；工具语义输入改由 Main 单次解析，bridge 不再重复执行工具 Contract。

## 背景

公开与 internal 设计工具输入已经迁入 `defineContract / validateContract`，但 Main ↔ Preload ↔ Renderer 的 design-tool bridge 仍为 Request、Cancel、Progress、Response 分别维护 `record()`、`safeId()`、exact-key、union、数值范围和 capture target 手写判断。

该 bridge 是所有设计事务、capture、prepared Raster bytes 和图片编辑源的可信跨进程入口。工具输入已经通过权威 Contract，并不代表外围 request/context/correlation/performance/result envelope 可以继续由另一套结构事实维护。

## 决策

1. `design-tool-bridge.ts` 为四类消息分别建立唯一可执行 Schema 与 Contract：
   - Request：request ID、`ToolCallRequestSchema`、`TrustedToolContextSchema` 与可选 Page/Frame capture target；
   - Cancel：唯一 request ID；
   - Progress：固定 phase、`0..1` progress 与有界 message；
   - Response：以 `ok` 为 discriminant 的 Trusted result/failure union 与有界 performance。
2. 所有结构字段、required、unknown key、union、字符串和数值范围只由 Schema 定义；旧 `record/safeId/safeText/boundedPerformanceInteger/isRendererDesignCaptureTarget` 删除。
3. Request 只保留三个 domain refinements：
   - `call.input` 必须通过注册工具自己的权威 Contract；
   - Trusted context 必须满足 selection/mutation-target 关系；
   - capture tool 必须且只有它可以携带 Main-selected capture target。
4. Response 只保留 Trusted result/failure 领域 invariant。Prepared Raster bytes 与 prepared image-edit source 继续使用各自 typed validator，并在验证通用 revision envelope 时把 binary content 投影为 `null`；不对大字节执行 structured clone，也不放宽其他 result。
5. Quality Profile 直接复用权威 JSON Schema，并通过 `executableJsonSchema()` 在嵌套 Request schema 上恢复 TypeBox runtime metadata；不复制 UI safe-area/platform 结构。
6. Preload、Main IPC 和 Renderer 继续消费现有 `isRendererDesignTool*` type guard，但这些 guard 现在只调用对应 Contract，不保留 fallback 或双校验。
7. 不改变 channel、消息形状、request correlation、capture target、prepared material、performance、revision、取消或错误语义。

## 结果

- Renderer design-tool bridge 的四类 envelope 各有一个结构事实源和一个验证入口。
- 工具输入、Trusted context 与 prepared material 只在其权威领域层判定，不与 envelope shape 混写。
- 未知字段和错误 union 在进入 Preload/Main/Renderer handler 前一致拒绝。
- 单一契约迁移继续处理其余 Main/Preload IPC、Provider、Agent Event 与持久化边界。

## 验证

- Bridge 测试覆盖 request identity/cancel、progress、capture discriminant/quality profile、公开与 internal tool input、prepared Raster/Image content、planned rebase、performance 和结构化 failure。
- Main Renderer host/IPC 测试证明发送、进度、响应和失败 correlation 不变。
- Desktop typecheck、定向 ESLint、Prettier 与 production build 通过。
