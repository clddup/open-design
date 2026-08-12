# ADR-0046：项目级模块边界与增量治理

- 状态：已接受（Phase 1 已实施；后续阶段持续执行）
- 日期：2026-08-12
- 关联：ADR-0001、ADR-0002、ADR-0003、ADR-0005、ADR-0006、ADR-0009、ADR-0033

## 背景

OpenDesign 已按垂直切片建立文档协议、EditorRuntime、Leafer 投影、Agent、Main host、Project 持久化和桌面 UI，但增长主要集中在少数入口和聚合模块。审计时最大的生产模块包括 `packages/leafer-engine/src/adapter.ts`、`apps/desktop/src/shared/design-agent-tools.ts`、Renderer `App.tsx`、SVG service、PropertiesPanel、Geometry vector edit、设计工具执行器、GlobalTaskCoordinator、AgentTimeline、EditorRuntime 和 Main 入口。问题不是某一个文件行数难看，而是职责、状态、异步生命周期和依赖方向可能继续在聚合模块中累积。

一次性重写会同时触碰画布、revision、Agent、持久化和进程边界，风险不可接受；机械按行数拆文件又只会制造互相回调的碎片。治理必须随完整业务切片推进，并用自动门禁防止旧债继续增长。

Figma 的公开产品/API 模型提供了可验证的分层参考，而不是可复制的内部实现：文件按 Document、Page 和 node tree 组织；Main component 与 Instance 分离；Variants、Component Properties、Variables 和 Library 是独立能力层；插件通过受控 node API 操作文档，而不是取得内部渲染引擎。这些边界分别见 [Document/Page 访问](https://developers.figma.com/docs/plugins/accessing-document/)、[Components](https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma)、[Variants](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants)、[Component properties](https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties)、[Variables](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes) 和 [Plugin API](https://developers.figma.com/docs/plugins/api/api-reference/)。OpenDesign 只采用与自身权威文档、权限和跨平台目标一致的产品边界。

## 决策

### 依赖方向是 DAG，不是万能入口

项目遵循下列依赖关系：

```text
Design / Agent / Workspace contracts
          │
          ├──► Geometry / Text / Image / Component / Import-Export services
          │                         │
          ├────────────────────────► EditorRuntime
          │                         │
          └────────────────────────► rendering adapter

typed shared bridge ◄── Main / Preload / Agent process hosts
          │
          └──► Renderer feature controllers ──► workbench views
                        │
                        └──► EditorRuntime + rendering adapter
```

- Contracts 只定义版本化数据、校验和协议，不依赖桌面进程、React 或 Leafer。
- 专业 service 是纯输入输出、诊断或候选 DesignOperation，不持有第二份文档状态。
- EditorRuntime 是文档、revision、history 和事务的唯一权威写入口。
- 渲染 adapter 只投影权威 revision 和管理交互/资源，不向公共契约泄漏 Leafer 对象。
- Main、Preload、Agent 和 Renderer 保持 Electron 进程边界；`shared` 只承载可校验桥契约，不反向依赖任何进程实现或 UI。
- Renderer feature 可以编排 Runtime、adapter 和窄 preload API，但不能直接导入 Electron、Node.js、Main、Agent 或 Preload 实现。

Workspace 生产依赖必须保持无环。新增或改变 `@opendesign/*` 生产依赖需要先判断职责是否属于现有包；若改变上述方向，应通过新 ADR 更新机器基线，不能只让门禁通过。

### Renderer 按 feature 的完整生命周期拆分

`App.tsx` 保留应用壳、顶层资源身份和 feature 组合，不继续拥有每个工作流的局部表单状态、AbortController、原生命令订阅、反馈和错误恢复。一个可提取的 Renderer feature 应同时拥有：

1. 明确输入资源身份和 Runtime，不复制权威文档状态；
2. 本工作流的 draft/operation/feedback 状态；
3. 开始、互斥、取消、卸载和作用域切换生命周期；
4. 结构化诊断与恢复；
5. feature 单测和 App 级集成测试。

View 只接收显式 props 和语义命令。高频画布状态不放入通用 React Context；Renderer 操作开始时从对应唯一 EditorRuntime 冻结 snapshot，不能用可能滞后的 React 镜像代替权威状态。文件变短不是验收标准，只有完整职责和测试一起移动才算完成。

Phase 1 已把人工 SVG 导入、SVG/PNG/JPEG/WebP 导出、设置、反馈、取消和原生命令订阅迁入 `features/import-export`，把 Renderer 诊断工具迁入独立模块。`App.tsx` 只组合该 feature；PropertiesPanel 只消费 feature types/commands。此变更没有增加第二份文档状态或改变导入导出协议。

### 自动边界和增长门禁

`pnpm architecture:check` 是根 `pnpm verify` 的必经步骤，并校验：

- Renderer、Shared、Main、Preload 与 Agent 的禁止跨层导入和 builtin 边界；
- 20 个 workspace 包的生产依赖基线与循环；
- 新生产 TypeScript 模块默认不超过 800 行；
- 当前 28 个历史超大生产模块使用逐文件预算，只能保持或缩小，不能增长。

行数预算是增长报警器，不是代码质量评分。确有单一职责且不可再分的模块可以通过 ADR 调整预算；不得用生成文件、重导出壳、隐藏字符串或多个互相耦合的碎片规避门禁。历史模块完成垂直拆分后，应把其预算降低到实际值或移出例外表。

### 分阶段执行，不做大爆炸重构

后续顺序固定为：

1. Agent Conversation/Timeline projection 与 composer 生命周期；
2. Page、Layer 和 editor command controllers；
3. PropertiesPanel 按 Appearance、Text、Image、Component、Export 业务 section；
4. `design-agent-tools` 按 tool family；
5. Main bootstrap 与 IPC registration；
6. EditorRuntime command executors、diff 与 history 协作；
7. Leafer adapter 的 mapping、interaction、reconcile 与资源生命周期；
8. SVG parser/exporter family。

每阶段只处理一个可验证边界，保留公共入口兼容，先固定现有行为，再移动所有权，补定向测试后运行全仓 verify。架构治理不得夹带协议语义或 UI 行为改写；需要改变产品契约时另开垂直切片和 ADR。

## 后果

- 聚合入口会按真实业务所有权逐步收缩，而不是一次性重写。
- 新代码不能建立跨进程后门、包循环或新的巨型模块。
- 历史 28 个大模块仍然存在，Phase 1 不能描述为全项目治理完成；预算只阻止继续恶化，后续阶段必须实际拆除职责。
- 导入/导出现在具有独立取消和反馈生命周期，并继续从唯一 Runtime snapshot 生成事务或产物。

## 验证

- `pnpm architecture:check`
- Desktop typecheck
- `use-import-export-workflow.test.ts`：最新 Runtime snapshot、native command、JPEG 背景、互斥、切出 editor、unmount 与 cancellation
- `diagnostics.test.ts`、PropertiesPanel 和 App 集成测试
- 全仓 `pnpm verify`
