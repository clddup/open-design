# OpenDesign 验证状态

- 日期：2026-08-10
- 环境：macOS arm64、Node.js 24.14.0、pnpm 10.32.1、Electron 43.3.0、Vite 8.2.1
- 文档协议：`DesignDocument 1.2.0`
- 生产画布：`leafer-editor 2.2.9`

本文只记录当前工作树实际执行的证据。计划命令、历史会话结果和第三方能力说明不算通过。

## 平台支持矩阵

| 平台    | 产品级别 | 当前证据                                                                                                          | 发布状态       |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------- | -------------- |
| macOS   | 一级支持 | arm64 verify、protected Vite build、未签名 DMG/ZIP、bytecode 与包内容检查通过；安装、签名和 packaged smoke 未验证 | 未达到发布门禁 |
| Windows | 一级支持 | 已配置 Windows 原生 workflow、NSIS、直接 packaged executable smoke 与包内容检查；尚无 runner 执行证据             | **P0 阻塞**    |
| Linux   | 目标平台 | 保留 electron-builder 配置，当前无原生验证                                                                        | 当前阶段不阻塞 |

macOS 与 Windows 必须在同一待发布 commit 上分别完成原生验证。Electron、TypeScript 和共享测试通过不等于另一操作系统可用，protected V8 bytecode 也不能跨系统构建后复用。

## 自动化门禁

当前工作树通过：

```text
pnpm format:check  passed
pnpm fixtures:check passed（7 个生成文件）
pnpm lint          passed
pnpm typecheck     passed（16 个 workspace package 执行 typecheck）
pnpm test          passed
├── package tests  15 files / 119 tests
└── desktop tests  35 files / 225 tests
pnpm build         passed
├── Renderer
├── Electron Main
├── Preload
└── Agent utilityProcess
```

测试覆盖的关键路径包括：

- DesignDocument 1.2 schema/migration、正式 Path/Vector 外观、事务、revision、preview、history、undo/redo、asset 引用安全和 Agent 渐进事务回滚。
- `DesignCapabilityManifest v1` 的严格字段、唯一 ID、六表面状态、证据派生与不可变快照；Agent system context、只读 `get_capabilities` tool、生成式帮助文档和发布摘要读取同一 JSON，`capabilities:check` 会拒绝文档漂移。
- `inspect_document` 不把 image asset 的 data URI 或外部 URI 放入模型上下文；Agent Runtime 会同时压缩当前轮和旧 journal 中意外出现的超长工具字段，避免图片文档在下一轮触发 `context_too_large`。
- Agent Runtime 在完整 run 边界生成累计 `context.compacted` checkpoint；测试覆盖原始 Timeline 不删除、checkpoint 范围单调增加、旧全文退出模型投影，以及单次输入或当前 Run 工具结果在任一后续轮仍超预算时，在对应 Provider I/O 前返回 `context_budget_exceeded`。固定 system/tool 协议与 Conversation 分账，Main 从可信 Model Profile 注入窗口和输出预算；固定协议无法适配小窗口时返回独立的 `model_context_incompatible`。
- `OD-PENGUIN-01` 与 `OD-POSTER-01` 专业 fixture 从固定 prompt 生成初稿、refinement 事务、最终 `.opendesign` 和 SHA-256 manifest；`fixtures:check` 阻止生成物漂移。EditorRuntime 测试验证命名 Group、主体/翅膀/脚/围巾正式 Path、1440×1024 海报画板、复杂特性下限、零结构诊断、JSON 保存重开及 apply/undo/redo；Leafer 测试验证所有权威节点可达、Path/渐变/效果/mask/内嵌图片映射且没有 fidelity warning。
- EditorRuntime 设计预检覆盖 Path/渐变/光晕/模糊/blend/mask/图片/文字特性计数，以及空内容、不可见/无外观、缺失或不受支持图片源、非有限 bounds、clipping Frame 完全越界和根层碎片；同一报告经 `inspect_document` 交给 Agent。
- Leafer 文档投影、Path 实例、复杂外观映射和 change-set 增量同步：未变节点保持 spec/元素 identity，不调用 `set()`；无关新增、删除和 revision 不刷新 tree/Editor，也不取消进行中的直接操作；选中节点变化只刷新该元素 bounds 并更新 editBox；asset change 会精确重投影引用节点。
- Workspace/Project/Design File、Conversation、Global Task、Provider Catalog v3/v1/v2 迁移、独立 `GlobalImageGenerationSettings v1`、两套凭据隔离和跨进程对象校验。
- OpenAI Responses、OpenAI Chat Completions、Anthropic Messages canonical adapter 与 tool calling。
- 生产 Provider stream 的首响应、空闲和总时限 watchdog 会 abort 实际 fetch；timeout 与 Agent process exit 都会解除 Renderer active Run、恢复可编辑输入并显示可重试错误。
- 完整生产设计工具契约会穿过 Agent→Main model bridge 的真实守卫；守卫分别限制单工具 schema 和集合总大小。生产回归还使用完整 system prompt、七个工具、200K Model Profile 和短消息证明 Provider 确实被调用。模型可见 `apply_transaction` Schema 为 25,222 字符且不依赖 `$ref/$defs`，本地仍用完整 `DesignOperationSchema` 校验。模型桥、畸形 Agent 事件与无 run ID 的进程错误会变成可见终态；设计工具桥拒绝会变成回给模型的 `tool.failed`，两者都不再只写日志后让 UI 永久等待。
- 工具执行、业务校验和设计工具桥失败会作为 `tool.failed` 回到下一轮模型上下文供其重试或解释；模型桥、Provider、Agent 进程/协议和可信 Run binding 失败才会取消 Run。两类路径分别有“继续第二个模型回合”和“相关 Run 终结/解锁”测试。
- JSONL 启动恢复会一次性终结孤立 started Run 和 pending tool；Global Task 同步转为 interrupted。Conversation 在 Run 注册和后续 Agent 活动时更新持久 `updatedAt`，Renderer 立即按最近活动重排。
- Main-owned 诊断事件经过严格跨进程校验，按大小轮转写入 JSONL，且不接受任意上下文字段；右下角错误通知会显示稳定错误码和关联 Run，并复制包含 Conversation/Run/Request/Tool Call ID、应用版本和平台的诊断文本。
- 图片/文档附件、内容识别、完整性、大小限制、多模态 `image_ref`、显式本地路径/HTTP(S) 图片读取和未明示 source 拒绝；远程 body stream 的 15 秒超时、用户取消和流式超过 16 MB 均覆盖到 reader 生命周期。
- `openai-images` adapter 只使用独立应用级配置的 Base URL、鉴权、凭据和任意 model ID 调用 `/images/generations`，GPT Image 2 是首个验证模型；链路校验 `data[0].b64_json`、响应/图片大小、格式、凭据和取消。tool schema 不接受 Provider/Model 覆盖，也不会借用 Conversation Provider；旧 v2 选择和密文迁移已有回归测试。
- Renderer Agent 对话、属性检查器、设计工具 selection context / Mutation Target / revision、`capture_canvas` 内容寻址多模态结果、取消/继续、i18n 和桌面控件交互；对话在底部时跟随新消息与状态，用户上翻后保持阅读位置，回到底部后恢复跟随；剪贴板文件与拖放文件经 Preload API 导入，run 只接收安全附件元数据，纯文本路径粘贴保持普通输入行为。
- host-only 图片放置以单个 Page-targeted `put_asset + insert_element(image)` 事务进入 `EditorRuntime`；测试验证单次 revision、发送时存在选区也能在固定 Page 新增 asset/node、当前活动页面变化不漂移目标，以及一次 undo 同时移除 asset/node。

