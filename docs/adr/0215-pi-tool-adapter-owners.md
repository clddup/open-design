# ADR-0215：Pi Tool Adapter 热路径 Owner

## 状态

已接受。

## 背景

`pi-tool-adapter.ts` 超过 1000 行，同时负责 Provider 工具面、active call、重复调用、预算、输入失败、审批、可信执行、progress、revision、恢复 circuit 与终态投影。虽然每个设计工具输入已经复用 canonical Contract，但这些运行时职责集中在同一类中，修改一种生命周期容易影响其余阶段，也使“工具数量是否过多”和“单个 Adapter 是否过度聚合”被错误混为一谈。

公开设计工具注册表当前包含多个原子语义，但 Provider 通过 bootstrap、host-inspected、inspected、continuation 与 expanded 分阶段取得窄工具面；internal route 从不进入 Provider catalog。没有证据表明把事务、图片、页面、字体和导出机械合成一个巨型 union 能改善速度或合法输入率。

## 决策

1. `PiToolSurfaceCatalog` 唯一拥有安全定义、execution definition 与各阶段 model-visible view，Adapter 不再维护六份工具数组和定义 Map。
2. `PiToolCallTracker` 唯一拥有 active/seen/failure、重复调用、tool budget、progress 投影、acknowledge 与 pending terminal 顺序。
3. `requestPiToolApproval` 唯一拥有 approval request/resolution、run-scope 记忆决策和 deny/cancel 结果；Adapter 只应用返回的 stop state。
4. `executeTrustedPiTool` 只消费 Trusted Executor event stream；`projectPiToolSuccess` 与 terminal success projector 统一 revision correlation、model projection、record 和 typed details。
5. `pi-tool-protocol.ts` 集中 Pi 内部 progress/result/failure 文本与 canonical Contract issue 投影；同一模型输入仍只调用 `AgentToolDefinition.validateInputIssues`，不新增第二份结构规则。
6. 主 Adapter 只协调恢复 circuit、current revision、records 与上述 owner。公开导入继续由原路径 re-export，不保留旧实现或兼容双写。
7. 本切片不增删公开工具，不增加产品版本、内容 hash、源码数量或工具数量门禁。是否继续合并某个工具族，必须以实际 Provider-visible schema token、工具误选和失败 telemetry 为依据。

## 结果

- `pi-tool-adapter.ts` 从 1076 行降至 495 行；所有新增 owner 均低于 500 行。
- 工具定义、执行权限、approval、progress、revision、失败恢复和模型可见结果行为保持不变。
- 工具“注册数量”与“每轮模型可见数量”继续分开建模，避免用一个万能工具掩盖复杂度。

## 验证

- Agent Runtime 与 Desktop typecheck；
- Agent Runtime 全部 tests；
- Desktop production context budget 与 Pi production tool adapter tests；
- Desktop production build 与 Renderer bundle 模块数。
