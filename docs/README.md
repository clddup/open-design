# OpenDesign 文档索引

本文档目录只保留长期有效的产品事实、架构决策、能力范围、路线图和验证记录。临时会话交接、本机路径、PID、一次性调试日志和重复调研不属于仓库长期文档。

## 阅读顺序

1. [`product-and-architecture.md`](product-and-architecture.md)：产品范围、系统边界和目标架构。
2. [`design-capability-baseline.md`](design-capability-baseline.md)：专业设计工具必须覆盖的完整能力与当前状态。
3. [`openpencil-capability-benchmark.md`](openpencil-capability-benchmark.md)：固定上游提交的能力对照、可复用范围与禁止整包接入的边界。
4. [`roadmap.md`](roadmap.md)：按架构依赖排序的当前实施计划。
5. [`verification.md`](verification.md)：最近一次实际执行的自动化、构建和实机验证结果。
6. [`engine-baseline.json`](engine-baseline.json)：机器可读的协议与引擎固定版本。
7. [`adr/`](adr/)：已经接受或被取代的规范决策。

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
| [0012](adr/0012-formal-path-vector-and-visual-review.md)                 | 已接受     | 正式 Path/Vector 语义与可信视觉复核                                |
| [0013](adr/0013-global-gpt-image-generation.md)                          | 已接受     | 全局图片生成服务与 Agent 工具                                      |
| [0014](adr/0014-standalone-global-image-generation-settings.md)          | 已接受     | 生图配置与会话模型配置分离                                         |
| [0015](adr/0015-versioned-design-capability-manifest.md)                 | 已接受     | 版本化能力事实源与生成文档                                         |
| [0016](adr/0016-durable-agent-context-compaction.md)                     | 已接受     | 持久 Conversation 与模型上下文投影压缩                             |
| [0017](adr/0017-model-token-budget-authority.md)                         | 已接受     | Main 注入可信模型预算并区分协议与上下文超限                        |
| [0018](adr/0018-agent-design-plan-and-visual-review.md)                  | 已接受     | 设计计划、截图审查与 refinement 完成门禁                           |
| [0019](adr/0019-versioned-image-placement-and-crop.md)                   | 已接受     | 非破坏图片 placement/crop 与来源替换                               |
| [0020](adr/0020-pi-headless-agent-loop-migration.md)                     | 已接受     | Pi headless Agent loop 与 OpenDesign adapter                       |
| [0021](adr/0021-skia-pathkit-vector-geometry-provider.md)                | 已接受     | 固定 PathKit 矢量 geometry provider                                |
| [0022](adr/0022-versioned-nondestructive-boolean-groups.md)              | 已接受     | 非破坏 Boolean Group 与可丢弃派生结果                              |
| [0023](adr/0023-versioned-svg-interchange-service.md)                    | 已接受     | SVG service、原子导入/导出 planner、Boolean flatten 与保真报告     |
| [0024](adr/0024-versioned-line-arrow-semantics.md)                       | 已接受     | 正式 Line/Arrow、原生端点编辑与受控 SVG marker                     |
| [0025](adr/0025-versioned-polygon-star-semantics.md)                     | 已接受     | 正式 Polygon/Star、确定性几何与受控 SVG 往返                       |
| [0026](adr/0026-versioned-editable-vector-network-and-pen.md)            | 已接受     | 可编辑 Vector Network、Pen 工具与受控 SVG metadata                 |
| [0027](adr/0027-versioned-vector-point-editing.md)                       | 已接受     | Vector 节点、手柄与单轮廓 point mode 编辑                          |
| [0028](adr/0028-agent-generation-presentation.md)                        | 已接受     | Agent 有效阶段、计划骨架、cursor 与节点 reveal                     |
| [0029](adr/0029-contextual-page-structure-approval.md)                   | 已接受     | 默认 Page 目标与按需 Page 结构一次性授权                           |
| [0030](adr/0030-structured-provider-failures-and-run-history.md)         | 已接受     | Provider 结构化失败、超时阶段与历史终态折叠                        |
| [0031](adr/0031-versioned-professional-raster-export.md)                 | 已接受     | PNG/JPEG/WebP 专业导出、离屏 Leafer 与 Main 原生保存               |
| [0032](adr/0032-current-design-file-image-assets.md)                     | 已接受     | 当前 Design File 图片资源与非破坏编辑边界                          |
| [0033](adr/0033-scoped-scss-modules.md)                                  | 已接受     | Renderer SCSS Modules、共享 token 与全局样式边界                   |
| [0034](adr/0034-deterministic-layout-quality-gate.md)                    | 已接受     | exact-revision Frame 布局质量报告与最终交付门禁                    |
| [0035](adr/0035-versioned-text-wrapping-and-overflow.md)                 | 已接受     | 版本化文字换行、溢出与 SVG Text metadata                           |
| [0036](adr/0036-versioned-text-auto-size-and-layout-service.md)          | 已接受     | Text Auto Size 与可替换 Text Layout Service                        |
| [0037](adr/0037-versioned-vector-topology-operations.md)                 | 已接受     | 单轮廓 Open/Close/Reverse 与开放 region 语义                       |
| [0038](adr/0038-versioned-vector-click-cut.md)                           | 已接受     | 点击 Cut、精确 cubic 拆分与互不连接多轮廓编辑                      |
| [0039](adr/0039-versioned-vector-drag-cut.md)                            | 已接受     | 拖拽 Cut、真实闭合连接边与独立结果图层                             |
| [0040](adr/0040-multi-vector-edit-and-document-space-cut.md)             | 已接受     | 多 Vector 编辑集合、文档坐标切线与原子多层 Cut                     |
| [0041](adr/0041-versioned-open-stroke-drag-cut.md)                       | 已接受     | 开放描边多交点 Cut、无闭合分片与 SVG 往返                          |
| [0042](adr/0042-versioned-compound-hole-cut-redistribution.md)           | 已接受     | 复合孔洞 Cut 重分配、有效 loop 方向与 sibling 往返                 |
| [0043](adr/0043-bounded-provider-reconnect.md)                           | 已接受     | Provider SSE 失败有界重连与 attempt 事件隔离                       |
| [0044](adr/0044-versioned-crossed-hole-and-concave-cut.md)               | 已接受     | 穿孔与闭合凹形多交点 Cut                                           |
| [0045](adr/0045-versioned-components-and-instances.md)                   | 已接受     | 版本化 Component Main、Instance、Override 与派生投影               |
| [0046](adr/0046-project-module-boundaries-and-incremental-governance.md) | 已接受     | 项目模块 DAG、进程边界、增长门禁与分阶段治理                       |
| [0047](adr/0047-durable-agent-run-continuation.md)                       | 已接受     | Agent Run 持久续跑、恢复绑定与并发协调                             |
| [0048](adr/0048-provider-agent-compatibility-preflight.md)               | 已接受     | Provider 与 Agent 工具兼容性预检                                   |
| [0049](adr/0049-trusted-generation-order-and-presentation.md)            | 已接受     | 可信生成顺序、真实 revision 步骤与过程呈现                         |
| [0050](adr/0050-allocated-artboards-and-semantic-generation-steps.md)    | 已接受     | 真实画板预分配、allocated ledger 与语义生成步骤                    |
| [0051](adr/0051-frame-constraints-and-responsive-resize.md)              | 已接受     | Frame constraints 与响应式 resize                                  |
| [0052](adr/0052-run-scoped-renderer-circuit-breaker.md)                  | 已接受     | Run 级 Renderer 连续停滞熔断                                       |
| [0053](adr/0053-linear-auto-layout-v1.md)                                | 已接受     | 线性 Auto Layout v1 与事务内自动回流                               |
| [0054](adr/0054-isolated-agent-capture-export.md)                        | 已接受     | Agent 审查截图与 Leafer 全局异步导出队列隔离                       |