Node.js 在涉及 `node:sqlite` 的测试中输出 experimental warning；测试仍通过。该 API 的 Electron 长期兼容策略尚未最终确定。

## 已配置模型 API 烟测

本次另用无窗口 Electron harness 直接复用 Main 的 `ModelProviderHost`、`safeStorage` 和用户现有 `gpt-5.6-sol` / OpenAI Responses 配置完成一次真实两轮 API 调用；harness 与工作数据库副本均不进入仓库，未打开或控制任何 OpenDesign 窗口。

- 临时会话预置 12 个完整历史 Run，并让当前 `opendesign_inspect_document` 返回含 1,617,290 字符合成 data URI 的原始工具结果。
- Runtime 生成累计 checkpoint `fromSequence=1 / toSequence=18`，摘要 3,974 字符；原始 journal 仍保留完整工具结果。
- 实际送入 Provider 的两轮序列化上下文分别为 225,425 和 226,483 字符，均包含 checkpoint、均不包含 `data:image`，最大单字段为 12,011 字符。
- 两个 Provider attempt 均正常完成；Run 以 `complete` 终结，无 `agent.error`，第二轮正确返回“图片图层 1、诊断错误 0、revision 147”。

该证据复现并通过了原故障的关键边界：旧历史压缩 → 检查工具 → 超长图片字段本地剥离 → 第二轮真实模型响应。它不替代 Renderer 中粘贴/拖放、真实图片附件视觉理解或完整设计事务的后续实机验证。

## 专业设计就绪度审计

当前 `DesignCapabilityManifest v1` 记录 0 项完整可用、8 项降级可用和 8 项不可用能力；没有实机证据的能力不会标记为完整可用。`DesignDocument 1.2.0`、EditorRuntime、Leafer adapter、属性检查器和 Agent tools 已经打通 Path/Vector、主要外观、图片读取、全局生图、图片放置和视觉复核的基础路径。两个固定专业 fixture 进一步证明这些语义可以组成完整企鹅层级和复杂海报文档，而不是只能稳定使用椭圆和矩形；它们尚未提供真实 Electron 像素截图、Agent 重放或专业导出，因此不能据此把完整工作流标为可用。

仓库当前没有独立的 Geometry、Layout、Text/Font、Image 或 Import/Export service 包。`packages/editor-runtime/src/geometry.ts` 只提供矩阵、坐标转换和 bounds 计算，不包含 Pen 节点编辑、布尔运算、flatten、outline stroke、吸附或路径诊断；组件、Variant 和 Token 仍为占位数据，专业导出也没有可达产品路径。图片链当前只支持分析参考图、生成新图和放置；AI 局部重绘、扩图、背景替换、重打光、风格统一和派生 asset 来源关系均明确标记为不可用。

