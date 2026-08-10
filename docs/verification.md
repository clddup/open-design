# OpenDesign 验证状态

- 日期：2026-08-11

<!-- verification-facts:baseline:start -->

- 环境基线：Node.js 24.14.0、pnpm 10.32.1、Electron 43.3.0、Vite 8.2.1
- 文档协议：`DesignDocument 1.4.0`
- Agent 协议：`3.4.0`
- Agent Core：`@earendil-works/pi-agent-core 0.84.1`（production-entry-native-gate-pending）
- 生产画布：`leafer-editor 2.2.9`

<!-- verification-facts:baseline:end -->

本文只记录当前工作树实际执行的证据。计划命令、历史会话结果和第三方能力说明不算通过。

## 平台支持矩阵

| 平台    | 产品级别 | 当前证据                                                                                                                                                                                                    | 发布状态                     |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| macOS   | 一级支持 | 原生 workflow [31384519288](https://github.com/clddup/open-design/actions/runs/31384519288) 已通过 verify、protected Vite build、未签名 DMG/ZIP、包内容检查、packaged Agent smoke 与 artifact 上传          | 自动化通过；签名/安装待验收  |
| Windows | 一级支持 | 历史 workflow 已在 Windows runner 通过 verify、protected Vite build、NSIS、包内容检查、packaged executable/Agent smoke 与 artifact 上传；当前 NSIS 已配置 assisted installer 和目录选择，待最新原生产物复验 | 自动化待复验；实机安装待验收 |
| Linux   | 目标平台 | 保留 electron-builder 配置，当前无原生验证                                                                                                                                                                  | 当前阶段不阻塞               |

macOS 与 Windows 必须在同一待发布 commit 上分别完成原生验证。Electron、TypeScript 和共享测试通过不等于另一操作系统可用，protected V8 bytecode 也不能跨系统构建后复用。

## 自动化门禁

当前工作树通过：

<!-- verification-facts:tests:start -->

```text
pnpm format:check   passed
pnpm agent-core:check passed
pnpm capabilities:check passed
pnpm fixtures:check passed
pnpm lint           passed
pnpm typecheck      passed
pnpm test           passed
├── package tests   30 files / 203 tests
└── desktop tests   38 files / 277 tests
pnpm build          passed
├── Renderer
├── Electron Main
├── Preload
└── Agent utilityProcess
```

<!-- verification-facts:tests:end -->

测试覆盖的关键路径包括：

- DesignDocument 1.4 schema/migration、正式 Path/Vector 外观、非破坏 Image placement 与 Boolean Group、事务、revision、preview、history、undo/redo、asset 引用安全和 Agent 渐进事务回滚。
- `DesignCapabilityManifest v1` 的严格字段、唯一 ID、六表面状态、证据派生与不可变快照；Agent system context、只读 `get_capabilities` tool、生成式帮助文档和发布摘要读取同一 JSON，`capabilities:check` 会拒绝文档漂移。
- `inspect_document` 不把 image asset 的 data URI 或外部 URI 放入模型上下文；Agent Runtime 会同时压缩当前轮和旧 journal 中意外出现的超长工具字段，避免图片文档在下一轮触发 `context_too_large`。
- Agent Runtime 在完整 run 边界生成累计 `context.compacted` checkpoint，并在同一 Run 的每个 Provider turn 前重新预算；旧 assistant/tool 段超限时变成临时有界 checkpoint，当前用户原文和最近完整 tool call/result 段继续保留。测试覆盖原始 Timeline 不删除、checkpoint 范围单调增加、旧全文退出模型投影、第八轮自动恢复，以及单次当前输入或最小必要段仍超预算时才返回 `context_budget_exceeded`。模型投影同时限制超长单字段和超过 `50000` 字符的完整结构化工具结果，原始 journal 不丢失；预算错误按 system、tool schemas、Conversation/tool results 和 framing 分账。Main 从可信 Model Profile 注入窗口和输出预算；可信 token 预算存在时不会再被固定字符阈值误杀，缺少模型窗口时才使用字符保底；固定协议无法适配小窗口时返回独立的 `model_context_incompatible`。
- `OD-PENGUIN-01`、`OD-POSTER-01` 与 `OD-BRAND-01` 专业 fixture 从固定 prompt 生成初稿、refinement 事务、最终 `.opendesign` 和 SHA-256 manifest；`fixtures:check` 阻止生成物漂移。EditorRuntime 测试验证命名 Group、主体/翅膀/脚/围巾正式 Path、1440×1024 海报画板、可编辑 Boolean 品牌主件、复杂特性下限、零结构诊断、JSON 保存重开及 apply/undo/redo；Leafer 测试验证所有权威节点可达、Path/渐变/效果/mask/内嵌图片映射且没有 fidelity warning。品牌样张还通过固定 PathKit WASM 解析非破坏 Subtract，校验 result bounds 与 path checksum，再投影唯一 synthetic Leafer Path；该几何证据不替代真实像素 baseline。
- Boolean resolver 使用真实 PathKit WASM 覆盖有序四类运算、圆角 Rectangle、Ellipse、Path/Vector 原始坐标、嵌套组、fill+stroke、stroke align、transform、dash、空结果和精确缓存；Leafer adapter 测试覆盖按需加载、稳定 synthetic ID、源层隐藏、命中映射、失败 warning、dispose 后迟到结果、无关 revision 复用和删除清理。人工工具栏菜单、Inspector operation 控件、解组和 macOS/Windows 快捷键与 `opendesign_edit_hierarchy` 的三类 Boolean typed actions 复用同一 planner；源 operand edit scope 测试覆盖 Enter/双击/图层树进入、Shift+Enter/Escape/Done 退出、Tab 导航、可丢弃轮廓、逐帧 synthetic preview、单次正式提交、受控外观字段、最小 operand 删除保护、锁定可选但只读、provider retry 和上下文 warning。Agent 测试继续覆盖显式稳定 ID、preview、单次 revision/undo、世界 transform 与实时选区隔离。
- EditorRuntime 设计预检覆盖 Path/渐变/光晕/模糊/blend/mask/图片/文字特性计数，以及空内容、不可见/无外观、缺失或不受支持图片源、非有限 bounds、clipping Frame 完全越界和根层碎片；同一报告经 `inspect_document` 交给 Agent。
- Leafer 文档投影、Path 实例、复杂外观映射和 change-set 增量同步：未变节点保持 spec/元素 identity，不调用 `set()`；无关新增、删除和 revision 不刷新 tree/Editor，也不取消进行中的直接操作；选中节点变化只刷新该元素 bounds 并更新 editBox；asset change 会精确重投影引用节点。
- Workspace/Project/Design File、Conversation、Global Task、Provider Catalog v3/v1/v2 迁移、独立 `GlobalImageGenerationSettings v1`、两套凭据隔离和跨进程对象校验。
- OpenAI Responses、OpenAI Chat Completions、Anthropic Messages canonical adapter 与 tool calling。
- 固定 `@earendil-works/pi-agent-core 0.84.1` 的 headless `Agent` 已进入 utilityProcess 唯一生产入口 `OpenDesignPiRuntime`；旧自研通用循环和旧专属测试已删除，`agent-core:check` 会拒绝旧 `AgentRuntime`、生产 fallback、Pi Coding Agent/TUI、直接 Provider/凭据入口或非 OpenDesign 工具重新出现。新 runner 保留同会话串行、取消、请求处理三方法端口、唯一 journal、历史 tool-call ID 去重和启动恢复。ModelGateway bridge 覆盖三种 API identity、reasoning/text/tool-call、partial arguments、usage、取消和错误；tool/run adapter 覆盖十二个生产工具、标准 JSON Schema、validation、approval、progress、revision、失败、completion guard 和 pending tool 最终化。Context adapter 在每个 Provider turn 通过 `transformContext` 复用 Model Profile/token/字符预算，预算失败在 Provider I/O 前可见；附件只以 `image_ref`/`document_ref` 交给 Main，Pi transcript 不保存 inline base64。完整生产 system prompt、十二工具、200K Model Profile 和八轮三图循环在第八轮压缩后完成，七个原始工具结果仍在 journal。本机 protected Vite 8 build 已通过但未启动应用；同 commit 的 macOS/Windows packaged Agent smoke 尚待原生 CI，因此迁移门禁未标记全部完成。
- 生产 Provider stream 的首响应、空闲和总时限 watchdog 会 abort 实际 fetch；timeout 与 Agent process exit 都会解除 Renderer active Run、恢复可编辑输入并显示可重试错误。
- 完整生产设计工具契约会穿过 Agent→Main model bridge 的真实守卫；守卫分别限制单工具 schema 和集合总大小。生产回归使用完整 system prompt、十二个工具和 200K Model Profile，既证明短消息会进入 Provider，也证明含多模态结果的八轮工具循环会在 Run 内压缩后完成。模型可见 `apply_transaction` Schema 不依赖 `$ref/$defs`，本地仍用完整 `DesignOperationSchema` 校验。模型桥、畸形 Agent 事件与无 run ID 的进程错误会变成可见终态；设计工具桥拒绝会变成回给模型的 `tool.failed`，两者都不再只写日志后让 UI 永久等待。
- 工具执行、业务校验和设计工具桥失败会作为 `tool.failed` 回到下一轮模型上下文供其重试或解释；模型桥、Provider、Agent 进程/协议和可信 Run binding 失败才会取消 Run。两类路径分别有“继续第二个模型回合”和“相关 Run 终结/解锁”测试。
- JSONL 启动恢复会一次性终结孤立 started Run 和 pending tool；Global Task 同步转为 interrupted。Conversation 在 Run 注册和后续 Agent 活动时更新持久 `updatedAt`，Renderer 立即按最近活动重排。
- Main-owned 诊断事件经过严格跨进程校验，按大小轮转写入 JSONL，且不接受任意上下文字段；右下角错误通知会显示稳定错误码和关联 Run，并复制包含 Conversation/Run/Request/Tool Call ID、应用版本和平台的诊断文本。
- 图片/文档附件、内容识别、完整性、大小限制、多模态 `image_ref`、显式本地路径/HTTP(S) 图片读取和未明示 source 拒绝；远程 body stream 的 15 秒超时、用户取消和流式超过 16 MB 均覆盖到 reader 生命周期。
- `openai-images` adapter 只使用独立应用级配置的 Base URL、鉴权、凭据和任意 model ID 调用 `/images/generations`，GPT Image 2 是首个验证模型；链路校验 `data[0].b64_json`、响应/图片大小、格式、凭据和取消。tool schema 不接受 Provider/Model 覆盖，也不会借用 Conversation Provider；旧 v2 选择和密文迁移已有回归测试。
- Renderer Agent 对话、属性检查器、设计工具 selection context / Mutation Target / revision、`capture_canvas` 内容寻址多模态结果、取消/继续、i18n 和桌面控件交互；对话在底部时跟随新消息与状态，用户上翻后保持阅读位置，回到底部后恢复跟随；剪贴板文件与拖放文件经 Preload API 导入，run 只接收安全附件元数据，纯文本路径粘贴保持普通输入行为。
- host-only 图片放置以单个 Page-targeted `put_asset + insert_element(image)` 事务进入 `EditorRuntime`；测试验证单次 revision、发送时存在选区也能在固定 Page 新增 asset/node、当前活动页面变化不漂移目标，以及一次 undo 同时移除 asset/node。
- 人工检查器与 `opendesign_update_image` 共用 `planImageNodeUpdate`：明确 Page/node ID 的 placement 与来源替换进入单个事务，保留现有 placement，未共享的旧 asset 可安全清理，共享 Image/Path/Vector paint 资源不会误删；文件选择取消/失败不产生 revision，Agent 执行不读取发送时或实时选区。
- `opendesign_edit_hierarchy` 对现有节点提供显式 ID 的编组/解组、前移/后移/置顶/置底和跨 Page root/Frame/Group 重挂载语义；宿主与人工 UI 复用同一 planner，保持世界 transform 与多选内部顺序，固定 Frame 尺寸，自底向上重算受影响 Group bounds，并以一个原子事务写入和一次撤销。人工入口包含 Layer order 菜单、macOS `⌘/⌥⌘ + [ ]`、Windows `Ctrl/Ctrl+Shift + [ ]` 快捷键，以及图层树 before/inside/after 指针拖放。测试覆盖两个平台状态下的拖放、选区保持、保存重开、undo/redo、stale revision、Page Mutation Target、锁定、混合父级、cycle、空来源 Group、不可逆 transform、无效 index、外部拖放数据拒绝、继承外观 warning 与提交前取消；这仍是自动化 DOM/Runtime 证据，不冒充 Electron 实机指针验证。
- `@opendesign/geometry-service` contract v2 的根入口提供不持有文档状态的纯排列结果；EditorRuntime 的 `planArrangeNodes` 将六向多层对齐、固定两端横/纵均分和明确正数/零/负数间距映射为一个原子事务，并自底向上维护 Group bounds。Inspector 与 `opendesign_arrange_layers` 共用该 planner；Agent 必须提供检查所得的稳定 Page/node IDs，发送时或实时选区不作为写目标。测试覆盖不等尺寸、旋转/缩放父级、负间距、两端固定、Group rebase、保存重开、undo/redo、锁定、不可逆 transform、Page scope、无操作拒绝，以及 macOS/Windows Renderer 状态；尚未执行真实 Electron 指针/键盘产品 smoke。
- 隔离的 `@opendesign/geometry-service/vector-path` 子入口固定 `pathkit-wasm 1.0.0`；实际 WASM corpus 覆盖 cubic union/subtract/intersect/exclude、复合孔洞、合法空结果、self-intersection simplify、Canvas/SVG transform、精确两段 dash、开放路径 outline stroke、fill rule、tight bounds、确定性输出、非法输入和资源预算。`boolean-resolver` 递归覆盖 Rectangle/Ellipse/Path/Vector/嵌套 Boolean、源层 fill+stroke、inside/center/outside stroke、visibility、空结果和精确 cache invalidation。所有 PathKit 对象显式释放，公共结果不暴露 WASM/Skia 对象。Renderer 仅在 Page 存在 Boolean 时加载独立 `browser-vector-path` 与 WASM 产物；Main/Preload/Agent 不包含该实现。同一 corpus 的 macOS/Windows 原生加载、性能与内存门禁仍待 CI。

Node.js 在涉及 `node:sqlite` 的测试中输出 experimental warning；测试仍通过。该 API 的 Electron 长期兼容策略尚未最终确定。

## 已配置模型 API 烟测

本次另用无窗口 Electron harness 直接复用 Main 的 `ModelProviderHost`、`safeStorage` 和用户现有 `gpt-5.6-sol` / OpenAI Responses 配置完成一次真实两轮 API 调用；harness 与工作数据库副本均不进入仓库，未打开或控制任何 OpenDesign 窗口。

- 临时会话预置 12 个完整历史 Run，并让当前 `opendesign_inspect_document` 返回含 1,617,290 字符合成 data URI 的原始工具结果。
- Runtime 生成累计 checkpoint `fromSequence=1 / toSequence=18`，摘要 3,974 字符；原始 journal 仍保留完整工具结果。
- 实际送入 Provider 的两轮序列化上下文分别为 225,425 和 226,483 字符，均包含 checkpoint、均不包含 `data:image`，最大单字段为 12,011 字符。
- 两个 Provider attempt 均正常完成；Run 以 `complete` 终结，无 `agent.error`，第二轮正确返回“图片图层 1、诊断错误 0、revision 147”。

该证据复现并通过了原故障的关键边界：旧历史压缩 → 检查工具 → 超长图片字段本地剥离 → 第二轮真实模型响应。它不替代 Renderer 中粘贴/拖放、真实图片附件视觉理解或完整设计事务的后续实机验证。

## 专业设计就绪度审计

当前 `DesignCapabilityManifest v1` 记录 0 项完整可用、10 项降级可用和 7 项不可用能力；没有实机证据的能力不会标记为完整可用。`DesignDocument 1.4.0`、EditorRuntime、Image service、Leafer adapter、属性检查器和 Agent tools 已经打通 Path/Vector、主要外观、图片读取、全局生图、图片放置、非破坏图片 placement、来源替换和视觉复核的基础路径。三个固定专业 fixture 进一步证明这些语义可以组成完整企鹅层级、复杂海报文档和保留源 operand 的 Boolean 品牌主件，而不是只能稳定使用椭圆和矩形；画布直接 Crop 模式、图片调整、真实 Electron 像素截图、Agent 重放和专业导出仍未完成，因此不能据此把完整工作流标为可用。

仓库当前已有独立 `@opendesign/geometry-service`：确定性排列已进入产品链，隔离的 Skia PathKit provider 已建立路径布尔、simplify、transform、dash 和 outline stroke 的底层计算边界。`DesignDocument 1.4.0` 与 EditorRuntime 建立非破坏 Boolean Group 的独立节点、迁移、创建/切换/解组 planner、组级外观、源层保护、持久化和 undo/redo；递归 resolver 与 Leafer synthetic result 已让 Render 表面可用，且没有持久化 provider 派生 path。人工工具栏/菜单、Inspector、双平台快捷键、源 operand 画布编辑与 Agent typed tool 已开放创建、切换、继续编辑和解组，但文字 outline、SVG 往返、像素基线和双平台打包产品证据仍未完成，所以 Boolean capability 保持 `degraded`，不能描述为完整产品功能；Pen、flatten 和 outline stroke 也仍不是可用产品能力。仓库没有独立 Layout、Text/Font 或 Import/Export service 包；`packages/editor-runtime/src/geometry.ts` 仍只负责矩阵、坐标转换和 bounds 计算，组件、Variant 和 Token 仍为占位数据，专业导出也没有可达产品路径。`@opendesign/image-service` 当前提供非破坏 placement/crop 几何，人工 UI 与 Agent 已可替换来源；AI 局部重绘、扩图、背景替换、重打光、风格统一和派生 asset 来源关系仍明确标记为不可用。

Agent Runtime 与 Main 当前强制执行“inspect → typed plan → 实质初稿 → `capture_canvas` → typed visual review → refinement → `capture_canvas`”。所有新 composition 必须位于计划 Frame 内；全局生图只能使用计划声明的 role，默认不能用一张 raster 替代可编辑设计。该流程显著收紧敷衍路径，但仍不能单独保证审美、文字可读性或交付保真；后续交付必须按照 [`roadmap.md`](roadmap.md) 的像素基线、固定样张、capability manifest、专业 service 和人工验收推进。

## 构建结果

Vite 生产构建完成四个环境。共享门禁从实际 `out/` 检查每个预期产物唯一、存在且非空，不要求 macOS 与 Windows 的输出和某次本机构建保持精确字节相等。包体治理应使用明确的大小预算或回归阈值，并按目标平台分别记录，不能拿单个平台的一次构建字节数阻断其他平台。

<!-- verification-facts:build:start -->

| 产物                       | 共享门禁   |
| -------------------------- | ---------- |
| Renderer 主 JS             | 存在且非空 |
| Leafer Web chunk           | 存在且非空 |
| 按需 Vector geometry chunk | 存在且非空 |
| 按需 PathKit WASM          | 存在且非空 |
| Electron Main              | 存在且非空 |
| Preload                    | 存在且非空 |
| Agent                      | 存在且非空 |

<!-- verification-facts:build:end -->

构建提示 Renderer/Main 存在超过 500 kB 的 chunk。当前不影响构建成功，但需要在性能阶段评估动态加载与 Rolldown code splitting，不能通过移除 sourcemap 或隐藏警告冒充优化。

构建图不包含 OpenPencil、旧 canvas preload、旧 Canvas2D 产品包、CanvasKit 及其 WASM 或隐藏本地设计 server。固定 PathKit WASM 仅作为上表所列的 Renderer 按需资产存在。

## Electron 安全基线

当前代码保持：

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`；Renderer CSP 仅为按需 PathKit 增加 `'wasm-unsafe-eval'`，不允许通用 `'unsafe-eval'`。
- Preload 暴露窄、类型化且运行时校验的产品 API，不暴露原始 `ipcRenderer`。
- Renderer 导航使用精确开发 origin/打包入口；新窗口默认拒绝，HTTP(S) 外链交给操作系统。
- Conversation Provider 与全局图片生成凭据使用不同的 Main-only `safeStorage` 槽；Renderer 和 Agent utilityProcess 都不接收密钥。
- 附件由 Main 校验内容、大小、MIME、摘要和存储完整性；utility/model bridge 不接受任意路径或 inline base64。
- 模型设计写入必须经过 typed tool、Main run binding、Renderer scope/revision 校验和唯一 `EditorRuntime.apply()`。

## 仍需实机验证

以下项目没有被本次自动化替代，不能描述成已完成：

1. 在本仓库启动的 Electron 实例中，选中节点并运行多阶段 Agent 事务；持续 pan/zoom/resize，确认 Leafer 蓝色 editBox 始终贴合节点，无巨大角、残影、viewport 锁死或输入丢失。
2. 复杂渐变、光晕、模糊、blend、mask 和高级描边组合的视觉保真。
3. 属性检查器修改后画布同步、多选对齐/均分/明确间距的图标与键盘焦点、文本中文输入法、缩放中的 DOM TextEditor 和焦点恢复。
4. 粘贴/拖放附件、本地路径/URL `read_image`、全局 GPT Image 2 `generate_image` 到真实多模态模型，以及 `place_image` 的完整用户流程。
5. 从三个固定 fixture 生成 macOS/Windows 真实 Leafer 像素 baseline，并重放完整 Agent“写入 → 截图 → 修正 → 截图”轨迹。
6. 大节点量、复杂文本、图片/效果的帧率、内存和资源释放基准。

实机验证只能连接明确从当前仓库 `apps/desktop` 启动的实例，不能控制用户的其他 Electron/Chrome 进程或个人浏览器配置。

## 发布验证状态

本次在 macOS arm64 命令行执行 `package:mac`，由 Vite 8.2.1 在当前平台重新生成 Main/Agent `.jsc`，electron-builder 26.15.3 生成以下未签名产物：

- `OpenDesign-0.0.0-mac-arm64.dmg`
- `OpenDesign-0.0.0-mac-arm64.zip`

`verify:package:mac` 已检查目标平台/架构命名、非空 DMG/ZIP、unpacked `app.asar`、`icon.png`、`THIRD_PARTY_NOTICES.md`、Main/Agent bytecode wrapper、`.jsc`、bytenode runtime，以及 protected output 中不存在 sourcemap。打包过程没有启动 OpenDesign 窗口；按用户要求，本次未运行 packaged executable smoke。

仓库的 macOS/Windows 原生 workflow 顺序为 `verify → native protected package → package content verification → packaged Agent smoke → artifact upload`；历史 workflow 已在两个平台通过。当前 worktree 修改了 NSIS 安装模式，尚无对应 Windows 原生产物，因此以下发布门禁仍未完成：

- Windows 当前 commit 的原生 verify、可选目录 NSIS、packaged smoke，以及干净安装/升级/卸载和用户数据保留。
- macOS 干净安装、升级/卸载、Developer ID 签名、hardened runtime 和 notarization。
- 两个平台的窗口、菜单、输入、画布、文件、`safeStorage`、Provider 与崩溃恢复产品 smoke。
- Linux 原生构建和 protected bytecode（当前不阻塞 macOS/Windows 里程碑）。
- 从实际发行物生成的完整第三方许可证清单。

因此历史证据证明 macOS/Windows 可以生成安装包并运行 packaged Agent smoke；当前安装器变更仍需 Windows 原生复验，两个平台都未达到完整发布门禁。
