# OpenDesign

OpenDesign 是一个本地优先的 AI-native 通用设计平台。用户既可以直接操作结构化画布，也可以让内置设计 Agent 在明确作用域内读取设计上下文、生成可校验事务并通过同一撤销历史修改设计。

UI 设计是第一个质量标杆，但不是产品边界。文档协议和能力架构同时面向 Logo、海报、品牌物料、社交图片、演示图形及后续设计类型。

OpenDesign 定位为跨平台桌面产品。**macOS 与 Windows 是一级支持平台，两者都必须可安装、启动、编辑、运行 Agent、保存并恢复项目，任一平台不满足门禁都不能视为桌面版本可发布。** Linux 保留在跨平台目标中，但当前阶段不作为发布阻塞项。

> 当前处于早期开发阶段，不是可发布版本。已实现能力、缺口和验证状态分别以[版本化能力事实清单](docs/generated/design-capabilities.md)、[产品与架构](docs/product-and-architecture.md)、[专业设计能力基线](docs/design-capability-baseline.md)、[路线图](docs/roadmap.md)和[验证状态](docs/verification.md)为准。

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
- OpenPencil、旧 Canvas2D 后端和手写选择框已经从运行时与发行路径移除，不存在 fallback 或双写入口。

## 当前已实现

- Workspace、Project、Design File、Page 与 Layers 的基础工作流和本地持久化。
- `DesignDocument 1.10.0`、正式 Line/Arrow、Polygon/Star、SVG path-data、editable Vector Network、Fixed/Auto Width/Auto Height 文字、换行/溢出、非破坏图片 placement 与 Boolean Group，以及原子事务、单调 revision、preview、undo/redo、checkpoint 和冲突检查。
- LeaferJS 场景投影、pan/zoom、命中、框选、多选、move/resize/rotate/skew 和文本内编辑。
- 多 fill/stroke、渐变、图片 Paint、阴影/光晕/模糊、blend、mask 和事务化图片 asset 的公共语义。
- 持久 Conversation、可取消 Agent run、只管理对话模型的 `ModelProviderCatalog v3`，以及 OpenAI Responses、OpenAI Chat Completions 和 Anthropic Messages adapter；独立的应用级图片生成配置拥有自己的 adapter、Base URL、鉴权、凭据和模型 ID，不受任何 Conversation 模型影响，当前 OpenAI Images adapter 已用 GPT Image 2 验证。
- `get_capabilities`、`inspect_document`、`define_design_plan`、`capture_canvas`、`record_visual_review`、`edit_hierarchy`、`arrange_layers`、`edit_vector`、`apply_transaction`、`read_image`、`generate_image`、`place_image` 和 `update_image` 等 typed tools；Agent 从与帮助文档和发布摘要相同的 manifest 获取能力事实，并可把当前画布预览和生成图片作为多模态结果回读，而不是只凭节点坐标判断视觉质量。
- 图片/文档附件、剪贴板/拖放导入，以及按需读取用户明示本地图片路径、`file:` URL 或 HTTP(S) 图片 URL 的受限链路。

未完成的专业矢量、布局、组件、变量、富文本、导入导出、完整 Capability/Approval/Audit/Sandbox 和跨项目多目标能力不会被描述成已经支持；详见能力基线与路线图。

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

macOS/Windows 原生 workflow 已分别生成安装包并完成打包后 Agent smoke；签名、干净安装、升级/卸载和 GUI 产品 smoke 仍是 P0。当前 NSIS 配置已改为可交互安装并允许选择目录，仍须由最新 commit 的 Windows 原生产物复验，详见[验证状态](docs/verification.md)与[路线图](docs/roadmap.md)。

## 仓库结构

```text
apps/desktop/            Electron Main、Preload、Renderer 与 Agent 入口
packages/design-contracts/ 设计文档、事务和运行时 schema
packages/editor-runtime/   权威文档状态、revision、history 与几何查询
packages/leafer-engine/    LeaferJS 场景与直接操作 adapter
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
