# ADR-0212：跨进程 Design Tool Wire 单一契约

## 状态

已接受。

## 背景

设计工具的领域输入已经由各工具 Contract 统一，但跨进程 wire 仍在 `@opendesign/agent-contracts` 根入口中并行维护 TypeBox Schema、`Value.Check`、嵌套 `isTrustedXxx()` 和布尔 tool validator。Utility→Main 与 Main→Renderer 两段 bridge 会把原始字段 issue 压成 `/context`、`/result` 或 generic `invalid_tool_request`，模型看不到真正应修复的 `/call/input/...` 路径。根入口同时超过 1800 行，混合 failure、selection、result、event 与 bridge owner。

## 决策

1. `wire-foundations.ts` 唯一拥有跨 Agent wire 的 ID/revision/progress、Selection Scope 与 Mutation Target Schema/Contract；Selection primary node 关系只保留一个 domain refinement。
2. `tool-failure.ts` 唯一拥有 Agent tool issue、transaction/validation/workflow details 与 Run failure 结构；`trusted-tool-result.ts` 唯一拥有 Trusted Failure/Result 结构和 workflow、内容预算、revision/rebase refinement。
3. `tool-bridge.ts` 唯一拥有 Tool Call、Trusted Context、Execution Event 和 Utility↔Main request/cancel/progress/response Contract。Union 先按 `type/ok` 选择真实分支，嵌套领域 issue 保留准确前缀。
4. Tool input边界接收权威工具目录的 `ValidationIssue[]`，不再只接收 boolean validator。`/transaction` 等原始路径在 Utility bridge 中投影为 `/call/input/transaction`。
5. Main 对 Utility 请求只解析一次；非法但可关联的请求返回结构化 `tool-validation` failure，保留 code/path/recovery 并允许模型修正，不再生成无字段路径的 terminal generic error。
6. Main↔Renderer request/response Contract 直接组合同一 Tool Input、Trusted Context、Trusted Failure/Result issues；prepared raster/image material 只保留既有有界内容例外，不绕过 revision 关系。

## 结果

- Utility→Main→Renderer 的同一非法字段保持同一根因和完整嵌套路径，恢复逻辑不再解析 message。
- Tool Execution Event 与两段 response 的 Trusted Result revision/rebase 错误均定位到真实 `/result/designRevision/...`。
- `packages/agent-contracts/src/index.ts` 删除 600 余行 Tool Wire 实现并继续作为兼容导出入口；剩余 Agent Event/Timeline/Request 聚合仍按后续 owner 切片拆分，不能把本次描述为整个根入口重构完成。
- 不增加 Provider 工具数量、产品版本、内容 hash、源码/fixture 数量门禁或旧 boolean 兼容路径。

## 验证

- Tool input、Selection primary node、Page target、unknown field 的准确路径；
- Trusted Failure workflow、Result 内容预算、revision/rebase/observed revision；
- Execution Event 与 Utility bridge request/response union 分支和嵌套路径；
- Main 对非法可关联请求返回结构化可恢复 failure；
- Renderer bridge 输入、context、capture target、prepared raster/image 与 response revision；
- Agent Contracts、Agent Runtime、Desktop typecheck、相关 owner tests 与 Desktop production build。
