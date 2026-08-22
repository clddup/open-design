# OpenDesign

OpenDesign 是一个本地优先的 AI-native 通用设计平台。用户既可以直接操作结构化画布，也可以让内置设计 Agent 在明确作用域内读取设计上下文、生成可校验事务并通过同一撤销历史修改设计。

UI 设计是第一个质量标杆，但不是产品边界。文档协议和能力架构同时面向 Logo、海报、品牌物料、社交图片、演示图形及后续设计类型。

OpenDesign 定位为跨平台桌面产品。**macOS 与 Windows 是一级支持平台，两者都必须可安装、启动、编辑、运行 Agent、保存并恢复项目，任一平台不满足门禁都不能视为桌面版本可发布。** Linux 保留在跨平台目标中，但当前阶段不作为发布阻塞项。

## 架构概览

```text
Electron Renderer ── 工作台 / LeaferJS 画布 / EditorRuntime
        │                         │
        │ typed preload API       └── DesignDocument / DesignTransaction
        ▼
Electron Main ─────── Project / 文件 / 凭据 / 策略 / 工具代理
        │
        ▼
Agent utilityProcess ── Conversation / Provider / typed design tools
```

- OpenDesign 拥有唯一可持久化的设计文档、事务、revision、diff、history 和 undo/redo。
- 固定版本 `leafer-editor@2.2.9` 是唯一生产画布与直接操作引擎；Leafer 场景只是当前 revision 的可丢弃投影。
- Renderer 没有 Node.js、原始 IPC、任意文件系统或模型凭据能力。
- Agent、MCP 和人工操作都必须通过版本化设计契约进入同一 `EditorRuntime`。
- Agent 新建设计优先一次提交真实画板根与首个可编辑画面，并基于同一权威 brief 连续完成后续目标；默认快速模式限制主观精修循环，精细模式保留更严格的视觉审查。
- 同一 Project 的 Design File 可以发布和启用 Component 与 Shared Style Library；跨文件 Instance 和 Style 引用继续通过唯一事务、revision 与撤销历史保持链接和更新。
- OpenPencil、旧 Canvas2D 后端和旧通用手写选择框已经从运行时与发行路径移除，不存在 fallback 或双写入口。

## 项目状态

OpenDesign 仍处于早期开发阶段，按专业桌面设计平台的能力依赖顺序持续推进。README 只提供项目入口；当前实现、限制、验证证据和后续顺序分别以[能力事实清单](docs/generated/design-capabilities.md)、[专业能力基线](docs/design-capability-baseline.md)、[验证记录](docs/verification.md)和[路线图](docs/roadmap.md)为准。

## 开发

要求：

- Node.js `>=22.19.0`
- pnpm `10.32.1`（仓库通过 `packageManager` 固定）

```bash
pnpm install
pnpm dev
```

常用验证：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

原生安装包必须在对应操作系统构建和验证，不能用跨平台产物推断可用性：

```bash
# macOS：DMG + ZIP
pnpm --dir apps/desktop package:mac

# Windows：可选择安装目录的 NSIS assisted installer
pnpm --dir apps/desktop package:win
```

原生构建、安装和 smoke 必须在对应操作系统验证；最新证据见[验证记录](docs/verification.md)。

## 仓库结构

```text
apps/desktop/            Electron Main、Preload、Renderer 与 Agent 入口
packages/design-contracts/ 设计文档、事务和运行时 schema
packages/editor-runtime/   权威文档状态、revision、history 与几何查询
packages/leafer-engine/    LeaferJS 场景与直接操作 adapter
packages/library-service/ 同 Project 跨 Design File Library 发布与更新规划
packages/agent-*/          Agent 协议与运行时
packages/model-gateway/    模型 Provider adapter
packages/tool-runtime/     工具策略与执行边界
packages/workspace-contracts/ Workspace/Project/Conversation 契约
packages/ui/               OpenDesign 桌面 UI 公共组件
docs/                      架构、ADR、能力、路线图与验证
```

## 文档

从[文档索引](docs/README.md)开始。架构变更必须通过 ADR；固定引擎与协议版本记录在 [`docs/engine-baseline.json`](docs/engine-baseline.json)，第三方依赖通知见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 数据与安全

用户设计内容默认保留在本地。模型凭据由 Electron Main 使用系统安全存储托管；Renderer 和 Agent utility process 不接收原始凭据。发送给外部模型的数据范围由当前 Conversation/run、附件和工具调用决定，附件与外部内容始终按不可信输入处理。
