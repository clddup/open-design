# ADR-0005：OpenDesign 自有编辑器运行时与可替换渲染后端

- 状态：部分被 ADR-0009 取代
- 日期：2026-08-07
- 取代：ADR-0003 中“OpenPencil/Jian 作为首个编辑器适配器与行为基线”的部分决定
- 后续：ADR-0009 保留 OpenDesign 文档/事务/history 所有权，但把生产渲染、viewport、命中、选择和直接操作迁移到 LeaferJS 适配器

## 背景

早期兼容原型通过 Electron `WebContentsView` 嵌入完整 OpenPencil Web 编辑器。该方案验证了上游程序可以启动、保存和打包，但同时带入第二套页面、图层、工具栏、属性面板、文档状态和历史。OpenDesign 的 React 工作台只持有一份演示状态，无法控制真正画布。

`@open-pencil/core` 虽然提供框架无关 API，但仍同时拥有文档模型、scene graph、选择、工具、历史、布局和 IO。将其作为内核只会隐藏依赖，不能让 OpenDesign 独立演进 Agent 事务、revision、diff、组件、变量和未来设计类型。

OpenDesign 可以使用成熟的开源底层算法，但产品核心不能依附另一个完整编辑器。

## 决策

OpenDesign 自己实现并拥有以下能力：

- 版本化设计文档、稳定节点 ID、schema 迁移和结构不变量。
- 唯一 mutation bus、原子事务、单调 revision、diff、checkpoint、undo/redo 和 dirty state。
- selection、tool 与 viewport 的产品 session state；具体输入、坐标转换、命中、选择器和交互预览已由 ADR-0009 迁移到 LeaferJS。
- 组件、实例、变量、布局、资源和 prototype 等逐步扩展的产品语义。
- 人工、Agent、MCP、属性面板和导入器共用的命令与事件协议。

首版 `EditorRuntime` 位于 Electron Renderer，独立于 React。React 通过稳定快照和订阅读取状态；高频指针交互不跨进程。Main 只负责受信任文件能力和跨进程调度，Agent 继续运行在 `utilityProcess`。

本 ADR 原先决定采用后端无关 display list 与 Canvas2D 生产后端；该部分已被 ADR-0009 取代。当前生产路径由 LeaferJS 适配器投影 OpenDesign 文档，并负责渲染与直接操作。保留不变的是：渲染/交互引擎不拥有持久化文档、history、revision、Agent 或文件格式，其类型不得越过 adapter 包。

## 一致性原则

所有成功文档写入产生一个新 revision。事务失败不改变文档、历史或可观察事件。Undo 和 redo 应用反向或正向 change set，并各自产生新 revision，不能把 revision 数字倒退。

Selection、tool、viewport 和 hover 属于 editor session state，不写入设计文档，也不增加文档 revision。拖动中的状态是临时 interaction preview，结束时最多提交一个文档事务。

Agent 与 MCP 不获得 runtime 原始句柄。它们生成经 schema 校验的事务，由 Tool Runtime 完成策略、同意与审计，再由受信任主机转交活动文档的 `EditorRuntime`。Renderer 在提交前再次校验 document ID 与 base revision。

## 迁移

在自有 runtime 完成 create、edit、undo/redo、save/reopen 与 packaged smoke 后，删除原型中的：

- OpenPencil server、iframe wrapper、custom protocol 与 `WebContentsView`。
- Canvas preload、bounds/bridge IPC 和旧 smoke。
- OpenPencil/Jian 子模块、发行资源和不再适用的第三方声明。

迁移期不得让旧编辑器和新 runtime 同时成为产品入口。默认入口切换后，旧路径只允许短期作为显式兼容诊断存在，并必须在同一迁移阶段清理。

## 结果

### 正面结果

- 结构化文档而非第三方编辑器对象成为唯一事实来源。
- Canvas、Layers、Properties、Agent 和 MCP 可以共享同一事务与 revision。
- 产品语义和文件格式可以独立演进。
- 低层渲染库可升级或替换，而不改变公共设计协议。
- 直接 Renderer canvas 不再被原生子视图遮挡，React 浮层和焦点行为恢复为普通 DOM 语义。

### 代价与风险

- OpenDesign 必须自行实现并测试编辑器运行时、历史、事务桥和文档迁移；输入、viewport、命中与直接操作由 LeaferJS 承担。
- 首轮能力少于完整上游编辑器，未支持能力必须通过 capabilities 和结构化错误如实报告。
- 文本塑形、复杂路径和高性能渲染仍需要受控的底层依赖与视觉回归测试。

## 验证

- Contract tests 覆盖事务回滚、冲突、幂等、undo/redo、事件顺序与 editor state 隔离。
- Renderer tests 覆盖 Leafer 选择/viewport/手势事务桥，以及 Canvas/Layers/Properties 同步；引擎交互在真实 Electron 中复验。
- 文件测试覆盖原子保存、损坏输入、迁移、dirty state 和重开。
- 打包验证必须在没有 `vendor/openpencil` 与 OpenPencil server 资源时通过。
- 依赖审计必须证明具体后端类型只存在于对应 adapter 包；未经基准证据批准时，依赖图与发行资产中不得出现 CanvasKit。
