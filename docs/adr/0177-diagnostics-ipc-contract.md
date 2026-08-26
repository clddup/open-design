# ADR-0177：Diagnostics IPC 单一契约

状态：已接受

## 背景

Renderer report、Main diagnostic input、持久 Diagnostic Event 与 correlation context 共享同一结构，但原 shared module 以多个 Set、`isRecord`、`hasOnlyKeys`、控制字符、时间戳和嵌套 Agent failure 布尔判断维护 wire shape。该实现把结构规则分散到手写遍历中，且只能返回 true/false，Main IPC、JSONL 与 Renderer 无法共享稳定字段路径。

## 决策

- `DiagnosticContextSchema`、`RendererDiagnosticReportSchema`、`DiagnosticInputSchema` 与 `DiagnosticEventSchema` 是 Diagnostics wire 的唯一结构事实源；exact object、枚举、标识符、消息范围、UTC timestamp 与关联字段由 executable schema 表达。
- 嵌套的 tool failure details 与 run failure 直接组合 `@opendesign/agent-contracts` 的 canonical schemas，不复制 Agent wire 结构，也不再额外调用平行 shape guard。
- `DiagnosticContextContract`、`RendererDiagnosticReportContract`、`DiagnosticInputContract` 与 `DiagnosticEventContract` 统一返回稳定 code/path；现有 `isDiagnosticContext`、`isRendererDiagnosticReport` 和 `isDiagnosticEvent` 仅保留为布尔适配。
- `formatDiagnosticReport` 继续是无状态展示纯函数。迁移不改变日志位置、大小轮转、toast 策略、敏感内容边界、IPC sender 校验或事件版本。

## 验证

Shared contract、Main Diagnostic Host/Log 与 Renderer diagnostics controller/notification 定向测试覆盖合法 report/event、未知 context 字段、非法 timestamp、嵌套 Provider timeout、设计事务 issue 和稳定字段路径。Desktop TypeScript、ESLint、Prettier 与 production build 覆盖该边界。
