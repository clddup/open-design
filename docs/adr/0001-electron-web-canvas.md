# ADR-0001：采用 Electron 与 Web 画布

- 状态：已接受
- 日期：2026-08-07

## 背景

OpenDesign 需要同时提供专业桌面集成、快速迭代的工作台 UI 和高交互设计画布。产品以 UI 设计为首要能力，但必须保留通用图形设计的扩展空间，并在 macOS、Windows 和 Linux 上形成一致体验。

候选方案包括纯 Web 应用、完全原生桌面 UI、Tauri 加 Web 前端，以及 Electron 加 Web 画布。纯 Web 难以稳定提供本地文件、进程隔离和桌面集成；完全原生会提高跨平台 UI 与 Agent 生态的开发成本；Tauri 具有体积优势，但当前团队目标更依赖统一的 TypeScript/Electron 进程与工具生态。

## 决策

OpenDesign 采用 Electron 作为桌面外壳，并在 Renderer 中实现 Web 画布与工作台 UI。

- Main 管理窗口、菜单、文件、权限、应用生命周期与受信任进程监督。
- Preload 通过 `contextBridge` 暴露窄且类型化的产品 API。
- Renderer 开启上下文隔离、关闭 Node.js 集成，不接触原始 Electron IPC。
- 画布使用 Web 平台输入与布局能力，连接 OpenDesign 自有编辑器运行时，并通过窄接口使用可替换的低层渲染后端。
- Agent 不运行在 Renderer 或 Main 中；其进程决策由 ADR-0002 定义。

“Web 画布”描述实现平台，不定义视觉风格。应用 UI 必须遵循专业桌面工作台范式，避免表现为浏览器中的营销网站或通用 SaaS 仪表盘。

## 结果

### 正面结果

- TypeScript 可以覆盖桌面 UI、Agent 协议和大部分产品逻辑。
- Chromium 提供成熟的输入、可访问性、文本和开发工具能力。
- Electron 的多进程模型可隔离 Renderer、Main 和 Agent Runtime。
- Web UI 生态有利于快速建立高质量、多面板且可主题化的设计工作台。

### 代价与风险

- 应用体积和基础内存高于部分原生或 Tauri 方案。
- Renderer 与主进程边界需要持续进行 IPC 安全审查。
- Web 控件容易产生“网页感”，需要明确的桌面交互和视觉质量基线。
- 画布性能不能依靠频繁的跨进程细粒度调用，必须批处理事务和事件。

## 约束与验证

- 禁止 `nodeIntegration: true`、暴露原始 `ipcRenderer` 或关闭 Web 安全策略。
- 所有 IPC 输入进行运行时校验，并验证调用方与文档作用域。
- 高频画布操作停留在适合的本地执行边界；跨边界通信采用批量、版本化消息。
- 发布前验证启动时间、空闲内存、长文档交互、键盘导航和各平台窗口行为。

## 复审条件

如果 Electron 无法满足目标平台的安全、性能或分发要求，或者引擎必须采用无法可靠桥接的原生 UI 技术，应重新评估该决策。单纯的包体积差异不足以触发重写。
