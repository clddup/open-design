# ADR-0046：项目级模块边界与增量治理

- 状态：已接受（Phase 1–5 已实施；Phase 6 进行中）
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

Phase 2 把 Agent Conversation UI 拆成三个明确所有权：`timeline-projection` 纯合并 durable journal 与 live events，`use-agent-composer-controller` 独占每 Conversation 的 draft/附件/model/submit/stop，`AgentComposer` 只负责受控桌面 view；`AgentTimeline` 只组合历史、审批、交付进度和滚动跟随。Conversation epoch 在所有异步成功、失败和 finally 分支校验，旧会话迟到的附件或 submit 不能清空、覆盖新会话。可见 Timeline 不等于模型上下文，也不等于设计文档 revision；三者分别由 session journal/context adapter/EditorRuntime 持有。

该阶段没有把 Page 权限、Renderer tool lease 或 Design Plan 状态放进 React。Run-scoped Page approval 仍由 Agent adapter + Main capability 共同校验；Renderer tool 首响应/空闲/总时限由 Main host 持有；版本化 Plan 与 delivery ledger 由 GlobalTaskCoordinator 持有。UI 只投影这些可信状态。`AgentTimeline.tsx` 从历史 1994 行降至 555 行，所有新 conversation 模块低于 800 行，旧预算已移除。

Phase 3 把人工编辑命令拆成三个层次：`use-editor-command-controller` 是 Renderer 用户事务的唯一入口，每次执行都从 `EditorRuntime` 读取最新 document identity/revision；`use-page-command-controller` 拥有 Page create/rename/duplicate/reorder/delete 的 planner 编排；`use-layer-command-controller` 拥有 Layer capability derivation 以及 duplicate/group/Boolean/reorder/reparent/arrange 的 planner 编排和 selection 结果。controller 不缓存文档或建立 React mirror store，PropertiesPanel 与 LeftSidebar 只共享命令参数/结果类型。复合 Layer 操作仍只产生一条 Runtime transaction 和一条 undo history record；Agent、import/export、component 与 image 写入继续复用同一 `applyCommands` 入口。`App.tsx` 从 Phase 2 的 2882 行降至 2222 行，三个生产 controller 均低于 800 行门禁。

Phase 4 把 Inspector 拆为 Appearance、Paint/Effect、Typography、Image、Component、Export 与 selected-node composition。section 只接收当前权威 `DesignNode`、受控 workflow 设置和语义 callback；`Field`/`TextAreaField` 只保存尚未提交的输入 draft，Component override 只保存当前检查行 key，均不保存 document/node 镜像。属性提交继续由 App 注入的 editor command controller 写入唯一 Runtime；Export operation/settings 继续由 Phase 1 的 import/export workflow 独占。共享控件与 Paint/Effect editor 是无文档所有权的 view primitives，不得反向取得 Runtime。`PropertiesPanel.tsx` 从 2973 行降至 374 行，8 个新生产模块均低于 800 行默认门禁，因此移除其历史超大模块预算。

Phase 5 随 Figma-compatible Component Properties 垂直切片增加 `@opendesign/figma-interop`。该包最初只依赖 Component Service 与 Design Contracts，并只使用固定官方 typings 做编译期公共 API 形状验证；ADR-0083/0084 后为 styled text segments 增加对纯函数 Text Service 的单向依赖。EditorRuntime、Renderer、Leafer 和核心 Contracts 不反向依赖它。新增属性 schema/迁移、Runtime default 同步、Renderer context/plan 和 Main policy 分别进入明确职责模块，`design-agent-tools` 只保留聚合 schema。

模块治理 Phase 5 已按 ADR-0100 完成：`design-agent-tools` 只保留稳定重导出、公开工具的有序聚合和统一 validator dispatcher。Plan/Review/Checkpoint、Image、Import/Export、Hierarchy/Vector、Page/Text/Font、Component 与共享节点事务 schema 各有明确 owner；既有 Arrange、Variable、Style family 不复制 schema。聚合测试直接锁定工具顺序和 schema 对象身份，禁止在聚合入口再次手写同一契约。

