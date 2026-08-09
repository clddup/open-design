# OpenDesign 验证状态

- 日期：2026-08-10
- 环境：macOS arm64、Node.js 24.14.0、pnpm 10.32.1、Electron 43.3.0、Vite 8.2.1
- 文档协议：`DesignDocument 1.1.0`
- 生产画布：`leafer-editor 2.2.9`

本文只记录当前工作树实际执行的证据。计划命令、历史会话结果和第三方能力说明不算通过。

## 自动化门禁

当前工作树通过：

```text
pnpm format:check  passed
pnpm lint          passed
pnpm typecheck     passed（15 个 workspace package 执行 typecheck）
pnpm test          passed
├── package tests  11 files / 83 tests
└── desktop tests  27 files / 165 tests
pnpm build         passed
├── Renderer
├── Electron Main
├── Preload
└── Agent utilityProcess
```

测试覆盖的关键路径包括：

- DesignDocument schema/migration、事务、revision、preview、history、undo/redo、asset 引用安全和 Agent 渐进事务回滚。
- Leafer 文档投影、复杂外观映射，以及“同一选中元素跨 revision 后仍强制刷新 editBox bounds”的回归。
- Workspace/Project/Design File、Conversation、Global Task、Provider Catalog、凭据边界和跨进程对象校验。
- OpenAI Responses、OpenAI Chat Completions、Anthropic Messages canonical adapter 与 tool calling。
- 图片/文档附件、内容识别、完整性、大小限制、多模态 `image_ref`、显式本地路径/HTTP(S) 图片读取和未明示 source 拒绝。
- Renderer Agent 对话、属性检查器、设计工具 scope/revision、取消/继续、i18n 和桌面控件交互。

Node.js 在涉及 `node:sqlite` 的测试中输出 experimental warning；测试仍通过。该 API 的 Electron 长期兼容策略尚未最终确定。

## 构建结果

Vite 生产构建完成四个环境。当前主要输出约为：

| 产物             |        大小 |      gzip |
| ---------------- | ----------: | --------: |
| Renderer 主 JS   |   651.25 kB | 192.59 kB |
| Leafer Web chunk |   302.16 kB | 100.55 kB |
| Electron Main    | 2,030.10 kB | 405.97 kB |
| Preload          |   225.34 kB |  35.70 kB |
| Agent            |   259.29 kB |  45.39 kB |

构建提示 Renderer/Main 存在超过 500 kB 的 chunk。当前不影响构建成功，但需要在性能阶段评估动态加载与 Rolldown code splitting，不能通过移除 sourcemap 或隐藏警告冒充优化。

构建图不包含 OpenPencil、旧 canvas preload、旧 Canvas2D 产品包、CanvasKit/WASM 或隐藏本地设计 server。

## Electron 安全基线

当前代码保持：

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`。
- Preload 暴露窄、类型化且运行时校验的产品 API，不暴露原始 `ipcRenderer`。
- Renderer 导航使用精确开发 origin/打包入口；新窗口默认拒绝，HTTP(S) 外链交给操作系统。
- Provider 凭据由 Main 使用 `safeStorage` 托管；Renderer 和 Agent utilityProcess 不接收密钥。
- 附件由 Main 校验内容、大小、MIME、摘要和存储完整性；utility/model bridge 不接受任意路径或 inline base64。
- 模型设计写入必须经过 typed tool、Main run binding、Renderer scope/revision 校验和唯一 `EditorRuntime.apply()`。

## 仍需实机验证

以下项目没有被本次自动化替代，不能描述成已完成：

1. 在本仓库启动的 Electron 实例中，选中节点并运行多阶段 Agent 事务；持续 pan/zoom/resize，确认 Leafer 蓝色 editBox 始终贴合节点，无巨大角、残影、viewport 锁死或输入丢失。
2. 复杂渐变、光晕、模糊、blend、mask 和高级描边组合的视觉保真。
3. 属性检查器修改后画布同步、文本中文输入法、缩放中的 DOM TextEditor 和焦点恢复。
4. 粘贴/拖放附件、本地路径/URL `read_image` 到真实多模态模型，以及 `place_image` 的完整用户流程。
5. 大节点量、复杂文本、图片/效果的帧率、内存和资源释放基准。

实机验证只能连接明确从当前仓库 `apps/desktop` 启动的实例，不能控制用户的其他 Electron/Chrome 进程或个人浏览器配置。

## 发布验证状态

本次没有重新执行以下发布门禁：

- `build:protected` 与 V8 bytecode startup。
- `package:dir`、ASAR/extraResources 内容审计和 packaged Agent smoke。
- Developer ID 签名、hardened runtime、notarization、DMG/ZIP。
- Windows 与 Linux 原生构建和 protected bytecode。
- 从实际发行物生成的完整第三方许可证清单。

因此当前结果只证明源码门禁与普通生产构建通过，不代表可发布安装包已经完成。
