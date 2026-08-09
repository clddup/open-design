# OpenDesign 文档索引

本文档目录只保留长期有效的产品事实、架构决策、能力范围、路线图和验证记录。临时会话交接、本机路径、PID、一次性调试日志和重复调研不属于仓库长期文档。

## 阅读顺序

1. [`product-and-architecture.md`](product-and-architecture.md)：产品范围、系统边界和目标架构。
2. [`design-capability-baseline.md`](design-capability-baseline.md)：专业设计工具必须覆盖的完整能力与当前状态。
3. [`roadmap.md`](roadmap.md)：按架构依赖排序的当前实施计划。
4. [`verification.md`](verification.md)：最近一次实际执行的自动化、构建和实机验证结果。
5. [`engine-baseline.json`](engine-baseline.json)：机器可读的协议与引擎固定版本。
6. [`adr/`](adr/)：已经接受或被取代的规范决策。

仓库级开发与安全规则见 [`../AGENTS.md`](../AGENTS.md)，第三方通知见 [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。

## 事实优先级

文档描述与实现冲突时，按以下顺序判断并修正文档：

```text
实际运行行为 → 自动化/构建证据 → 当前代码与配置 → 已接受 ADR → 计划文档
```

- `product-and-architecture.md` 同时包含当前实现和目标架构；目标内容必须明确标注，不能当作已完成能力。
- `design-capability-baseline.md` 定义完整产品边界；“待实现”不代表可以从产品范围中删除。
- `roadmap.md` 可以调整顺序，但不能静默改变已接受 ADR。
- `verification.md` 只记录实际执行结果，不复制未来命令作为通过证据。
- ADR 一旦被后续决策取代，应更新状态和取代关系，保留历史原因，不删除决策记录。

## ADR 索引

| ADR                                                                      | 状态       | 决策                                                               |
| ------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------ |
| [0001](adr/0001-electron-web-canvas.md)                                  | 已接受     | Electron 桌面外壳与 Web 工作台                                     |
| [0002](adr/0002-agent-utility-process.md)                                | 已接受     | Agent 运行于受 Main 监督的 TypeScript `utilityProcess`             |
| [0003](adr/0003-design-engine-adapter.md)                                | 部分被取代 | 版本化 Design Contracts；旧“统一引擎 adapter”范围由 0005/0009 收窄 |
| [0004](adr/0004-agent-open-source-boundaries.md)                         | 已接受     | Agent、MCP、skills 和第三方代码边界                                |
| [0005](adr/0005-opendesign-owned-editor-runtime.md)                      | 部分被取代 | OpenDesign 拥有文档与事务；旧 Canvas2D 决定由 0009 取代            |
| [0006](adr/0006-project-conversation-agent-scope.md)                     | 已接受     | Project、Conversation、Working Set、Mutation Targets 与 Capability |
| [0007](adr/0007-main-hosted-model-provider.md)                           | 已接受     | Main 托管 Provider 调用与凭据                                      |
| [0008](adr/0008-multi-provider-model-catalog.md)                         | 已接受     | 多 Provider Catalog、协议 adapter 与会话模型选择                   |
| [0009](adr/0009-leafer-rendering-and-interaction-engine.md)              | 已接受     | LeaferJS 是唯一生产画布和直接操作引擎                              |
| [0010](adr/0010-open-design-appearance-image-and-reference-semantics.md) | 已接受     | 复杂外观、图片 asset 与多模态引用                                  |
| [0011](adr/0011-professional-design-capability-architecture.md)          | 已接受     | 完整专业能力由 OpenDesign 语义和可替换成熟服务承载                 |