Agent Runtime 当前强制执行“实质写入 → `capture_canvas` → refinement → `capture_canvas`”，但截图次数不能单独保证审美、图层结构、文字可读性或交付保真。后续交付必须按照 [`roadmap.md`](roadmap.md) 的固定样张、capability manifest、专业 service 和结构/渲染诊断门禁推进。

## 构建结果

Vite 生产构建完成四个环境。当前主要输出约为：

| 产物             |        大小 |      gzip |
| ---------------- | ----------: | --------: |
| Renderer 主 JS   |   684.10 kB | 201.25 kB |
| Leafer Web chunk |   302.16 kB | 100.55 kB |
| Electron Main    | 2,095.70 kB | 419.14 kB |
| Preload          |   233.36 kB |  37.06 kB |
| Agent            |   331.44 kB |  63.22 kB |

构建提示 Renderer/Main 存在超过 500 kB 的 chunk。当前不影响构建成功，但需要在性能阶段评估动态加载与 Rolldown code splitting，不能通过移除 sourcemap 或隐藏警告冒充优化。

构建图不包含 OpenPencil、旧 canvas preload、旧 Canvas2D 产品包、CanvasKit/WASM 或隐藏本地设计 server。

## Electron 安全基线

当前代码保持：

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`。
- Preload 暴露窄、类型化且运行时校验的产品 API，不暴露原始 `ipcRenderer`。
- Renderer 导航使用精确开发 origin/打包入口；新窗口默认拒绝，HTTP(S) 外链交给操作系统。
- Conversation Provider 与全局图片生成凭据使用不同的 Main-only `safeStorage` 槽；Renderer 和 Agent utilityProcess 都不接收密钥。
- 附件由 Main 校验内容、大小、MIME、摘要和存储完整性；utility/model bridge 不接受任意路径或 inline base64。
- 模型设计写入必须经过 typed tool、Main run binding、Renderer scope/revision 校验和唯一 `EditorRuntime.apply()`。

## 仍需实机验证

以下项目没有被本次自动化替代，不能描述成已完成：

1. 在本仓库启动的 Electron 实例中，选中节点并运行多阶段 Agent 事务；持续 pan/zoom/resize，确认 Leafer 蓝色 editBox 始终贴合节点，无巨大角、残影、viewport 锁死或输入丢失。
2. 复杂渐变、光晕、模糊、blend、mask 和高级描边组合的视觉保真。
3. 属性检查器修改后画布同步、文本中文输入法、缩放中的 DOM TextEditor 和焦点恢复。
4. 粘贴/拖放附件、本地路径/URL `read_image`、全局 GPT Image 2 `generate_image` 到真实多模态模型，以及 `place_image` 的完整用户流程。
5. 从两个固定 fixture 生成 macOS/Windows 真实 Leafer 像素 baseline，并重放完整 Agent“写入 → 截图 → 修正 → 截图”轨迹。
6. 大节点量、复杂文本、图片/效果的帧率、内存和资源释放基准。

实机验证只能连接明确从当前仓库 `apps/desktop` 启动的实例，不能控制用户的其他 Electron/Chrome 进程或个人浏览器配置。

## 发布验证状态

本次在 macOS arm64 命令行执行 `package:mac`，由 Vite 8.2.1 在当前平台重新生成 Main/Agent `.jsc`，electron-builder 26.15.3 生成以下未签名产物：

- `OpenDesign-0.0.0-mac-arm64.dmg`
- `OpenDesign-0.0.0-mac-arm64.zip`

`verify:package:mac` 已检查目标平台/架构命名、非空 DMG/ZIP、unpacked `app.asar`、`icon.png`、`THIRD_PARTY_NOTICES.md`、Main/Agent bytecode wrapper、`.jsc`、bytenode runtime，以及 protected output 中不存在 sourcemap。打包过程没有启动 OpenDesign 窗口；按用户要求，本次未运行 packaged executable smoke。

仓库新增 macOS/Windows 原生 workflow，目标顺序为 `verify → native protected package → package content verification → packaged Agent smoke → artifact upload`。但 workflow 尚未 push 或运行，因此以下发布门禁仍未完成：

- Windows 原生 verify、protected bytecode、NSIS、packaged smoke、安装/升级/卸载和用户数据保留。
- macOS packaged Agent smoke、干净安装、升级/卸载、Developer ID 签名、hardened runtime 和 notarization。
- 两个平台的窗口、菜单、输入、画布、文件、`safeStorage`、Provider 与崩溃恢复产品 smoke。
- Linux 原生构建和 protected bytecode（当前不阻塞 macOS/Windows 里程碑）。
- 从实际发行物生成的完整第三方许可证清单。

因此当前证据证明 macOS arm64 可生成并通过静态内容检查的未签名安装包，不代表 macOS 或 Windows 已达到可发布状态。
