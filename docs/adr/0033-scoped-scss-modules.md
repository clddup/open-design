# ADR-0033：Renderer 组件级 SCSS Modules 与全局样式收口

- 状态：已接受（新组件执行；历史全局样式按垂直切片迁移）
- 日期：2026-08-12

## 背景

Renderer 历史上把工作台、画布、Agent、属性面板和业务组件样式集中在一个超过三千行的 `styles.css` 中，只靠全局 BEM 命名避免碰撞。继续追加会放大覆盖顺序、删除影响面、组件所有权和窄窗口回归问题。Sass 预处理能力、CSS Modules 作用域和 CSS-in-JS 运行时方案解决的是不同问题，不能把是否使用其中一个简化为同一选择。

## 决策

新建或实质修改的 Renderer 业务组件采用 Vite 原生 CSS Modules 与固定 Dart Sass 编译器，即 `Component.module.scss`：

- CSS Modules 提供编译期 class 隔离和组件所有权；
- Sass 提供嵌套、partial、mixin 和编译期函数，不引入 Renderer 样式运行时；
- `@opendesign/ui` 继续拥有全局语义 design tokens、基础 primitive 和主题变量；
- 应用级 reset、窗口 shell、跨组件布局契约和确实全局的状态可留在小型全局入口；
- 高频画布几何、splitter 尺寸和动态坐标通过内联 CSS custom properties 传入 module，不通过 CSS-in-JS 重建样式表；
- 不同时引入另一套运行时 CSS-in-JS 方案。若后续需要强类型 recipe/variant，应单独以基准、包体和迁移 ADR 评估编译期方案。

历史 `styles.css` 不做高风险一次性重写。每个功能垂直切片迁出它实际修改的组件样式，并删除对应全局规则；最终全局文件只保留上述允许内容。禁止为了形式拆分成多个仍互相覆盖的全局 `.scss` 文件后宣称完成模块化。

## 结果与验证

- AssetsPanel、Canvas 新增拖放态、完整 LeftSidebar 导航与 PropertiesPanel
  检查器已迁入各自的 `*.module.scss`；Page/图层树、属性编辑、Paint/Effect、
  图片 placement、SVG/Raster 导出反馈和多选排列状态不再依赖全局类名，
  交互测试改用语义 role/label 定位。
- UtilityDock 与 Agent 工作流按职责拆为 `UtilityDock.module.scss`、
  `AgentTimeline.module.scss` 和 `AgentComposer.module.scss`，而不是把所有
  `.agent-*` 机械搬入单一大模块。运行徽标、消息状态、历史终态、流式 caret、
  reasoning、审批、附件与模型选择测试改用结构化 `data-state/data-kind` 或
  accessible role/label，不再把样式类名当业务协议。
- DiagnosticNotifications 使用显式 `placement="editor" | "window"` 选择定位，
  不再通过 `.app-shell > .diagnostic-notifications` 跨组件猜测父容器；Statusbar
  从 App 提取为只接收 persistence/error、selection、revision、zoom 和命令回调的
  展示组件。两者的错误、窄窗口、按钮 focus 与工作台定位进入各自 module。
- 编辑器顶栏按职责拆为 `Titlebar.module.scss`、`Toolbar.module.scss` 和
  `WindowControls.module.scss`。macOS traffic-light 安全区、Electron drag/no-drag、
  Windows minimize/maximize/close、文档保存状态、工具 pressed/disabled/focus 与
  1100/860 像素窄窗口行为仍由原组件拥有；平台测试改用 banner、group 与 accessible
  name，不再依赖全局 `.titlebar` 类名。
- `DesignFileTabs.module.scss` 独立拥有文件 tab 的横向滚动、active、hover、focus、
  重命名 pending/error 和后台 Run 指示状态；组件继续只消费稳定 Workspace snapshot，
  不因样式迁移复制 File/Project/Agent 状态。专项测试覆盖跨 Project 复合身份、键盘
  roving focus、F2/双击重命名、Enter/blur/Escape、失败重试和异步持久化 pending。
- Workspace、Project 与 Settings 原先复制的窗口标题栏已提取为 `HomeTitlebar`；它统一
  拥有 macOS safe zone、Windows native controls、drag/no-drag 和 solid/translucent
  surface variant，不接管页面导航或业务状态。Home 页面样式继续拆为共享
  `HomeSurface.module.scss` 与各自的 `WorkspaceHome.module.scss`、
  `ProjectHome.module.scss`，共享 shell/panel/空态不会迫使两个页面共用业务布局。
- Settings 按所有权拆为 `SettingsPage.module.scss` 与 `SettingsForms.module.scss`：
  前者拥有窗口壳、垂直导航、General 与恢复态，后者拥有 Conversation Provider 和
  独立全局生图配置共用的 field/credential/status/model-list 语义。React draft、保存、
  测试连接与凭据状态仍由原表单单一持有；后续提取组件时必须沿此状态边界移动，不能
  为缩短文件建立第二份 draft。无引用的旧 provider status 样式已删除。
- Canvas 的 Leafer host、context stack、Boolean/Vector edit scope、fidelity warning、
  render error 与 asset drop 已全部归入 `Canvas.module.scss`；依赖 context stack 的
  双击事件隔离使用 module 生成的类名，不再保留裸 selector 协议。旧静态 SVG 样张的
  artboard/nav/hero/card/trust 规则经全仓引用审计后删除，不迁移死样式。
- `sass` 固定为 `1.102.0`，仅用于 Vite 编译期；许可记录进入第三方声明。
- TypeScript 通过 `vite/client` 读取 module 类型，Vite 生产构建验证 SCSS Modules 可编译和合并。
- 后续迁移需保持键盘/焦点、主题、窄窗口、Reduced Motion 和视觉状态测试；仅减少全局行数不构成完成证据。
- PropertiesPanel 当前仍是较大的单文件业务组件；样式收口不等同于组件职责已经
  完成拆分，Paint/Effect、Image placement 与 Export 应在后续功能切片中按各自
  事务边界提取，而不是只为缩短行数做无语义拆分。
- AgentTimeline 当前仍承载 timeline projection 与 composer state；本次样式边界
  已明确，但 React 组件提取必须保持自动滚动、durable/live 合并、附件导入、审批
  和 active Run 生命周期的单一所有者，不能为缩短文件建立第二份状态。
- 历史 `styles.css` 已从 3562 行收口为 93 行，只保留 reset、Electron no-drag、
  visually-hidden、App shell、Workspace grid/窄窗口和全局 Reduced Motion；这些是
  本 ADR 明确允许的全局契约，继续机械迁移不构成收益。