Phase 6 的首个切片把 Project、Conversation 与 Project Library 的 22 个 IPC channel 迁入 `project-ipc-registration`，并把 Renderer design-tool progress/resolve 的 2 个 channel 迁入 Agent host 邻近的 registration owner。Main 入口只注入 `ipcMain`、sender validator、动态 `ProjectIpcService` resolver 和唯一 `RendererDesignToolHost`；新 owner 不缓存 service 或 host 状态。sender 校验继续先于参数与 payload 校验，Project service 在每次 invoke 时解析，退出后的旧 service 不能继续使用，stale design response 继续失败关闭。该切片没有改变 shared/preload 契约、IPC 名称、参数数量、返回值或 macOS/Windows 行为。

Phase 6 的第二个切片用唯一 `DesktopWindowHost` 接管 BrowserWindow 实例、创建参数、安全 webPreferences、开发/打包 Renderer 加载、同源导航、外链拒绝、ready-to-show、关闭清理、Renderer sender identity、Main→Renderer 发送、原生窗口动作及 macOS activate 重建。Main 入口只注入 Electron factory、路径、主题、外链和 fixture adapter；字体、原生对话框、Agent、Diagnostics 与 fixture smoke 都从同一 host 解析当前活动窗口，不保存第二个窗口引用。旧窗口迟到的 ready/closed 事件不能显示或清除替代窗口，destroyed window 不再接收发送。application quit/flush、Main service bootstrap 与剩余 IPC family 仍属于未完成的 Phase 6。

### 自动边界门禁与职责治理

`pnpm architecture:check` 是根 `pnpm verify` 的必经步骤，并校验：

- Renderer、Shared、Main、Preload 与 Agent 的禁止跨层导入和 builtin 边界；
- workspace 包的生产依赖基线与循环。

ADR-0086 已退休默认 800 行和历史逐文件行数预算：连续切片证明它需要机械抬高基线、不能判断职责耦合，还会在真正的 lint/typecheck/test/package 前制造噪声失败。模块治理仍按完整业务所有权、状态和生命周期执行；不得用生成文件、重导出壳、隐藏字符串或多个互相耦合的碎片伪装拆分。依赖方向、进程边界和循环检查继续是硬门禁。

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
- 历史大模块仍然存在，Phase 1–5 和 Phase 6 已完成的 IPC/BrowserWindow 切片不能描述为全项目治理完成；后续阶段必须继续实际拆除职责。
- 导入/导出现在具有独立取消和反馈生命周期，并继续从唯一 Runtime snapshot 生成事务或产物。
- Page 与 Layer view 不再直接拥有 planner/transaction 编排；新增人工编辑命令应进入对应 controller 或新的完整业务 controller，不应重新堆回 `App.tsx`。
- Inspector section 不拥有 Runtime 或文档副本；新增 property family 应进入对应 section，通过现有语义 callback 提交，不能重新堆回顶层 `PropertiesPanel.tsx`。
- Agent tool family 自己拥有类型、schema、validator 与必要的纯投影；`design-agent-tools` 只聚合公开契约和分发校验。跨 family 共用的节点操作 schema 进入无状态 schema primitives，不能复制，也不能取得 Runtime、文档或 Electron 能力。

## 验证

- `pnpm architecture:check`
- Desktop typecheck
- `use-import-export-workflow.test.ts`：最新 Runtime snapshot、native command、JPEG 背景、互斥、切出 editor、unmount 与 cancellation
- `diagnostics.test.ts`、PropertiesPanel 和 App 集成测试：Typography 模式约束、Image placement、Paint/Effect、Component override、SVG/raster export、多选排列以及唯一 Runtime 提交链
- `AgentTimeline.test.tsx`：durable/live 单调投影、近底自动滚动、审批、取消、历史终态与 Conversation epoch 竞态
- `editor-command-controllers.test.tsx`：唯一 Runtime 写入、Page 操作、Layer capability、复合事务、selection 与 undo
- `project-ipc-registration.test.ts`、`project-ipc.test.ts`、`renderer-design-tool-ipc.test.ts` 与 `renderer-design-tool-host.test.ts`：完整 channel 映射、sender/argument/payload 校验顺序、动态 service 生命周期和 stale response
- `desktop-window-host.test.ts`、`navigation-policy.test.ts`、`renderer-url.test.ts`、`application-lifecycle.test.ts` 与相邻字体/fixture smoke 测试：安全窗口配置、开发/打包加载、导航/外链、Renderer identity、窗口动作、关闭和双平台最后窗口策略
- Agent Runtime/Main/Renderer 定向测试：Run-scoped approval、Renderer 活动租约、版本化 Plan amendment 与 Text content 规范化
- 全仓 `pnpm verify`
