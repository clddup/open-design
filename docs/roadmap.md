# OpenDesign 路线图

本路线图按架构依赖组织，不按临时反馈逐项追加。完整产品边界由 [`design-capability-baseline.md`](design-capability-baseline.md) 定义；每个实施切片必须同时覆盖公共语义、事务、人工 UI、Agent、渲染/导出、持久化和验证。

## 执行与验收模型

路线图中的能力只有在以下链路全部打通后才能标记完成。单独增加 schema、属性面板控件、Agent 提示词或 Leafer 映射都不构成产品交付。

```text
schema → migration → EditorRuntime → 人工 UI → Agent tool →
provider adapter → 渲染/导出 → 保存重开 → undo/redo → 自动化与实机验证
```

每个垂直切片必须保存可重放的输入、`.opendesign` 文件、关键事务或诊断 ID、渲染截图、导出产物、平台信息和验收结果。自动化结构测试证明数据链路，Electron 截图证明实际渲染，人工交互验收证明工具可用；三类证据不能彼此替代。

### 固定专业验收集

| 样张 ID         | 工作流          | 必须证明的能力                                                                                                                                       |
| --------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OD-PENGUIN-01` | 原创矢量吉祥物  | Path/Vector 可见；主体、翅膀、脚和织物使用自由轮廓；复合对象属于一个命名 Group；图层选择、保存重开、undo/redo 一致                                   |
| `OD-POSTER-01`  | 复杂活动海报    | 1440×1024 画板；企鹅主体、标题和副标题；多渐变、描边、阴影、光晕、模糊、blend、mask 与图片组合；Agent 完成两次视觉检查和中间修正；最终产物可专业导出 |
| `OD-BRAND-01`   | Logo 与品牌图形 | Pen 节点编辑、布尔运算、flatten、outline stroke、精确对齐；SVG 导入导出往返后结构和外观保持                                                          |
| `OD-UI-01`      | 多尺寸 UI 页面  | constraints、auto layout、grid、组件实例、Variant、Token/Variable、富文本与图片；改变容器尺寸和变量模式后得到确定性布局                              |
| `OD-SCALE-01`   | 大规模真实文档  | 万级节点、复杂图片和效果下的增量投影、选择、pan/zoom、Agent 连续 revision、资源释放、内存与帧时间基准                                                |

P0 阶段先验收 `OD-PENGUIN-01` 和 `OD-POSTER-01` 的当前可用子集。后续阶段扩展同一批样张，不为新能力重新创建无法比较的一次性演示。

## P0-A：macOS 与 Windows 一级平台可用

- 建立 macOS 与 Windows 原生 CI/发布矩阵；共享 `pnpm verify`，并分别在原生 runner 构建 protected bundle 和安装包。V8 bytecode 不能跨操作系统复用。
- macOS 产出 DMG/ZIP，Windows 产出 NSIS installer；分别验证干净安装、首次启动、升级覆盖、卸载和用户数据保留策略。
- 两个平台共同执行：窗口/菜单/快捷键、Leafer 画布鼠标与触控板/滚轮、文本输入、文件选择、Project 保存重开、Agent utilityProcess、`safeStorage`、附件、Provider 调用、取消和崩溃恢复 smoke。
- 审计并移除只在 macOS 成立的路径、菜单、图标、快捷键和 shell 假设；平台差异通过窄 adapter 处理。
- Windows 原生 smoke 未通过前，不得把桌面版描述为跨平台可发布。Linux 保留目标和构建边界，但当前不阻塞此里程碑。

完成条件：macOS 与 Windows 的同一 commit 都有 `verify + native package + install/start/product smoke` 证据，并写入 `verification.md`。

## P0-B：稳定当前 `1.2.0` 与 Leafer 迁移

- [x] 为 host-only `put_asset + insert_element(image)` 内部事务补 Renderer 集成测试，验证单次 revision、Page/Selection scope 和一次 undo 同时移除 asset/node。
- [x] 为 Agent composer 的剪贴板粘贴和文件拖放补交互测试，验证 Renderer 通过窄 Preload API 提交 bytes，最终 run 只携带安全附件元数据；纯文本路径粘贴不被拦截或提前读取。
- [x] 让 HTTP(S) 图片读取的超时和取消覆盖完整 body stream，而不只覆盖 response headers；慢 body、流式超过 16 MB 和用户取消已有自动化回归。
- [x] 为生产模型流增加首响应、流空闲和总时限 watchdog；超时或 Agent 进程退出必须解除 Conversation 的 active Run，返回可重试错误并 abort Main-owned fetch。
- [x] 启动时终结 JSONL 中未完成的 Run/pending tool，并同步恢复 Global Task；新 Run 和后续 Agent 活动更新 Conversation `updatedAt`，最近活动会话立即置顶且重启后顺序一致。
- [x] 修复生产设计工具 schema 被 model bridge 尺寸守卫静默拒绝的问题；完整工具契约必须穿过真实跨进程守卫测试，请求/响应拒绝与畸形 Agent 事件必须返回可见终态并解除 Run。
- [x] 将 `AgentRequest 3.3` 的发送时选区上下文与单一 Mutation Target 分离；默认写目标冻结为发送时活动 Page，用户之后改变选区或活动页面不缩小、不漂移该 Run 的事务目标。
- [x] 建立 Main-owned 结构化诊断 JSONL 与大小轮转；错误通过 Conversation/Run/Request/Tool Call ID 关联到右下角通知，并可一键复制。Agent 对话仅在用户贴近底部时自动跟随消息、流式增量和工具状态，上翻查看历史时不强制回底。
- [x] 将 Provider Catalog 升级到只管理对话模型的 v3，并建立独立 `GlobalImageGenerationSettings v1`：生图服务拥有自己的启用状态、adapter、Base URL、鉴权、凭据和用户模型 ID，不受 Conversation Provider/Model 影响；`generate_image` 结果进入内容寻址附件并由 `place_image` 通过唯一事务放入画布。旧 v2 生图选择确定性迁移后从 Catalog 剥离。
- [ ] 在本仓库启动的 Electron 实例中复验：Agent 渐进事务期间 pan/zoom/resize 后 Leafer editBox 始终贴合选区，不出现巨大蓝色角、残影或输入锁死。
- [ ] 实机复验复杂渐变/光晕/模糊、属性检查器同步、`capture_canvas` 多模态视觉回读、本地路径/URL `read_image`、全局 GPT Image 2 `generate_image`、粘贴/拖放附件和 `place_image`。
- [x] 将 Leafer revision 同步改为 transaction change set 驱动的 affected-node 增量投影与 reconcile：未变节点不再 `set()`，无关 revision 不再隐藏 Editor、取消直接操作或刷新 tree bounds；选区相关变化只刷新对应元素 bounds，断档/切页/恢复才全量回退。
- [ ] 建立模型感知的上下文预算与持久压缩：发送前为 system/tool/output/image 预留预算，确定性剥离二进制和旧工具大字段，把较早事件压成带目标、决策、资源 ID、revision、已完成/未完成事项的 `context.compacted` checkpoint；保留最近原文与完整 tool-call/result 对，上游仍返回 `context_too_large` 时只允许紧急压缩后重试一次。
- [ ] 补万级节点、连续 Agent revision、效果/图片节点、选区/editBox、pan/zoom 的真实 Electron 帧时间与内存基准，并据此继续压缩结构 ID 遍历和资源失效成本。

完成条件：全仓 `pnpm verify` 通过，关键 Electron 交互写入 `verification.md`，ADR-0009/0010 的验证项有实际证据。

## P0-C：固定样张与能力事实门禁

- [ ] 使用当前仓库启动的 Electron 实例执行 `OD-PENGUIN-01` 和 `OD-POSTER-01`，保存原始 prompt、最终 `.opendesign` 文件、两次 `capture_canvas`、中间 refinement、截图、Conversation/Run ID 和相关诊断。
- [ ] 建立专业样张 fixture 与跨平台视觉 baseline；测试必须从干净文档重放，不能依赖某个开发会话的临时状态。
- [x] 为 Path、渐变、光晕、模糊、blend、mask、图片和文字建立版本化预检：`inspect_document` 返回实际特性计数，并识别空 Path/文字、不可见或无绘制外观节点、丢失/不受支持的图片 asset、非有限 bounds、完全越出 clipping Frame 和异常根图层碎片；Agent prompt 要求先处理 error 并解释 warning。
- [x] 建立版本化 capability manifest。每项能力记录 `available / degraded / unavailable`、provider、限制、六个产品表面、自动化证据和实机证据；Agent system context、`get_capabilities` tool、生成式帮助文档和发布摘要读取同一 JSON 事实来源，`capabilities:check` 阻止生成物漂移。能力状态不是设置项，不进入设置页。
- [ ] 让验证文档的协议版本、测试数量、构建产物和平台证据由门禁命令更新或校验，禁止 `verification.md` 与当前工作树长期漂移。

`OD-POSTER-01` 的首轮重放 prompt 固定为：

> 创建一张 1440×1024 的未来感企鹅发布会海报。企鹅必须放在一个命名 Group 中，身体、翅膀和脚使用 Path；使用渐变、描边、外光晕和阴影；加入标题和副标题；如需要可调用全局生图模型。完成前必须截图检查、执行一次具体修正并再次截图。

验收人员必须检查 Path 是否真实显示、企鹅是否属于单一上层 Group、图层树与画布选区是否一致，以及 Agent 是否实际执行“写入 → 截图 → 修正 → 截图”。验收期间还必须改变选区、缩放和窗口尺寸，并验证任务目标不漂移、editBox 不残留、undo/redo 和保存重开保持一致。

完成条件：两个样张在当前 macOS Electron 实例通过完整重放；失败项进入 P0 阻塞清单并在继续专业能力开发前修复。Windows 原生重放由 P0-A 的同级平台门禁承接。

## P1：专业能力契约

- 把 P0-C 的初始 capability manifest 提升为版本化公共契约，并为 Renderer、Agent、MCP 和发布说明提供同一只读查询入口。未知能力必须拒绝，降级能力必须返回结构化限制和 fidelity warning。
- 设计可按垂直切片迁移的专业基础文档版本，统一正式 Line/Arrow/Polygon/Star/Slice、Path/Vector 多轮廓、constraints/layout、富文本/font、图片 crop/adjustments、Component/Instance/Variant、style/token binding 和 export settings。
- 为 Geometry、Layout、Text/Font、Image 和 Import/Export service 建立窄、版本化的输入输出接口。服务只能返回纯结果、诊断或候选 `DesignOperation[]`，不能保存第二份文档或直接修改 Leafer 场景。
- 提供确定性迁移、未知版本拒绝、保存重开、preview、undo/redo、Agent schema、provider 映射和 fidelity warning 测试；不得把长期语义藏进 `extensions`。

完成条件：能力清单与真实 UI、Agent tool catalog 和 adapter 行为一致；所有 service 接口存在契约测试；未实现能力保持明确 `unavailable`，不能通过占位 JSON 或提示词伪装支持。

## P2：精确图层、变换与矢量

- 建立 `@opendesign/geometry-service` 边界，并通过维护状态、许可证、包体积、确定性、WASM/原生要求和 macOS/Windows 兼容基准选择固定版本的成熟 geometry kernel。React、Agent prompt 和 Leafer adapter 不得承载几何算法。
- 增加正式 Line/Arrow/Polygon/Star/Slice 与可编辑 Path/Vector 轮廓；实现 Pen、节点/手柄、开放/闭合、连接/断开、路径反转、布尔 union/subtract/intersect/exclude、flatten 和 outline stroke。
- 补齐创建、重命名、复制、删除、编组/解组、层级移动、跨容器移动、批量操作、对齐、分布、等间距、翻转、原点、智能吸附、参考线、标尺和像素对齐。
- 人工命令与 Agent typed tools 调用同一 geometry service，并把结果作为一个可预览、可撤销的 `DesignTransaction` 应用。SVG 导入导出必须经过同一公共 Path 语义，不能泄漏 provider 私有命令。

完成条件：`OD-PENGUIN-01` 可以通过人工 Pen 和 Agent 工具继续编辑，不需要重建整个轮廓；`OD-BRAND-01` 的布尔、outline 和 SVG 往返保持结构、bounds 与视觉基线；所有动作支持保存重开和 undo/redo。

## P3-A：文字、图片与海报交付

- 建立 Text/Font service，支持富文本 runs、paragraph、列表、OpenType/variable font、字体 asset、缺失字体替换和共享文本样式。文字测量与 shaping 必须在 macOS 和 Windows 上产生明确的兼容结果或 fidelity warning。
- 建立 Image service，支持 crop、focal point、mask、replace、透明背景、基础 adjustments/filter、资源变体、引用恢复和大图生命周期。增加独立 `edit_image` adapter/tool，支持局部重绘、扩图、背景替换、重打光和风格统一；参考图、原图和 AI 派生资源必须分离并可追溯，任何编辑都不得覆盖原始 asset。
- 建立首个专业导出切片，支持选区或 Frame 的 PNG/JPEG/WebP、多倍图、透明背景和颜色配置。导出读取 DesignDocument 和受控资源，不能把当前画布截图当作交付产物。
- 为人工属性面板和 Agent 增加文字、裁剪、替换、调整和导出的语义命令；长任务必须展示进度、支持取消并返回稳定产物或明确失败。

完成条件：`OD-POSTER-01` 在保存重开后保持字体、图片裁剪和复杂外观，并能输出 1×/2× 专业位图；导出尺寸、alpha、资源引用和视觉基线通过自动化及 Electron 实机验证。

## P3-B：布局、组件与设计系统

- 建立 OpenDesign-owned constraints、horizontal/vertical auto layout、wrap、padding/gap、对齐、hug/fill/fixed、min/max、absolute child、layout grid 与响应式求解语义。Layout service 输出确定性布局或候选事务，不保存第二份布局状态。
- 建立 Component/Instance/detach、nested instance、property/override、Variant/State、共享样式、Token/Variable collection/mode/alias，并提供循环依赖和失效引用诊断。
- 人工 UI 和 Agent 使用同一组创建组件、生成实例、修改 override、切换 Variant、绑定 Token 和调整布局命令。属性检查器必须区分源组件、实例值、override 与继承值。

完成条件：`OD-UI-01` 在改变容器宽度、组件 Variant 和变量模式后得到确定性结果；实例 override、保存重开、undo/redo 和 Agent 修改保持一致，且没有把 Leafer Flow 或组件私有对象写入文档。

## P4：资源、导入导出与交付

- 建立统一资源工作台，管理图片、字体、二进制、派生资源、去重、引用计数、替换、失效恢复和授权状态。
- 建立 SVG、PNG/JPEG/WebP/GIF、PDF 和剪贴板设计内容的导入管线；导入必须返回结构化保真报告，不能静默丢弃未知效果或字体。
- 扩展导出到 SVG/PDF、批量 Frame、透明背景、切图、Token 和开发检查。导出产物必须来自版本化 service，并记录 provider、设置和 fidelity warning。
- 为 `OD-SCALE-01` 建立固定性能基准，记录万级节点、复杂文字、图片/效果、连续 Agent revision、pan/zoom、资源释放、内存和帧时间；回归超过预算时阻断发布。

完成条件：专业文件交换和批量交付有可重复产物与保真报告；`OD-SCALE-01` 在 macOS 和 Windows 达到已记录预算；长导入、导出和基准任务可以取消且不会锁死画布。

## P5：完整 Agent 权限与互操作

- 把当前设计工具纳入 Main-only Trust/Capability/Approval/Audit/Sandbox 执行链。
- 实现 attached roots、per-run resource handles、访问快照、撤销与跨 Project 多目标计划。
- 增加受控 `fetch_reference` 和隔离 `capture_reference`，明确 HTML 内容与网页视觉截图的不同语义。
- 让 MCP Client/Server 复用同一资源 locator、能力、revision、审批、审计、事务和撤销入口。

完成条件：Agent、MCP 和人工 UI 对同一设计操作产生同构事务、同一 revision 行为和同一撤销结果；模型不能通过工具参数覆盖全局 provider、读取任意路径、获取原始凭据或绕过审批。

## Agent 专业设计质量轨

专业设计质量不能只依赖 system prompt。以下工作与 P0-P5 并行，并由 Runtime、service 和固定样张共同验收：

- 增加结构诊断，识别复合对象散落 Page 根层、文字溢出、空 Path、不可见节点、资源缺失、非有限 bounds、完全越界、异常遮挡和无意义碎片层。
- 增加渲染诊断与可读性检查，覆盖主体比例、层级、留白、对比度、文字可读性和关键内容裁切。启发式诊断必须标注置信度，不能把审美模型输出伪装成确定性错误。
- 为对齐、布局、布尔、裁剪、组件、变量、导入和导出提供语义化 typed tools，避免模型通过大量低层坐标和节点重建完成专业操作。
- 保留“写入 → `capture_canvas` → refinement → `capture_canvas`”可信完成门禁，并加入结构诊断结果、渲染失败和导出失败的阻断条件。截图次数本身不能证明设计质量。
- 使用固定 prompt、参考资源、模型配置、工具轨迹、最终文档和视觉评分运行回归。任何提示词、模型 adapter、工具 schema 或渲染后端变更都必须重放受影响样张。

## 持续门禁

- 不恢复 OpenPencil、Canvas2D、手写选择框、隐藏 fallback 或双写状态。
- 不让模型、MCP、skills 或 Renderer 获得 Leafer 对象、原始凭据、任意路径或裸 shell。
- 新第三方依赖必须固定版本并更新 ADR、`engine-baseline.json`、第三方通知和兼容性测试。
- macOS 与 Windows 是同级发布门禁；不能用一个平台的构建或自动化结果替代另一个平台的原生验证。
- 文档只描述当前事实或明确目标；未验证能力不得宣传为完成。
