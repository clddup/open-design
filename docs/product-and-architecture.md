# OpenDesign 产品与架构

## 1. 产品定义

OpenDesign 是 AI-native 通用设计平台。用户可以直接操作专业画布，也可以用自然语言、上下文命令和可组合工具让 Agent 理解意图、生成方案、修改对象并解释结果。

UI 设计是首要能力和最先打磨的工作流，但不是产品边界。统一的文档模型、设计命令和引擎适配层应能承载界面、Logo、海报、品牌物料、社交图片及未来设计类型，避免形成只认识 Frame 和组件库的 UI 专用内核。

### 1.1 当前实现

截至 2026-08-25，仓库当前具备：

- OpenDesign 自有的 `DesignDocument 1.48.0`、正式矢量 region-local Paint、Figma-compatible UTF-16 rich-text character/paragraph/list runs、响应式布局、Component/Instance/Variant/Slot、跨 Design File imported Component/Variant/Style/Variable source、Variables、Shared Styles、Image 节点及 Image Fill/Stroke 七项非破坏调整、可恢复图片来源谱系、独立背景替换与 typed 重打光语义，以及正式 Slice 与节点有序 Export Settings。Page、节点、文字范围、图片资源和设计系统操作共用事务、preview、单调 revision、diff、history、undo/redo、checkpoint；旧文档确定迁移新增 registry/字段，语义不明的非空旧 token 内容明确拒绝而不猜测。
- `@opendesign/layout-service` contract v11 纯函数求解普通 Frame constraints、linear Auto Layout、Frame Fixed/Hug、直属 flow child Fixed/Fill、Horizontal Wrap、Frame/flow child Min/Max、主轴 Auto gap、wrapped rows 的交叉轴自动分布与 row-local Fill child、Horizontal flow/Wrap 的首行文字 baseline、Absolute child 排除，以及 Auto Layout Grid v2 的显式 Fixed/Fill/Hug rows/columns、row-auto-flow 自动增减 Fill 行、独立双 gap、Manual/row-major item positioning、cell/span/alignment 与 span-aware 行列重排。Text Layout contract v5 从与生产画布一致的 Leafer row metrics 返回单样式 Text 首行 baseline，rich Text 复用 Text Run Layout 的真实第一行，普通层按底边参与；Vertical flow 与无 provider 的猜测路径明确拒绝。Wrap 以 Fill child 的 min-width 分行，在每 row 内 bounded 分配主轴自由空间；交叉轴 Fill 拉伸到 row，全部交叉轴 Fill 时 AUTO tracks 才整体拉伸，不伪造跨 row 共享列。候选尺寸按 limits clamp，线性 Fill 以 bounded water-filling 重分配，Grid Fill track 按 fr 权重分配；Frame padding 是不可压缩的硬下限。EditorRuntime 以 deepest-first flow、宽度变化的 Auto Height Text 重测和有界 fingerprint 循环收敛，因此增删、显隐、resize、重排、reparent、父尺寸变化、保存重开与 undo/redo 共用同一权威几何。Inspector、快捷键、Layers、单选 populated Frame resize、absolute child 直接画布操作和 Agent `opendesign_edit_design` 的 arrange edit 复用 planner；flow child 的普通 transform/size 与 populated Frame resize 可由通用事务直接编辑；专用 Arrange 仍提供约束感知的原子重排，但不再作为普通历史设计重构的互斥入口。flow child constraints、absolute child sizing/limits 等布局语义继续由同一 Layout planner 验证。`DesignDocument 1.20.0` 的 Layout Guide 仍只做不可命中视觉辅助，不参与 child 几何或 capture/export。自动列/自定义自动轨道模板、吸附、画布 spacing/cell/reflow 手柄、SVG Grid metadata 与 breakpoint 尚未实现；Vertical Wrap 不属于 Figma 公共模型。
- `@opendesign/component-service` contract v6 继续独占 Main/Instance/Variant/Slot 投影，并为可丢弃派生层返回明确 selection owner 与稳定 source path。Canvas、Layers panel、Inspector 与快捷键只读写同一 `EditorRuntime.SelectionState`；普通层使用持久 node ID，Instance 内派生层只保存短生命周期 `instanceId + sourcePath`，每次 revision/undo/redo 重新解析，失效时退回持久 Instance。Slot override 内 persistent nested Instance 拥有自己的派生 child；派生层可通过既有 planner 写安全 override，当前 `visible`、`locked` 与已有外观字段进入同一事务链，但不可直接 transform、删除、复制或层级移动。Layers 行采用 Figma-compatible lock/visibility 与快捷键，pointer hover 只向 Leafer 投影当前 revision 的不可命中完整轮廓，不进入文档/history/save/export。Active Page 顶层 Frame、Component Main root 与 Slice 的画布名称同样是可丢弃 Renderer overlay；双击只建立临时 draft/error，正式命名复用 Layers 的 rename planner 与唯一 DesignTransaction。projection ID、Leafer object 和派生 clone 不进入文档、history 或保存。同 Project 跨 Design File Library 由 `@opendesign/library-service` 统一发布 Component/Variant/Shared Style/Variable 不可变 release；消费文件显式启用并在 Assets/Inspector 浏览，首次 imported source 与 Instance/Style/Variable reference、后续 release 接受都各自形成一笔 Runtime 事务，禁用不删除缓存 source 或现有引用。Style Service 与 Variable Service 分别统一解析 local/imported Style 和 Variable，Imported source 不进入 Local registry。Workspace/远端 Library 尚未实现。`@opendesign/variable-service` contract v1 在 Component 物化和 Style 解析后统一处理 Page→祖先→节点 mode 与 alias chain，再把 BOOLEAN/FLOAT/STRING/COLOR bindings 投影到 Leafer、SVG 和位图。权威节点保留 fallback，mode/value 改动不反写节点。人工 Variables 工作台/Inspector、Agent 通过 `opendesign_manage_design_system`（kind=variable）、inspection、diff/history、autosave 与保存重开共用同一事实。`@opendesign/text-service` 的 Text Layout contract v5、Text Range contract v1、Text Paragraph contract v2、Text List contract v1、Text Editing Session contract v2 和 Text Run Layout contract v4 分别覆盖单样式 Auto Size/字体状态、UTF-16 character range/edit remap、段落边界与逐段 indent/spacing/list facts、连续列表 block/嵌套计数、短生命周期 caret/自动列表/结构键/range staging，以及 mixed-run/list wrapping/baseline/glyph outline provider。固定 Leafer provider 保留 Latin/CJK native Text 边界；按需加载的 HarfBuzz 1.4.0 + bidi-js Unicode 13 provider 使用 Main 显式导入、SHA-256 内容寻址的 TTF/OTF/TTC，输出 cluster-aware complex shaping。Adapter 生成回映唯一原 Text proxy 的 disposable fragments、glyph Paths 和 list markers，marker 不进入 content/document/history。真实 edit DOM 支持四类前缀自动列表、结构键、collapsed-caret typing style、非空 range 暂存与 composition guard；普通 input 不重建 DOM，`U+200B` typing marker 不进入 content/history。关闭 TextEditor 时 optional character runs、final content 和最小 paragraph patches 以一条非 Agent `commit_text_edit` operation 在一次 Runtime transaction/reflow/revision 中提交。离屏 Page/Frame capture 与 Text/ancestor PNG/JPEG/WebP export 继续从精确 revision projection 重建一次性输出树。正式 character/paragraph/list runs、range/caret Inspector、Agent、Figma/SVG metadata v8 往返已接入；custom list markers、OpenType/axes、字体随文件打包、原生 IME/undo 与双平台视觉门禁仍未完成。`@opendesign/figma-interop` 只用固定 `@figma/plugin-typings 1.133.0` 做公共形状验证；Slot-in-Slot 按 Figma 公开模型永久失败封闭，更多 Variable binding、Motion 与 Plugin/REST/DTCG adapter 尚未实现。见 [ADR-0107](adr/0107-figma-selection-and-component-targets.md)、[ADR-0108](adr/0108-figma-layer-state-and-canvas-hover.md)、[ADR-0124](adr/0124-cross-design-file-library-release-sources.md) 与 [ADR-0126](adr/0126-cross-design-file-shared-style-libraries.md)。
- 同 Project 跨 Design File Variable Library 的 imported source、发布依赖闭包、首次原子绑定、更新和 Agent 只读边界见 [ADR-0128](adr/0128-cross-design-file-variable-libraries.md)。
- Workspace/Project/Design File 持久化与导航、Project Design File 自动保存与稳定身份重命名、Workspace 级持久 Conversation、按 Conversation 隔离的时间线和单目标 Global Task 投影。Project identity、Recent/Open list、Design File Create/Read/Save/Rename 与响应关联由独立 executable IPC Contract 统一；Main/Preload 消费同一结构和 domain owner，大型 DesignDocument 每个边界只做一次结构解析，Renderer 仍只持稳定资源 ID 而不接触目录路径。Conversation 使用不可变 `originProjectId` 与可空/可移动 `filedProjectId` 表达组织关系；打开会话由 Main 从活动/最近 Run target 或归档 Project 默认文件恢复准确 Project/File/Page，目标不可用时进入只读 Timeline 并禁用 Composer。Workspace Home 以最近 Conversation 和 Project 为主要入口，任务生命周期并入 Conversation 行；创建 Project 直接采用原生选择目录名，Project-backed Design File 的首次 Agent prompt 会惰性创建 Conversation 后立即提交，不要求先填写名称或创建空会话。见 [ADR-0150](adr/0150-project-contextual-conversation-workbench.md) 与 [ADR-0198](adr/0198-project-design-file-ipc-contract.md)。
- 固定 `leafer-editor@2.2.9` 的唯一生产画布路径，覆盖场景投影、pan/zoom、命中、选择、move/resize/rotate/skew 和文本内编辑。OpenDesign 空 fills 的 Frame/Slot 显式投影透明 surface，避免 Leafer 将 `null` 回退为默认白色并遮挡底层 sibling。旧 Canvas2D、手写选择框和 OpenPencil 运行时已移除。
- 多 fill/stroke、渐变、图片 Paint、阴影/光晕/模糊、blend、mask、高级描边和事务化图片 asset 的公共设计语义及属性检查器/Leafer 映射。Image Service contract 8 提供不进入文档/history 的直接裁剪、区域选择与扩图 session，以及进入 Image 节点权威文档的七项非破坏调整、整图提示词编辑、独立背景替换、typed 重打光、区域 Erase/Isolate、四边/四角扩图和可信分辨率提升；扩图由 Main 生成受控 Provider canvas 与透明扩展 mask，并把原图保护矩形逐像素复合回结果，分辨率提升则从 source pixels 计算唯一合规目标且不改变节点几何，背景替换只接受新环境描述并由 Main 追加保主体指令，重打光只接受稳定 preset 并由 Main 生成保主体与构图的专业指令。单选 Image 可通过双击或 Inspector 在画布中裁剪、区域编辑、扩图、替换背景、重打光或提升分辨率，Inspector/Agent 可调整曝光、对比度、饱和度、色温、色调、高光和阴影，画布、capture 与位图导出共用同一 RGBA 投影。
- 当前 Design File 的真实 Assets 面板：图片从权威文档索引 Image 与 image paint 引用，提供安全预览、搜索、使用次数、跨 Page 定位、只携带稳定 asset ID 的画布拖放、导入、全引用 replace/relink 和零引用删除；同 Project Library 提供发布、启用、Component/Component Set/Shared Style/Variable 浏览、linked Instance/Style/Variable reference 插入、更新审阅/接受/忽略与禁用保留现有引用；其 Catalog、Publish、List、Read、Enable、Accept/Ignore IPC 已由 executable schema、集中 domain refinement 与稳定 Contract facade 分层拥有，不再由 Main/Preload 平行遍历字段。Agent 生成图片同时写入零引用 Design File asset；独立 Design Image Inspection Contract 只投影无源字节 metadata 与有界 source/result/mask/reference 派生关系，后续 Conversation/Run 可读取稳定 assetId 并直接放置，临时附件/路径/URL 权限仍为 Run-scoped。所有设计写入继续进入唯一 EditorRuntime，Renderer 不接收路径。字体授权、资源派生谱系、Workspace/远端 Library 和批量工作台尚未完成。
- Renderer 新建或实质修改的业务组件采用 Vite CSS Modules + 固定 Dart Sass 的 `Component.module.scss`，语义 design tokens 与应用 shell 保持全局；历史巨型全局样式仍在按垂直切片迁移，不能把首批 AssetsPanel/Canvas 模块化描述成全仓完成。应用级轻量反馈统一使用 `@opendesign/ui` 基于固定 Base UI Toast primitive 的 Message API；成功、普通信息与轻警告顶部短时呈现，错误、保真说明和需要恢复的状态继续留在对应上下文，不把一次性成功报告持久塞进 Inspector。
- 独立的 `@opendesign/geometry-service` contract 15：根入口提供多层排列与 Tidy up；固定 `pathkit-wasm 1.0.0` 的 `vector-path` 子入口提供受控 PathOps/outline 基础；`editable-vector` 验证稳定 vertex/segment/path/region ID、拓扑、path 与 tight bounds；`vector-edit` 负责非分支 contour 的节点/手柄/point mode、segment Bend、Connect/Disconnect、Open/Close/Reverse、节点/segment selection 所需几何、节点仿射 transform、point/path Delete，点击/拖拽 Cut，以及稳定 region 的序列化与 Fill 设置。Leafer Vector Edit 以 session-only `selectedVertexIds/selectedSegmentIds` 提供 Bend、`Q` Lasso、路径点击、高亮和跨 Vector document-space 统一节点变换框；resize/rotate 中按住 Space 可平移当前结果，松开后无跳变继续原操作。Runtime/Canvas/Agent 把 document-space 变换共轭回各层 node-local network，并把所有变化层提交为一次事务。删除 segment 会真实断开 contour，删除 vertex 继续重连相邻边。Cut 继续支持开放多交点、closed boundary graph、outer+hole stitching、凹形多 component 和多 Vector document-space 原子分割。`DesignDocument 1.48.0`、EditorRuntime、Leafer、Boolean resolver 与受控 SVG metadata v3 消费同一 network 事实；普通第三方 SVG 保留精确 path-data，不猜测 network。region-local Fill 已完成；vertex-local stroke appearance、region fillStyleId、跨层连接与分支网络、flatten、outline stroke，以及完整像素/双平台产品证据仍未完成，因此 capability 保持 `degraded`。
- 独立 `@opendesign/text-service` Text Layout contract v4 接受有界文字样式与 Auto Size 请求，当前由固定 `leafer-editor@2.2.9` provider 返回权威尺寸与字体 fallback warning；EditorRuntime 在 insert/update/replace 的同一事务中消费结果，WorkspaceRuntime 向活动、后台和后打开文件同步同一个 provider，不用字符数估算。
- `@opendesign/import-export-service` SVG v1 纯 service 可导入可编辑 Line/Path/Vector/基础 shape，并通过受控 marker/metadata 往返 Line 端点、Polygon/Star、editable-network point mode/Connect/Disconnect/Cut 拓扑和 Text Auto Size。Boolean result 作为标准 path 导出并返回 fidelity report。SVG service 已按方向性 owner 收口：Parse 独占不可信 XML/root/预算与 viewport，Normalize 独占 style/length/opacity/transform/Group rebase，Appearance 独占 Node/Shape/Paint/Gradient/Effect，Issue 独占 fidelity 结构，Serialize 独占 namespace/root/defs/title/XML/output budget，Import Nodes 与 Export Nodes 分别独占节点/容器/Mask/Frame assembly 和 traversal；Text、Filter、Mask/Clip、Editable Vector、Line Endpoint 与 Regular Shape 保持独立 family。公共 `svg.ts` 只保留版本化契约、root validation 与顶层编排。EditorRuntime planner、Main 路径不外泄的原生打开/保存桥、人工入口和 Agent run-scoped handle 复用同一可取消 worker，模型不接收 XML、路径或内部 ID prefix。独立 Design File、SVG 与 Raster 的 Native File IPC 由 executable Contract 统一 request/result、跨平台文件名、内容/字节/尺寸预算和 format/MIME 关系；Preload 对 open/save 双向验证，真实路径、对话框与原子写入仍只属于 Main。
- SVG v1 当前还可确定性往返圆角 Frame `clipsContent`、标准 `<text>/<tspan>` + 受控可编辑 Text metadata，以及按父容器 child order 分段的 alpha/luminance/outline/clipping sibling masks；受支持的第三方本地 user-space `<mask>/<clipPath>` 会展开为可编辑同级蒙版组。普通第三方 Text 的确定性字体布局、复杂组合 mask graph、Text/Image mask source、objectBoundingBox clip 与真实像素/双平台产品证据仍明确不在已完成范围。
- 运行于 `utilityProcess` 的持续 Agent Conversation、取消/恢复、多 Provider Catalog、OpenAI Responses、OpenAI Chat Completions、Anthropic Messages adapter 和 Main-only `safeStorage` 凭据。Provider Catalog/Profile/Model、保存/删除/测试、独立图片设置与 connection result 由 executable schemas、集中 domain refinement 和 Contract facade 统一，协议/auth/reasoning 直接复用 Model Gateway canonical schemas；Main 只读取当前配置，不再执行开发期 v1/v2/single-provider 兼容迁移。Agent↔Main 的 Session Store append/read/readTimeline/project bridge 由 executable Request/Response/Identity Contract 统一 wire shape；Durable Event、Timeline、Selection、Run failure/continuation 与附件直接使用 canonical Agent Contracts，JSONL/SQLite Store 不再维护 `run-state` 或手写协议副本。Main 仍唯一拥有持久化与路径；读取开发期损坏记录时只修复可丢弃 details、超长诊断或超长 reasoning，并保留整条消息。Agent Runtime→Main→Preload 的事件由 `AgentEventContract` 单次解析，结构规则只来自 canonical event schema，跨字段关系只来自集中 refinement；Supervisor 将同一解析结果交给 handshake 与 Host，非法事件按经窄 schema 验证的 Run/Request identity 转为可见、可关联的合法错误，不再在 Preload 静默丢失。Pi Tool definition 只保留必需的结构化 issues 入口；公开与 internal Design tools 直接映射各自 Contract，active call 在 hook/executor/terminal 间只解析一次，Main/Renderer boolean guard 只是同一 owner 的薄投影。Provider 渐进披露的阶段、surface、role、紧凑 schema 与 Delivery Scope 条件由 `ModelToolDisclosureContract` 唯一拥有，Runtime 初始目录和 Pi 阶段目录共用同一 Tool Definition safety owner，不再各自筛选或手写 disclosure 结构。Project/Design File/Conversation 描述符及 Conversation create/identity/list 由 `@opendesign/workspace-contracts/descriptors` 的 executable Contract 拥有；Preload 关联 Create/Delete/OpenContext 响应，Workspace Store 核对 JSON 与冗余列并拒绝静默丢记录。跨包结构校验统一复用只依赖 TypeBox 的 `@opendesign/contract-runtime`，该包不是自定义仓库门禁，也不承载 Main 状态策略。
- 版本化 `DesignCapabilityManifest v1`，按 contract/runtime/human/agent/render/export 六个表面记录 provider、限制与证据；Agent system context、`opendesign_get_capabilities`、生成式帮助文档和发布摘要读取同一事实源。能力状态不是设置项，不进入设置页。
- `@opendesign/model-gateway` 内部由 canonical wire、Runtime ports、response accumulator、Pi request/context projection、Pi stream/error projection、真实多协议 Provider 与 Mock Provider 独立 owner 组成；根 `index.ts` 只 re-export 稳定公共 API。三种 Provider 的协议选择、认证、reasoning、附件、retryability 与 terminal response 继续复用同一 canonical schema，不建立第二条模型执行路径。
- `@opendesign/figma-interop` 只以固定官方 Plugin API typings 验证公共兼容形状，内部按 Image、Auto Layout/Grid、Shared Style、Text Range、Export、Component Property 与 Variable 领域分离；根入口不实现业务逻辑。它不拥有文档、事务或渲染状态，Figma 类型不得泄漏到 Design Contracts、EditorRuntime 或 Renderer。
- Workspace Run Target/Access 数据由 `@opendesign/workspace-contracts/access` 的 executable Contracts 拥有：selection、primary target、Design File 唯一性、resource locator、root grant lifecycle、reference Run、Conversation scope 与 permission subset 返回稳定 code/path；根入口只保留薄 facade。该契约收敛不等于 attached roots、per-run handles 或完整 Trust/Capability/Approval/Sandbox 已完成，真实路径与授权状态仍只由 Main 管理。
- Global Task 与 Design Delivery 数据由 `@opendesign/workspace-contracts/delivery` 的 executable Contracts 拥有；active target、reservation、状态所需 revision 与单调关系返回稳定路径，并组合 Run Target domain refinement。开发期 v1/v2 Delivery 读取 normalizer 已删除，Workspace Store 对当前 projection 与 SQLite 冗余列失败关闭，不再静默过滤；当前技术 contract version 不作为产品版本展示。
- 当前 Provider 表面注册二十三个通用 typed tools，其中 `opendesign_generate_first_slice` 仅供高置信空白画布首轮使用；内部能力边界保持模块化，但 Provider 工具面只按真实职责重叠继续收敛。普通 node apply、hierarchy 与 arrange 已收敛为单一任务级 `opendesign_edit_design`，内部 planner/service/Contract 继续独立，没有把模块合成巨型 handler，也不再要求模型为普通历史设计重构选择唯一专用工具。`opendesign_generate_first_slice` 把当前 Plan v1、全部真实 artboard allocation 与第一 target 的真实 semantic slice 编译到既有 Main/Renderer/EditorRuntime 路径；首轮只与 recovery inspection 一起披露，成功材料 revision 后由 Main 立即走 canonical capture，再自动退出 model surface。当前 Plan 为每个 target 强制 executable quality profile：UI 明确 platform、interaction mode、safe-area insets、foreground IDs 和实际 hit-area IDs，图形交付明确使用 graphic；Layout Quality Report v6 在 capture 的 exact revision 上遍历真实 Component 派生 subtree 与完整 clipping ancestor chain，并继续执行安全区、平台最小交互尺寸、production-provider 文字裁剪、明确 hit-area 的真实多边形 overlap，以及同 parent 可证明不透明 later-sibling 的完全遮挡门禁。派生 issue 返回稳定 `instanceId + sourcePath`，projection ID 只作截图证据；确定性 error 先要求一次 `opendesign_edit_design` arrange `repair-overflow` 事务扩展安全 trailing-edge artboard/持久 clipping Frame，再重新 capture，不按 Frame 尺寸猜设备，不按字符数猜文字 shaping，也不把 AABB 或复杂 compositing 猜成遮挡事实。通用能力面包含 `opendesign_design_checkpoint`：它只在 apply 成功后 capture，或消费上一 capture 已返回的独立 Critic findings，在 refinement 成功后 final capture；不再要求作者重复提交 review。每个子阶段复用普通工具的 Coordinator/revision/ledger 路径，capture 单独失败时保留已提交 revision。其余 `opendesign_get_capabilities`、inspection、Plan、capture/review、矢量/组件/变量/样式/字体、图片、SVG 与 Raster 工具保持通用能力面。Run 默认绑定发送时当前 Page，Composer 不再常驻显示 Design File 写入范围；绑定 Page rename 可直接调用 `manage_pages`，创建/复制/排序/删除或跨 Page 修改则先申请一次性 Page 结构授权，批准后强制重新 inspect，并仅在本 Run、当前 Design File 内解析 effective execution context。`manage_pages` 与人工 Pages 导航共用 Page planner，宿主生成复制 Page/节点 ID；Page 生命周期不触发视觉设计 plan/review 门禁。统一 edit tool 对现有节点执行宿主计算的无损编组/解组、非破坏 Boolean 创建/切换/解组、保持多选内部顺序的前移/后移/置顶/置底、在 Page root、Frame 和 Group 之间保持世界坐标的跨容器重挂载、多层对齐、固定两端均分、明确一维间距，以及锚定左上角的一维/二维 Tidy up；模型只提交任务级 node/hierarchy/arrange entries，宿主按依赖投影并以一个 revision/undo 提交。`edit_vector` 只接受 inspect 所得稳定 Page/node/path/vertex/segment ID，单节点 node-local 有限切线，或多节点 document-space 公共切线与语义意图，由宿主共用 Geometry/EditorRuntime planner 推导 endpoint、connector、region、result node ID、bounds、transform 和原子 sibling 顺序，不允许模型重写完整 network，也不读取用户实时 selection；`update_image` 对明确 Page/node ID 执行非破坏 placement 或替换已授权来源；`import_svg` 只消费当前 Run 已授权的内容寻址 SVG 句柄，并导入 inspect 所得 Page/Frame/Group 的明确局部坐标；`export_svg` 与 `export_raster` 都只接受 inspect 所得稳定 Page/root ID，由 Main 打开原生保存框。SVG 工具不向模型暴露 XML 或路径，Raster 工具不向模型暴露 encoded bytes 或路径；Renderer 返回的 SVG/Raster preparation、SVG import result 与 fidelity issue 由同一 executable Contract 校验后才进入 Main 保存或完成链。人工图层树使用同一 hierarchy planner 提供 before/inside/after 拖放，Inspector 与 Agent 使用同一 Boolean/arrange/vector/image/SVG/Raster service；这些操作均保持单一文档事实状态，并在设计写入时以单次 revision 和单次撤销提交。专业层级、Boolean、排列、矢量拓扑、图片与导出操作不从用户选区隐式推导 Agent 目标。Agent 可把 Run 绑定 Page/计划 Frame 的确定性渲染和全局 GPT Image 2 生成结果作为有界、内容寻址的多模态图片回读，图片/文档/SVG 附件支持选择、剪贴板和拖放；SVG 作为可编辑资源句柄而非 Provider 图片/文档输入，图片还支持受限读取用户明示本地路径、`file:` URL 或 HTTP(S) URL；AI 图片编辑前的 embedded source、placement、target size 与 expected asset identity 由同一 prepared-source Contract 校验，非法结果不会进入外部图片服务。普通新建设计必须经过“读取 → typed plan → 实质初稿 → exact-revision 截图与确定性检查”的可信链路；需要主观质量判断的代表 UI、Logo 与品牌交付再运行独立 Critic，首稿达到全部阈值时直接验收，只有真实失败项才进入修正与再次截图。紧凑首轮和条件式 checkpoint 只合并宿主可确定的相邻步骤，不取消任何前置门禁或验收证据。详见 [ADR-0095](adr/0095-conditional-design-checkpoints.md)、[ADR-0096](adr/0096-plan-v6-ui-safe-area-and-interaction-quality.md)、[ADR-0097](adr/0097-exact-revision-text-clipping-quality.md)、[ADR-0098](adr/0098-versioned-built-in-ui-design-skills.md)、[ADR-0099](adr/0099-deterministic-interaction-overlap-and-occlusion.md)、[ADR-0116](adr/0116-component-projection-layout-quality-and-overflow-repair.md)、[ADR-0117](adr/0117-stateless-independent-visual-critic.md)、[ADR-0161](adr/0161-unified-provider-design-edit-tool.md) 与 [ADR-0233](adr/0233-first-slice-material-identity-and-honest-visual-acceptance.md)。
  ADR-0127 已取代用户可选的快速/精细分支。Composer 只保留 Provider/Model 与模型 reasoning 选择；宿主统一先提交首个真实可用 revision，再按交付类型自适应验收。普通明确编辑可由 exact-revision layout/inspection/structure 直接验收，Logo/品牌识别即使走 interactive watchdog 也必须经过一次有界独立 Critic 与证据驱动 refinement；所有路径继续共用同一事务、revision 和作用域边界。
  这里的“首轮合并”是模型编排合并：inspection 仍是 Main 的只读预检，不进入 history；真正共享一个 rollback-safe history group 的只有全部 Frame allocation 与第一 target 的材料 semantic stages。
- 长 brief 的交付范围使用 Main 选择的用户确认 Delivery Plan：文档附件、长文本、四项以上结构化 brief 或明确四个以上交付在首次设计写入前只披露 scope review 与 recovery inspect；普通聚焦请求继续 direct。用户确认的 deliverable、target 顺序/稳定 ID 与完整目标内容由 Scope 独立持有；executable Plan 是只覆盖当前未完成 target 的滚动阶段。当前阶段验证后 Main 返回下一确认 target，新 Plan 保留已完成稳定 ID 与 revision，最终完成门禁仍检查完整 Scope。Main producer、模型 Completion Guard、自动续跑与 Renderer Timeline 共同消费 `@opendesign/agent-contracts` 唯一拥有的 Design Delivery Stage Contract；planned/verified 数量、current Plan、next target 与用户可见阶段标题不再分别手写解释。Run 开始前的 exact-revision inspection 也以结构对象穿过 Main/Agent 边界，仅在最终 Provider prompt 投影时序列化，不再由各消费者重复解析 JSON。Delivery target 是当前 Page 下的 Frame/Artboard，不是文档 Page；同套产品默认一个 Page、多画板，target 数量不触发 Page 创建或授权。拒绝则以零画布写入取消当前 Run；Page/File capability 继续独立审批。见 [ADR-0148](adr/0148-user-confirmed-delivery-scope.md)、[ADR-0151](adr/0151-delivery-targets-are-artboards-not-pages.md)、[ADR-0160](adr/0160-rolling-executable-design-plans.md) 与 [ADR-0211](adr/0211-structured-initial-inspection-and-agent-request-contract.md)。
- 当前 Design Intent 使用 `surfaceMode + expressiveness + density` 三个短枚举校准同一 thesis/motif：UI 选择 persuade/operate/read/experience，非 UI 使用 graphic。校准由 brief 与真实任务推导，在 first-slice 同一次调用提交并由现有 Critic 消费，不增加用户设置、逐元素解释、Provider turn、Skill 数量或外部运行时；见 [ADR-0149](adr/0149-contextual-visual-calibration.md)。
- 当前生产模型、compact first-slice、持久恢复与 Renderer 只接受同一套 Design Plan v1 / Visual Review v1 / first-slice v1 契约。Plan 一次包含 target、quality profile、component strategy、brief fidelity、subject/audience/job、visual thesis、signature motif、字体/材质/构图张力、反模板项、可选 `referenceStrategy` 与由 Main 固定绑定的 skill refs；模型不再回抄宿主已知 hash。`referenceStrategy` 只声明当前 Run 中确实作为 style/composition/brand reference 或 content asset 使用的图片，未声明附件默认 ignore，问题截图不会阻塞 Plan 或设计写入；Main 拒绝跨 Run ID、重复 ID 和第三张 active reference。Design File 已有图片属于文档资产，后续 Run 通过稳定 `assetId` 继续使用，不回抄历史 attachmentId。Compact first-slice 允许 1–3 个真实 semantic stage 和最多 48 个模型内容元素；planned region 使用 parent-first、parent-local 几何，create target 的真实 region Frame 由 Main 在内容首次引用时统一注入，模型不重复创建 region ID，宿主容器不计入内容预算。聚合或结构校验失败返回字段路径，Pi schema 层发生的 design-write 失败也会阻止文字冒充完成，直到真实 revision 前进。交付账本 v3 为每个 target 持久保存 artboard/region/quality/component occurrence reservation，后续 Run 只能复用 inspection 已存在、当前 namespace 或精确 reservation 的节点 ID，不再让 amendment 稳定性与新 ID namespace 互相冲突。首轮自动装配有界的 deliverable-scoped `@opendesign/design-skills`，不新增工具往返：UI 使用 UI bundle，海报、Logo、品牌、插画、演示视觉与其他图形交付使用 Graphic bundle。LLM 根据传播任务自主选择证据媒介；真实人物、活动、地点、商品、食物、空间、材质或环境是说服力核心时声明并生成/放置图片，Logo、图标、信息图和明确矢量插画保持矢量优先，混合设计用图片承载主体证据、用可编辑图层承载文字与品牌。用户只有一个自适应执行入口：所有新设计先提交视觉成立的真实首屏并执行 exact-revision 确定性门禁，Logo/品牌等主观质量不能由结构规则证明的交付再由 Main 发起一次有界 stateless visual critic；达到阈值直接验收，只有真实失败项才进入证据驱动 refinement。active Plan 是 review skill refs 的唯一来源。产品尚未正式发布，旧实验 Plan v2–v7、Review v2 与 first-slice v2 已从生产类型、schema、validator、compiler 和恢复读取路径删除，不提供兼容 alias 或 fallback。见 [ADR-0098](adr/0098-versioned-built-in-ui-design-skills.md)、[ADR-0102](adr/0102-resilient-design-run-quality-protocol.md)、[ADR-0103](adr/0103-first-slice-contract-diagnostics-and-completion-recovery.md)、[ADR-0104](adr/0104-deliverable-scoped-design-skills-and-evidence-media.md)、[ADR-0105](adr/0105-cross-run-design-identity-and-file-assets.md)、[ADR-0118](adr/0118-bounded-design-reference-strategy.md)、[ADR-0127](adr/0127-adaptive-first-screen-quality-and-host-bound-content.md)、[ADR-0143](adr/0143-host-owned-hierarchical-first-slice-regions.md)、[ADR-0146](adr/0146-explicit-run-references-and-document-assets.md) 与 [ADR-0233](adr/0233-first-slice-material-identity-and-honest-visual-acceptance.md)。
  本段中仍出现的“快速 clean capture / 精细 Critic”是 ADR-0123 的历史实现说明；当前生产裁决以 ADR-0127 为准：Composer 无模式选择，Logo/品牌识别始终保留有界 Critic，普通明确编辑才可确定性直达。
- 对既有画板继续设计时，Main 只信任当前 Renderer `inspect_document` 的 document/revision/Page/node 层级投影：`artboard.mode=existing` 会验证目标 Frame 并解析完整后代集合，随后允许写入既有或新建的嵌套 Group/Frame；Project 落盘副本、用户活动 viewport、发送时选区和本 Run 新增节点缓存均不能取代这一权威祖先判定。stale/invalid inspection 与错误 existing Frame 返回稳定可恢复码，不把一次计划失败升级为 Run 终态。
- Renderer/Preload/Main/Agent 的运行时校验、最小环境变量 allowlist，以及按 run 分别冻结 Design File/revision、选区上下文与单一 Mutation Target 的设计工具桥。
- Main-owned 结构化诊断 JSONL 与单条诊断复制；Conversation/Run 绑定的任务错误在 Agent 对话内单点呈现，非任务级系统通知才投影到右下角；Agent Transcript 按 append-only journal sequence 保持用户正文、Assistant 正文、reasoning、tool 和 terminal result 的稳定原位置，history 以 `itemId + updatedAt/sequence` 单调合并而非整表替换，连续非错误工具只在展示层原位置折叠，同一结构化终态根因只显示一次；用户位于底部附近时跟随新消息和流式状态，上翻后暂停跟随。见 [ADR-0157](adr/0157-append-only-agent-transcript-projection.md)。
- Run 级 Renderer 设计工具熔断：同一任务的 apply/capture 连续两次停滞后，Main 以不可重试 `renderer_circuit_open` 终止当前模型循环，保留已提交 revision 与未完成交付，并阻止 durable continuation 自动重启同一故障；成功画布工具清零计数，普通 inspect 不掩盖持续截图故障。该能力是故障止损与可信恢复，不代表底层 Leafer capture/apply 停滞根因已修。
- Agent 大型设计事务的真实根分配、有序语义步骤、组件决策、语义 Agent cursor、Leafer 新增节点 reveal 与既有节点属性 tween：唯一 `DesignPlanToolInput version: 1` 同时承载多 target 与 LLM 明示的 component/ordinary 语义候选；Main 不按类别或次数猜测，并在最终检查中一次返回声明节点与真实 Frame/Group、Component Main、linked Instance 的有界非阻塞质量偏差。接受计划后立即通过同一 EditorRuntime 原子分配全部 target 的真实 Frame roots；accepted plan 不展示紫色 skeleton，旧实验计划直接拒绝。Main 从 accepted plan 编译计划 Frame 的可信 Page、parent 和局部几何，Provider 不把局部 bounds 重复换算成世界坐标；计划 region 待首个实质事务按全局唯一稳定 ID 连同真实内容创建。真实顶层 Frame 只平移时，cursor 跟随当前 transform，已建立目标内纯新增事务在 Renderer 复核尺寸、轴对齐和祖先链后可安全 rebase 到最新 revision；resize/rotate/reparent/delete/跨 Page 或覆盖既有节点仍要求重新 inspect。cursor 的阶段只来自固定 tool 生命周期，位置跟随已提交 revision 的新增或更新节点 focus point，不消费 Provider 自由文本。`opendesign_edit_design` 将普通 node、hierarchy 与 arrange edit 按依赖顺序通过同一 Runtime 投影，并以一个真实 revision/undo 原子提交；first-slice 与 checkpoint 的内部语义步骤仍只从实际提交的 revision 投影。新增节点按父级优先经历短暂线框与淡入，稳定匹配节点只插值实际变化的 transform/geometry/paint/effect/text/path 属性，不兼容语义有界 dissolve。reveal/tween 共用单 RAF 并按可见节点与实际帧时间调节节奏；同节点新 revision 从当前显示值 retarget，选区 editBox 同帧刷新。所有展示状态均可丢弃，不进入文档、history、selection、保存或导出；Reduced Motion、人工编辑、手动停止、Run 终态、切页、错误和截图恢复最终投影。Material write/capture/review 另以 observed document revision 建模，pan/zoom/选区/窗口变化不会制造冲突；可自动恢复的门禁错误返回稳定下一步并默认不堆叠红色时间线卡。Run 恢复另外以真实 design revision 为进度：同一工具 4 次 schema 失败或跨工具 8 次可恢复失败仍无 revision 时终止并保留已有设计，inspection 本身不冒充画布进度。见 ADR-0072、ADR-0098。

macOS arm64 与 Windows x64 已在同一 GitHub 原生 workflow 上分别通过 verify、protected Vite build、包内容检查、packaged executable/Agent smoke 和 artifact 上传；Windows 已产出 NSIS 与 `OpenDesign-Windows-X64` artifact。两平台签名、安装后的人工 GUI 产品 smoke 仍未完成，不能据此宣称达到发布门禁。尚未完成的其他主要目标包括：完整 Working Set/Mutation Targets/Capabilities、attached roots、通用 per-run resource handles、Main approval/audit/sandbox 执行链、跨 Project 多目标、完整 MCP 产品链、`fetch_reference`/隔离 `capture_reference`，以及能力基线中列出的专业矢量、布局、组件、变量、富文本和导入导出。

本文后续同时描述当前边界和已接受的目标架构；目标内容不能当作已完成事实。实施状态见[专业设计能力基线](design-capability-baseline.md)与[路线图](roadmap.md)，项目/跨目录边界见 [ADR-0006](adr/0006-project-conversation-agent-scope.md)，Workspace 级会话与目标恢复见 [ADR-0094](adr/0094-workspace-owned-conversations.md)。

## 2. 产品原则

### 2.1 人和 Agent 共用同一设计系统

人类操作和 Agent 操作最终进入同一套设计命令、约束、历史记录和撤销机制。Agent 不是自动点击 UI 的宏，也不拥有一条绕过校验的隐蔽写路径。

### 2.2 画布优先，AI 原生

画布始终是设计事实的可视化中心。AI 入口应贴近当前文档、选区、页面和任务上下文，支持“提议—预览—应用—撤销”的短反馈循环，而不是把设计工作降格为一次性聊天生成。

### 2.3 UI 优先，内核通用

首个成熟能力覆盖 UI 布局、组件、样式、设计 token、响应式状态和交付检查。公共对象模型同时保留通用图形能力，例如路径、文本、图片、蒙版、效果、约束、资源和导出配置。

### 2.4 本地优先且权限可见

文档编辑、历史和基础渲染默认在本地完成。外部模型、MCP 服务和 skills 只能在用户可理解的作用域内访问数据和执行能力，敏感动作需要显式同意并留下审计记录。

### 2.5 专业桌面体验

OpenDesign 追求高质量、低 Web 感的 Codex 式桌面 UI。应用应表现为稳定、紧凑且可长期工作的工具，而不是套在窗口中的网站：使用持久工作区、分栏、检查器、原生感菜单、快捷键、上下文命令和细致状态反馈；避免巨型圆角卡片、营销式 Hero、过量胶囊按钮和无功能的渐变装饰。

### 2.6 组织、上下文与权限分离

Project 用于组织设计文件和持久配置，不是文件系统 sandbox。Conversation 是 Workspace 一级实体；`originProjectId` 记录创建来源，`filedProjectId` 只是可空、可移动的归档关系。实际读取、写入和执行由每个 Run 的 `targetSet`、Working Set、Mutation Targets、Capabilities、Approval 与 Sandbox 决定。

### 2.7 跨平台是发布能力

OpenDesign 是跨平台桌面产品，不是 macOS 专用工具。macOS 与 Windows 同属一级支持平台：两者必须提供原生安装包，并通过启动、窗口/菜单、画布输入、文件选择、Project 保存重开、Agent utilityProcess、凭据存储、附件、模型调用、升级与卸载等平台 smoke。不能因为共享 Electron/TypeScript 代码或 macOS 测试通过，就推断 Windows 可用。

平台特有实现必须位于明确 adapter 或条件分支，并在另一一级平台具有等价行为或显式替代。Linux 仍是目标平台，构建配置和代码边界不得主动封死 Linux，但当前阶段 Linux 缺陷不阻塞 macOS/Windows 里程碑。

## 3. 核心工作流

1. 用户在 Workspace 中创建或打开 Project 与 Design File，并在 Page 的 Frame/Artboard 和 Layers 上直接编辑。
2. 用户可以从 Workspace 直接打开 Conversation，或通过选区命令、画布就地操作、Properties 和 Agent 面板描述目标；Conversation 的归档 Project 不限制本次 Run，Main 以显式 target 和授权资源确定实际 Project、Design File、Page 或目录引用。
3. 主机为 run 固定 Working Set、Mutation Targets 与 Capabilities。三者分别表达可读上下文、计划写目标和策略允许的动作，互不隐式授予。
4. Agent 读取经授权的最小上下文并返回结构化计划与设计事务；Tool Runtime 执行 Trust、Capability、Approval 与 Sandbox 检查。
5. OpenDesign EditorRuntime 按每个 Design File 的 `baseRevision` 预演或应用事务，并向 UI 返回变更集、冲突、诊断和渲染状态。
6. Project Design File 的新 revision 自动进入按文件串行的原子保存；Agent 写工具在对应 revision 持久化后才向模型返回成功。保存失败保留 dirty 状态并通知用户。
7. 用户检查单目标或多目标结果，继续编辑、处理冲突、接受替代方案或通过各 Design File 的统一历史撤销。

典型 UI 工作包括从需求生成首版、重排已有界面、建立 token、提取组件、检查一致性和生成交付说明。通用设计工作包括构图、文字层级、矢量编辑、资源替换、多尺寸变体和导出。

## 4. 产品范围

### 4.1 首要范围

- 无限或大范围 Web 画布、页面与多画板编辑。
- 选择、变换、对齐、布局、文本、矢量、图片、样式、组件和资源管理。
- UI 设计系统能力，包括 token、变体、响应式约束和可访问性检查。
- 上下文感知 Agent、可组合 skills、工具调用、方案预览和可撤销应用。
- 双向 MCP：连接外部数据与工具，以及向外部 Agent 暴露受控设计能力。
- 本地文档、导入导出和可恢复的编辑历史。

完整的专业设计能力范围、当前实现状态与后续协议门禁见 [专业设计能力基线](design-capability-baseline.md)。该基线用于避免按反馈逐项追加字段；分阶段交付不改变完整产品边界。

### 4.2 暂非目标

- 在第一阶段替代完整的视频、3D、CAD 或专业排版软件。
- 让模型直接拥有不受限制的 shell、网络、文件系统或引擎内存访问。
- 以特定模型供应商、特定 MCP 实现或 OpenPencil 私有对象作为公共产品协议。
- 用聊天记录充当设计文档的唯一事实来源。

### 4.3 资源层级

目标产品层级固定为：

```text
Workspace
└── Project
    └── Design File
        └── Page
            └── Frame / Artboard
                └── Layers
```

Workspace 聚合项目、会话入口、策略和连接配置，但不授权整个磁盘。Project 是组织、检索和默认上下文单元，不是 sandbox；它可以没有目录，也可以关联多个经批准的 attached roots。Design File 是持久化、revision 和冲突检测的基本文档单元，并包含一个或多个 Page。Frame/Artboard 是 Page 内的通用容器，Layers 是其下的节点树；这些名称不把内核限制为 UI 设计。

每层使用不依赖绝对路径的稳定 ID。Main 把用户选定路径映射为资源 ID 或不透明句柄；移动或重命名文件不应改变 Design File 身份。一个 Design File 只有一个权威 `EditorRuntime` 状态和单调 revision。

## 5. 系统上下文

```text
用户
  │
  ▼
Electron Renderer ── Web 画布、工作台、Project / Conversation / Agent UI
  │  仅类型化 preload API
  ▼
Electron Main ───── 路径/句柄、凭据、策略/审批、工具执行代理、进程监督
  ├──────────────► TypeScript Agent utilityProcess
  │                      ├──► 模型提供商
  │                      ├──► Skills（不受信任的说明与资源）
  │                      └──► 外部 MCP Servers
  └──────────────► Tool Runtime ─► 受限 worker / sandbox（按能力）

Electron Renderer
  ├──────────────► OpenDesign EditorRuntime（每个 Design File 的权威状态）
  │                  └──► Pages / 节点 / 事务 / revision / history / editor state
  └──────────────► Leafer Engine Adapter
                     └──► 当前 revision 场景投影 / viewport / hit test / direct manipulation

获准的外部 MCP Clients ─► OpenDesign MCP Server ─► 同一 Tool Runtime / 事务入口
```

Renderer 不直接接触 Node.js、Electron、模型密钥或引擎私有 API。Main 拥有路径解析、root/handle 登记、凭据、Capability 解析、Approval 绑定和工具执行代理；实际重负载可以在受限 worker 中执行，业务推理和长时 Agent 工作不进入主进程事件循环。Agent、skills 和 MCP 只接收受限结果或不透明句柄，不获得原始凭据或任意路径能力。

## 6. 逻辑组件

| 组件                | 职责                                                      | 明确不负责                           |
| ------------------- | --------------------------------------------------------- | ------------------------------------ |
| Desktop Shell       | 窗口、菜单、生命周期、路径/句柄、凭据、权限与安全 IPC     | 模型推理、具体设计语义               |
| Renderer Workbench  | 面板、命令、画布交互、可视化状态                          | 任意本地文件和密钥访问               |
| Resource Registry   | Workspace/Project/Design File 身份、attached roots        | 把 Project 当作授权 sandbox          |
| Design Contracts    | 通用节点、命令、事务、快照、诊断和版本                    | 具体渲染后端私有结构                 |
| Design Capabilities | 版本化能力状态、产品表面、provider、限制和验证证据        | 根据提示词或占位字段推断支持         |
| Editor Runtime      | 权威文档、事务、revision、history 与 editor session state | 产品 UI、模型供应商逻辑、画布渲染    |
| Geometry Service    | 确定性排列及后续几何 provider 的版本化纯输入输出          | 保存文档、修改 Leafer 场景、隐式选择 |
| Leafer Adapter      | 场景投影、绘制、viewport、命中、选择和直接操作            | 持久化事实、history、Agent           |
| Agent Runtime       | Conversation/run、上下文组装、计划、工具循环和恢复        | Electron 主进程特权、裸 fs/Bash      |
| Tool Runtime        | 工具注册、schema、Capability、Approval、审计与派发        | 自动扩大 skill 或 MCP 权限           |
| MCP Gateway         | 客户端和服务端传输、能力映射、身份与会话                  | 绕过 Tool Runtime 或事务入口         |
| Persistence         | 原子保存、恢复、版本迁移、会话日志和本地索引              | 把聊天文本当作设计状态               |

这些名称描述目标边界，不保证相应目录当前已完整实现。仓库中的包结构可以逐步承载这些职责，但应保持依赖方向从产品层指向契约层，而不是反向引用桌面实现。

### 6.1 当前模块依赖与治理边界

生产代码采用有向无环依赖：版本化 Contracts 位于底层；Geometry、Text、Image、Component 和 Import/Export 等纯 service 依赖 Contracts；EditorRuntime 组合 Contracts/service 并保持唯一权威状态；Leafer adapter 只建立当前 revision 的投影；Main、Preload、Agent 和 Renderer 通过可校验 shared bridge 隔离；Renderer feature 最后组合 Runtime、adapter 和窄宿主能力。Renderer、Shared 与 Contracts 均不能反向取得 Electron/Node/Main 实现或渲染后端私有对象。EditorRuntime 的 document normalize/freeze、跨服务完整 invariant 与 Image Asset Derivation DAG 由独立 owner 组合，Schema Contract 不反向依赖这些运行时服务。Design Contracts 的具体 schema 由独立 factory owner 持有，Node/Document 与 Operation/Transaction 两级 registry 只做单向组合，公共 Static 类型和 Contract/guard/migration facade 分离；根 `index.ts` 只稳定 re-export，包内生产模块不得反向依赖聚合入口。契约回归也按相同 owner 分组，共享 fixture 不复制结构规则。见 [ADR-0219](adr/0219-editor-document-invariant-owners.md)、[ADR-0220](adr/0220-design-contracts-editor-wire-owner.md)、[ADR-0221](adr/0221-design-change-set-and-transaction-wire-owners.md)、[ADR-0222](adr/0222-design-operation-schema-owners.md)、[ADR-0223](adr/0223-component-library-and-document-schema-owners.md)、[ADR-0224](adr/0224-node-appearance-schema-owners.md)、[ADR-0225](adr/0225-design-contracts-registry-and-facade.md) 与 [ADR-0226](adr/0226-design-contracts-test-owners.md)。

仓库不再维护独立的 package/process allowlist、源码数量、内容 hash、生成文档漂移或源码正则门禁。这些检查重复 manifest 与真实契约，并会在类型、行为测试和构建之前制造与产品可用性无关的失败。根 `pnpm verify` 只组合格式、lint、typecheck、行为测试与 build；macOS/Windows 原生 package、内容校验和 packaged Agent smoke 继续由双平台 CI 执行。进程与模块边界仍通过窄公共 exports、TypeScript 契约、实际调用测试、Electron 安全配置和 code review 维护；若某类边界错误真实复发，应在拥有该行为的包中增加针对性测试，而不是恢复全仓清单扫描。模块治理单元继续是包含状态、异步生命周期、错误恢复和测试的业务垂直切片。Renderer 现由固定 React Router 唯一持有 destination 与 history，生产使用 Hash history、测试使用 Memory history；`AppNavigationCoordinator` 只以 transition epoch 拒绝迟到的 Project/Conversation 打开结果；资源缺失不再误入 Editor。Project context 从 destination/Workspace identity 与 catalog 派生，活动文件名只读取 `WorkspaceRuntime` snapshot，不再维护 `activeProject` / `fileName` React 镜像。`EditorWorkbenchFeature` 只在 Editor destination 挂载，独占 Canvas shortcut/session、Inspector/selection projection、Image edit、Workbench layout、人工 Import/Export 和设计系统操作；Workspace、Project、Conversation 与 Settings 不建立这些 controller。切换 destination 会释放原生命令订阅和临时 UI 生命周期，但唯一 `EditorRuntime` 及其 document/revision/history/selection 仍由应用级 provider 保留。Main 的 `AgentSupervisor` 独占 utility-process generation、ready/handshake watchdog、协议失败、异常退出和有界停止；`AgentRunCoordinator` 独占 Run→Conversation、preflight cancellation、自动 continuation、Reference 授权及 Renderer/performance lease，并在进程异常或 shutdown 时统一释放。`AgentHost` 只保留模型与跨进程 bridge 状态。Main 使用 `DesktopApplication.start()` 原子推进一次启动：每个已获得资源立即登记 disposer，数据库/Store、诊断、菜单、Agent handler、IPC、Renderer load 或窗口失败时逆序回滚，IPC scope 只移除本次已成功注册的 channel，随后记录错误并非零退出。Renderer bundle 必须加载成功才能 commit；Agent 握手异步运行，不阻塞首个桌面窗口。Main↔Agent 的 tool wire contract 由 `@opendesign/agent-contracts` 单一拥有；Tool Call、Trusted Context、Failure/Result、Execution Event 与两段 bridge 直接组合权威 Contract issues，非法模型输入的 code/path 不再降级为 boolean 或 generic terminal error；Attachment/Model Selection/Agent Request、Event 与 Durable/Session Timeline 分别由独立 owner 持有，Model Selection 直接复用 Model Gateway canonical schema，package 根入口只做稳定导出。Agent Runtime 的 Run 投影直接派生 canonical `run.start`；runtime ports、journal→model message、上下文预算与 checkpoint 分属独立 owner，包内生产模块不再反向依赖聚合根入口，历史 assistant source 复用 canonical Model Identity Contract。生产 `MainDesignToolRuntime` 统一执行 semantic input、精确 Design File resource、Main 预授权、TrustedToolResult、输出边界、硬超时、取消、调用冲突和 silent audit，再委托领域 handler；`GlobalTaskCoordinator` 仍唯一拥有 Plan、ledger、revision、inspection、review 与目标规则。图片工具族由 `DesignImageToolHandler`/`DesignImageEditService` 持有 Run reference、Plan/delivery、Provider、internal transaction、像素编辑和 asset/derivation 物化；capture/review 由 `DesignCaptureReviewSession` 持有 exact-revision capture/inspection、layout gate、按需独立 critic 和 review registration；SVG/Raster import/export 由 `DesignImportExportToolHandler` 持有公开 Contract、inspection/visual-review policy、格式 host 委托和 SVG delivery；Page 由 `DesignPageToolHandler` 持有 structure preauthorization、Run capability、lifecycle 与 clear supersede；Component 由 `DesignComponentToolHandler` 持有 access、inspection、material classification 与 delivery。Main 入口只组合这些窄依赖。门禁退休裁决见 [ADR-0145](adr/0145-retire-custom-repository-gates.md)，Agent Runtime owner 见 [ADR-0214](adr/0214-agent-runtime-owner-boundaries.md)，工具族所有权见 [ADR-0162](adr/0162-main-design-image-tool-family-ownership.md)、[ADR-0163](adr/0163-main-design-capture-review-ownership.md)、[ADR-0164](adr/0164-main-design-import-export-tool-family-ownership.md) 与 [ADR-0165](adr/0165-main-design-page-and-component-tool-ownership.md)。
Main ↔ Preload ↔ Renderer 的 design-tool bridge 现以 Request/Cancel/Progress/Response 四个 executable Schema + Contract 作为唯一 envelope 结构入口；工具输入、Trusted context、capture-only target 与 prepared Raster/Image content 只保留一次领域 refinement。旧 record/safeId/exact-key/performance/capture-target 手写判断已删除，现有 IPC channel、correlation、revision、取消和错误语义不变。见 [ADR-0173](adr/0173-renderer-design-tool-bridge-contract.md)。

上段关于自有 `AppNavigator` 的描述已由 ADR-0142 取代：Renderer 当前固定使用 React Router，生产客户端采用 Hash Router，测试采用复用同一 route objects 的 Memory Router；它唯一持有 Workspace、Project、Conversation、Editor、Settings 与 invalid destination/历史栈。`AppNavigationCoordinator` 只以 transition epoch 拒绝迟到的 Project/Conversation 打开结果，不保存当前页面或建立第二套 store。`App.tsx` 只组合 Provider 与 Router，页面、应用布局和业务 feature 按职责目录归属。完整裁决见 [ADR-0142](adr/0142-react-router-desktop-navigation.md)。

## 7. Electron 进程模型

### 7.1 Renderer

Renderer 开启上下文隔离并关闭 Node.js 集成。它通过 preload 暴露的窄接口请求文件、引擎和 Agent 操作；接口使用明确的请求与响应类型，禁止暴露原始 `ipcRenderer`、任意通道名或通用 `execute` 方法。

### 7.2 Main 与 Preload

Main 负责可信调度和系统能力，所有入口校验来源、参数、资源身份、权限与取消信号。Main 拥有路径选择与规范化、符号链接和路径穿越检查、root/handle 映射、操作系统凭据、安全策略、审批绑定和工具执行代理；每次执行都重新确认句柄有效且目标仍在授权边界内。Preload 只完成能力桥接，不持有产品业务状态，也不把路径、凭据、事件对象或 Electron 原生对象传入页面。

### 7.3 Agent utilityProcess

Agent utility process 不拥有会话日志路径或文件系统写入口。`ParentSessionStore` 只发送受校验、无路径的 append/read/timeline/project 请求；Main 的 `AgentSessionStoreHost` 使用 Main 解析的应用数据路径和同一 `JsonlSessionStore` 执行持久化、启动恢复与请求取消。响应按 operation 校验并限制事件数量和序列化大小，错 operation、畸形事件和迟到响应都不会进入 Agent Runtime。

Agent Runtime 使用 TypeScript 并运行于 Electron `utilityProcess`。当前 `run.start` 包含 `sessionId`（承载产品 `conversationId`）、`runId`、prompt、model selection、可选的图片/文档/SVG 附件元数据、单个 `documentId`、revision、发送时的选区上下文与独立的单一 `mutationTarget`。选区只帮助模型理解用户当时关注的节点，不授予也不缩小写入范围；每个新 Run 的 Mutation Target 始终冻结为发送时活动 Page，Composer 只显示低权重 Page/选区上下文，不再提供 Design File 写入范围下拉；inspection 中的新节点 ID allocation 由 executable Contract 绑定当前 runId，只约束本 Run 新建实体而不限制历史节点编辑。任务开始后 Renderer 的选区、活动页面、tab 和 viewport 变化都不会改变原始 binding。需要创建、复制、排序、删除 Page 或跨 Page 修改时，模型调用 `opendesign_request_page_structure_access`；Main 只接受精确匹配 `runId + toolCallId + approvalId` 的“允许本次”，批准后删除旧 inspection，并仅为该 Run、该 Design File 解析 effective document execution context，终态自动回收。绑定 Page rename 不需要额外授权，拒绝不得重复申请绕过。新 `run.start` 必须携带 Mutation Target；历史 `message.user` journal 允许缺省该字段以继续读取旧会话，不会从旧选区反推或补授写权限。Renderer 不得提交 `modelContext` 或 `initialDesignInspection`；Main 从所选 Model Profile 解析 `contextWindow/maxOutputTokens`，并可在同一 Renderer inspection/Coordinator 边界取得 exact-revision、60,000 字符内的初始设计快照后再注入 utility process。Inspection 中 Plan/恢复实际消费的 document/Page/Node/Component hierarchy 由 executable Contract 统一结构与 document/revision/Run correlation，parser 只投影 Map/Set；顶层 diagnostic report 由 EditorRuntime Contract 统一 code/item/feature/count，并与 inspection document/revision/Page scope 关联。变量、样式和字体字段继续由 DesignDocument 与各自 service owner 管理。该快照只进入当前模型投影，journal 继续保存用户原文；失败回退公开 inspection。Main 在转发 Run 前根据当前 Project/Design File 注册并校验 host-bound revision；Conversation journal 只记录历史上下文，不得用历史最大 revision 覆盖当前活动文档事实。文档从持久化版本重新打开或放弃未保存修改后，即使 journal 曾记录更高 revision，也必须接受 Main 已验证的当前基线，后续写冲突仍由 Main 绑定与唯一 `EditorRuntime` 的 `baseRevision` 校验处理。Main-owned Conversation descriptor 只承载 `originProjectId`/`filedProjectId` 组织信息；Global Task 的 `targetSet` 承载真实 Project/File/Page 目标。当前按需 Page 授权不等同于完整 Working Set、多 Mutation Targets、通用能力快照/审批和跨 Project 多目标；这些扩展仍需要后续协议升级。Pi Tool Adapter 将阶段工具面、active call、approval、可信执行、revision/result 与恢复协调分为独立 owner；注册目录与每轮 Provider 可见工具面保持分离，不以一个万能 union 代替原子语义。Pi Run Event 入口只调度 Run，Message Controller 独占消息/Completion Guard，Tool Event Bridge 独占工具/approval/journal/revision 投影，不建立第二份 transcript。详细裁决见 [ADR-0029](adr/0029-contextual-page-structure-approval.md)、[ADR-0075](adr/0075-host-inspected-design-orchestrator.md)、[ADR-0094](adr/0094-workspace-owned-conversations.md)、[ADR-0215](adr/0215-pi-tool-adapter-owners.md) 与 [ADR-0216](adr/0216-pi-run-event-owners.md)。

当前唯一 `DesignPlan v1` 在这个单一 Design File 边界内提供 `1..N` 个交付 target，并声明通用 component/ordinary 语义候选：单个设计只产生一个 target，明确的一套界面、方案或物料按用户列出的交付项逐个产生。Target 是 Frame/Artboard 交付单位；同一产品套件无论 target 数量都默认位于 Run 绑定的当前 Page。只有用户明确要求 Page 级组织时才单独申请 Page 结构授权并重新检查，effective document execution context 才可覆盖多个 Page。Main 接受 plan 后，用一次原子、可撤销并立即 autosave 的内部事务为所有 `mode=create` target 创建真实 Page-root Frame；不预建 Region 或垃圾 Group。Global Task 持久 `DesignDeliveryLedger v3` 以 allocated 区分真实空根与材料 draft；allocated 不能 capture、verified 或冒充首稿。`activeTargetId` 决定默认 capture、恢复与 UI 焦点，但不是写入禁令：首个有意义 revision 出现后，一笔事务可以用真实 semantic steps 覆盖多个已声明 artboard，单条 move/reparent 仍不能跨 artboard。所有材料 target 都执行 exact-revision capture、确定性 layout、inspection 和结构检查；Logo/品牌等主观质量交付由宿主在首屏后自适应增加截图 Critic、refinement 与 final capture。completion guard 仍要求所有请求 target 有材料并 verified。Plan amendment 保留已落地 target/Page/root Frame、region 和材料语义节点 ID；意图变化把材料目标重置为 drafted。相同 plan 和续跑会从最新 inspection 复核真实 Frame：仅平移继续，resize/rotate/reparent/delete/undo 要求 inspect/amend。该交付账本不授予第二个 Design File/Project Mutation Target，也不等同于跨文件多目标事务；后一能力仍属于后续协议工作。详见 [ADR-0050](adr/0050-allocated-artboards-and-semantic-generation-steps.md)、[ADR-0062](adr/0062-agent-component-strategy-and-verification.md)、[ADR-0072](adr/0072-bounded-design-recovery-and-component-quality.md)、[ADR-0098](adr/0098-versioned-built-in-ui-design-skills.md)、[ADR-0127](adr/0127-adaptive-first-screen-quality-and-host-bound-content.md) 与 [ADR-0151](adr/0151-delivery-targets-are-artboards-not-pages.md)。

上述账本段落中的快速/精细分支已由 ADR-0127 取代：首个真实材料仍优先，普通明确编辑可确定性验收，Logo/品牌识别在同一自适应路径中进入 `reviewed → refined → verified`。

主进程负责启动、健康检查、限流、取消和异常重启。utilityProcess 默认不继承渲染页面权限，也不直接访问引擎、文件系统、shell 或凭据；所有工具执行都通过主机侧 Tool Runtime 进行策略判断和代理。详细决策见 [ADR-0002](adr/0002-agent-utility-process.md) 与 [ADR-0006](adr/0006-project-conversation-agent-scope.md)。

## 8. 设计引擎边界

OpenDesign 自己拥有文档模型与 `EditorRuntime`；`DesignDocument`、`DesignTransaction`、revision、diff、history、undo/redo 和持久化不委托给第三方引擎。Renderer 中的 `@opendesign/leafer-engine` 把活动 Page 的当前 revision 投影成 Leafer 场景，并隔离所有 Leafer 类型和 API。Leafer 负责渲染、DPR、资源生命周期、viewport 机制、坐标转换、命中测试、hover、选择器、框选、多选、变换控制框和文本内编辑。固定依赖记录在 `engine-baseline.json` 中，规范决策见 [ADR-0009](adr/0009-leafer-rendering-and-interaction-engine.md)。

Leafer 场景不是第二份可保存状态。手势期间 Leafer 可以临时改变投影以保证逐帧反馈；手势结束时，适配器只返回稳定节点 ID 和候选 `DesignOperation[]`。Renderer 使用当前 `documentId` 与 `baseRevision` 提交一条事务：成功后从新 revision 同步，冲突、取消或失败则从权威快照恢复。Agent、MCP、Main 和 utility process 永远不获得 Leafer 对象或私有 JSON。

`DesignDocument 1.48.0` 已把纯色、线性/径向/角度渐变、图片 Paint、多色标、投影、内阴影、内外光晕、图层/背景模糊、灰度、混合模式、蒙版、高级描边、正式 Line/Arrow、Polygon/Star、互斥的精确 SVG path-data / editable Vector Network、持久 corner/smooth/mirrored/independent point mode、Text 的 `auto-width/auto-height/fixed`、`none/word/character` 换行与 `visible/clip/ellipsis` 固定框溢出、Image 节点的 `Stretch / Fit / Fill / Crop` 非破坏 placement、普通 Frame constraints、Auto Layout 轴向 Fixed/Hug/Fill、Horizontal Wrap、Min/Max、Auto gap 与 Absolute child、Frame Uniform/Columns/Rows Layout Guide，以及保留有序源图层的 Boolean Group 定义为 OpenDesign 公共语义。Text 的 `size` 在所有 resize mode 下都保存由可信 Text Layout provider 生成或用户明确设置的具体权威边界；Leafer 投影不持有第二份尺寸事实。当前 provider 可报告字体 fallback，但 max-lines、字体 asset/替换、显式 reflow、富文本和确定性跨平台 shaping 仍待后续 Text/Font service。Pen 使用 network 创建单条开放或闭合 cubic contour；一个或多个已选且受支持的 Vector layers 可通过 Enter/双击进入同一 point-edit collection，全部显示独立 trace/anchors，Shift 点击加入 layer，macOS Command / Windows Control 点击切换成员，命中层成为 active；节点多选移动、手柄拖动、point mode、删除、同一 Vector endpoint Connect/Disconnect、明确 path 的开放/闭合与反转、点击/拖拽 Cut、Done/Escape 仍在每个完成动作以单事务提交。Connect 只接受两个真实开放 endpoint；同一路径两端复用 Close，不同 path runs 保留文档顺序较早的 path ID，重合断点合并 vertex，不同位置建立真实 connector。点击 Cut 在已有 vertex 或 line/cubic 任意位置建立两个坐标重合但拓扑独立的 endpoint；闭合 contour 变开放，开放 contour 拆成两个仍可编辑的 path run。拖拽 Cut 用一条 document-space 有限切线穿过编辑集合中的可写 Vector layers，Runtime 对每层 world transform 求逆并复用 node-local Geometry Service v15；开放 contour 按 traversal 上全部 transverse crossings 交替分片，不补 connector、不闭合、不创建 region 或隐式 Fill。闭合 contour 可有两次或更多 transverse crossings：切开的 outer/hole/concave boundary arcs 与同侧 connectors 构成无向图，cycle decomposition 重建连续 closed components；包含源 outer 起点的一块保留源 ID，其他 components 进入同一 sibling，穿过 outer + hole 时生成连续 single-loop boundaries，未切 holes 按真实包含关系进入对应 region。region Fill 支持继承 node Fill、显式无填充或独立 Paint，人工 Paint/Alt-clear 与 Agent 共用同一 Runtime 事务，Cut 结果传承有效 region Paint。全部结果按稳定 sibling 顺序在一次 pointer up、revision 和 undo 中提交，未命中层不变。画布 pan/zoom 只重投影逐层 overlay 和 node-local guide，不改变切线、geometry 或 revision。人工工具与专用 Agent vector tool 复用同一 Geometry Service 和 EditorRuntime planner，模型只提交 inspect 所得稳定 Page/node/path/vertex/segment ID、单节点 node-local 切线或多节点 document-space 公共切线与语义意图；结果 node ID、拓扑、bounds、transform 和插入顺序由宿主生成。Agent typed transaction、Leafer synthetic region/stroke projection、PathKit Boolean 和受控 SVG metadata v3 复用同一 network/region 事实；开放 sibling 导出标准无 `Z` SVG path，compound/crossed-hole/concave sibling 导出对应 closed subpaths 并可恢复 editable topology。vertex-local stroke appearance、region fillStyleId、跨层连接与 degree>2 分支网络、flatten 和 outline stroke 尚未完成。Line 保存归一化有向 start/end、独立端点和开放中心描边；Polygon/Star 保存顶点数、Star 内径和圆角。Boolean Group 持有 operation 与统一外观，不保存 PathKit 派生 path；开放 Line、没有 closed region 的开放 Vector 与尚无精确 outline 的圆角规则图形不会静默成为 Boolean fill operand。Crop 保存归一化焦点、缩放、旋转和翻转；原始 asset 不被改写。图片继续使用事务化 `DesignAsset`。外观规范见 [ADR-0010](adr/0010-open-design-appearance-image-and-reference-semantics.md)，路径与视觉复核规范见 [ADR-0012](adr/0012-formal-path-vector-and-visual-review.md)，图片 placement 规范见 [ADR-0019](adr/0019-versioned-image-placement-and-crop.md)，Boolean 规范见 [ADR-0022](adr/0022-versioned-nondestructive-boolean-groups.md)，SVG 规范见 [ADR-0023](adr/0023-versioned-svg-interchange-service.md)，Line/Arrow 规范见 [ADR-0024](adr/0024-versioned-line-arrow-semantics.md)，Polygon/Star 规范见 [ADR-0025](adr/0025-versioned-polygon-star-semantics.md)，editable Vector Network 与 Pen 规范见 [ADR-0026](adr/0026-versioned-editable-vector-network-and-pen.md)，已有矢量节点编辑规范见 [ADR-0027](adr/0027-versioned-vector-point-editing.md)，路径拓扑操作见 [ADR-0037](adr/0037-versioned-vector-topology-operations.md)，点击 Cut 见 [ADR-0038](adr/0038-versioned-vector-click-cut.md)，单层拖拽 Cut 见 [ADR-0039](adr/0039-versioned-vector-drag-cut.md)，多层编辑与 document-space Cut 见 [ADR-0040](adr/0040-multi-vector-edit-and-document-space-cut.md)，开放描边 Cut 见 [ADR-0041](adr/0041-versioned-open-stroke-drag-cut.md)，复合孔洞 Cut 重分配见 [ADR-0042](adr/0042-versioned-compound-hole-cut-redistribution.md)，穿孔与凹形多交点 Cut 见 [ADR-0044](adr/0044-versioned-crossed-hole-and-concave-cut.md)，同一 Vector Connect/Disconnect 见 [ADR-0112](adr/0112-same-vector-endpoint-connect-disconnect.md)，Vector Region Fill 见 [ADR-0232](adr/0232-vector-region-fill.md)，文字换行与溢出规范见 [ADR-0035](adr/0035-versioned-text-wrapping-and-overflow.md)，文字自动尺寸与测量边界见 [ADR-0036](adr/0036-versioned-text-auto-size-and-layout-service.md)。

上述综合清单中的文字部分已由 `DesignDocument 1.33.0`、Typography Core v2、Text Range v1、Text Paragraph v2、Text List v1、Text Editing Session v2 与 Text Run Layout v4 取代：旧 `textOverflow: ellipsis` 迁移为独立 clip + ending truncation；character runs 使用 UTF-16 `[start,end)`，paragraph runs 只在 LF/CRLF/CR 边界分段，二者完整覆盖、相邻合并。`update_text_range_style` 对 character fields 保持精确范围，对 paragraph indent/spacing/list options/level/list spacing 扩展到触及的完整段落；启用列表时零级归一为一级，direct-edit bounded diff、Auto Size、undo/save/reopen 全部进入唯一 Runtime。Text List Service 解析连续 block 与五级嵌套计数；Text Editing Session Service 在真实 Leafer edit root 中处理输入前缀、结构键、非空 range 暂存与 collapsed-caret typing style。caret override 只有在真实 UTF-16 输入后才物化为 run，移动 caret、Escape 或 stale revision 会清除/丢弃；普通 input/composition 不重建 edit DOM，`U+200B` marker 不进入 content、history 或 export。关闭 TextEditor 时只提交一条 `commit_text_edit` typed operation，由 Runtime 一次 remap、应用 optional character runs 与最小 paragraph patches、reflow 并生成一个 revision/undo。Leafer TextEditor 的 session selection 继续驱动 Inspector range/caret/Mixed 编辑，Inspector focus 不被抢回；Agent 仍只使用 inspected non-empty range transaction。生产画布、Agent capture 和 raster export 从 exact revision 派生 native Text fragments、HarfBuzz glyph Paths 与 disposable list markers，支持稳定 marker column、wrapped hanging indent 和 LTR/RTL logical-start 几何；失败保留权威 Text 并报告 fidelity warning，派生节点和 marker 均不持久化或写入 content。Figma styled segments 与 SVG metadata v8/styled `<tspan>` 已结构往返，exact face identity 仍不按 weight 猜造。Main 字体二进制继续只经用户显式导入、内容寻址且不向 Renderer 暴露路径；descriptor、payload 与 read request 由单一 executable Contract 校验 exact wire 结构，payload 只额外检查实际字节长度与声明一致，Preload 不维护第二套字段判断。当前文字缺口是 custom list markers、高级 decoration、OpenType/variable-font axis、绑定 range 的 Style 实时传播、字体随 Design File 打包与授权迁移、text-on-path、Unicode 13 之后 bidi 数据、原生 IME/undo smoke 及双平台确定性视觉门禁，见 [ADR-0074](adr/0074-typography-core-v2.md)、[ADR-0079](adr/0079-figma-compatible-text-range-core.md)、[ADR-0081](adr/0081-harfbuzz-complex-text-shaping.md)、[ADR-0082](adr/0082-figma-compatible-rich-text-runs.md)、[ADR-0083](adr/0083-figma-compatible-paragraph-style-runs.md)、[ADR-0084](adr/0084-figma-compatible-text-lists.md)、[ADR-0085](adr/0085-figma-compatible-text-list-editing-session.md)、[ADR-0087](adr/0087-figma-compatible-caret-typing-style.md) 与 [ADR-0175](adr/0175-font-binary-ipc-contract.md)。

组件解析规范见 [ADR-0045](adr/0045-versioned-components-and-instances.md)、[ADR-0063～0068](adr/0063-figma-compatible-component-properties.md)、[ADR-0106](adr/0106-figma-slot-composition-boundary.md)、[ADR-0107](adr/0107-figma-selection-and-component-targets.md)、[ADR-0108](adr/0108-figma-layer-state-and-canvas-hover.md) 与 [ADR-0124](adr/0124-cross-design-file-library-release-sources.md)；Shared Style Library 见 [ADR-0126](adr/0126-cross-design-file-shared-style-libraries.md)，Variables Core 与跨文件 Variable Library 分别见 [ADR-0069](adr/0069-figma-compatible-variables-core.md) 和 [ADR-0128](adr/0128-cross-design-file-variable-libraries.md)。Component Service 先物化 local 或 imported Main/Instance/Variant/Slot，Style Service 再解析 local/imported Style，Variable Service 最后按实际消费节点的 mode context 解析 local/imported alias chain，Canvas 与导出因此不会用 Main 所在 Page 的模式错误展开 Instance。同 Project Component/Variant/Shared Style/Variable Library 用户主流程与 Slot 内 nested Instance 的派生选择/编辑、lock/visibility override 已完成；更多 Variable binding 及 Figma Plugin/REST/DTCG 导入导出仍属后续切片；画布矩阵重排已实现。

OpenDesign 设计内核的目标能力族包括：

- 生命周期：创建、打开、关闭、保存、导入、导出和恢复文档。
- 查询：页面、节点、选区、资源、样式、能力和轻量快照。
- 事务：创建、更新、移动、删除、批量变更、预演、提交和撤销。
- 视图：Leafer 实现命中测试、缩放、视口、覆盖层和渲染失效；OpenDesign 只持久化产品需要的 session state，并通过适配器同步。
- 事件：文档变化、选区变化、历史变化、资源状态、诊断和崩溃恢复。

这些是跨 Contracts、EditorRuntime、Main host 和专业 service 的产品能力，不是 `@opendesign/leafer-engine` 单包接口清单。当前 `@opendesign/design-capabilities` 固定 `DesignCapabilityManifest v1`：每项能力同时记录 contract、runtime、human、agent、render 与 export 状态，只有必需表面全通且同时具备自动化和实机证据时才允许标记 `available`。组件首个同文件垂直切片、普通 Frame constraints 与线性 Auto Layout v1 均为 `degraded`；静态导出已由 SVG v1 和 Raster Export v1 贯通人工/Agent/Main 共享链，但批量/Slice/PDF/P3 与产品级双平台实机证据未完成，保持 `degraded`，不能从 schema 占位或第三方引擎说明推断支持。

Capability Manifest 的 Category、Capability、Status、Surface、本地化文案与 Evidence 现由一个 executable Schema + Contract 拥有；状态只从 required surfaces 与自动化/实机证据确定性派生。内置 JSON 只解析一次并深度冻结，Agent summary 与 capability tool 读取同一值，见 [ADR-0202](adr/0202-design-capability-manifest-contract.md)。

公共命令使用稳定 ID、预期文档版本和幂等/冲突语义。Design File 是 revision 与提交冲突的边界：不同文件可以并行；同一文件的权威 runtime 在短提交区间内串行处理，并对过期 `baseRevision` 返回结构化 `conflict`，不得静默覆盖。引擎缺少某项能力时返回 `unsupported`，不允许调用者猜测私有 API。详细决策见 [ADR-0003](adr/0003-design-engine-adapter.md) 与 [ADR-0006](adr/0006-project-conversation-agent-scope.md)。

Project Design File 打开后由 Renderer 以稳定 `projectId + designFileId + documentId` 绑定唯一 `EditorRuntime` 和自动保存协调器。普通人工变更短暂 debounce 后通过类型化 Preload 请求 Main；同一文件至多一个保存进行中，保存期间的新 revision 必须随后继续保存，响应的 File/Document/revision 必须与请求匹配，旧或错配结果不能把较新 revision 错误 checkpoint 为已持久化。Agent 事务得到新 revision 后会立即 flush 该目标文件，再把工具成功返回 Runtime；用户切换活动 tab 不会改变保存目标。Main 继续使用 Project mutation queue 与 crash-safe journal 原子提交文档和 manifest。自动保存失败保留 dirty 状态并生成包含 Project/File ID 的结构化诊断；关闭窗口或退出应用时先静默取消本次关闭并 flush 全部 pending Project 文件，失败则保持窗口与可恢复状态。Main 的 `before-quit` 只记录退出意图，ProjectHost、WorkspaceStore 与 Agent 等资源延后到 `will-quit` 才销毁；因此 Renderer 在 `Cmd+Q` 和 Windows 退出期间仍可保存，macOS 会在异步 flush 后恢复原退出意图。独立通过原生打开框加载的外部 `.opendesign` 不属于 Project autosave 范围，仍只在用户明确 Save/Save As 时覆盖。

Design File 名称是 Project manifest 中可变的展示属性，不是资源身份或物理路径。编辑器 tab 支持双击或 `F2` 内联重命名，`Enter`/失焦提交、`Escape` 取消；名称经过去除首尾空白、1–256 字符与控制字符校验，但不要求唯一。Renderer 只提交 `projectId + designFileId + name`，Preload/Main 重新校验，ProjectHost 使用 manifest-only crash-safe journal 更新 descriptor 与 Project 时间戳。操作不读取或顺带保存 `DesignDocument`，不改变 `designFileId`、`documentId`、relative path、revision、history 或 dirty 状态；与同 Project autosave 并发时进入同一 mutation queue。失败保持原名称和输入状态，并生成包含 Project/File ID 的诊断。

## 9. 项目、会话与内置设计 Agent

OpenDesign 的主产品路径是应用内部的垂直设计 Agent，而不是等待外部 Agent 通过 MCP 驱动。用户在工作台内选择模型提供商并描述目标；内置 Agent 理解经授权的设计文件、选区、设计系统、视觉结果和会话历史，通过 typed design tools 生成、检查和修改结构化设计。多模型 provider adapter 是产品基础能力，不能把模型选择或核心设计循环外包给外部 MCP 客户端。

新建设计的 plan 与视觉 review 是 Run-scoped、可丢弃的执行投影，不是第二份可写文档状态。Main 要求计划按用户需求声明 `1..N` 个交付 target，每个 target 明确一个 Frame/Artboard 和构图，同时共享视觉系统；单个设计只有一个 target，一套设计按明确交付项逐个建立。每个 target 的新图层进入自己的 Frame。create target 的 region 会编译为可信新结构；existing target 的 region 只表达逻辑规划/审查范围，不会强迫既有图层树创建同名直属容器或匹配计划 bounds，最终只验证真实 Frame 后代材料内容和完整 ledger 证据。Web/UI 与海报使用同一门禁：UI 额外强调 grid、density、typographic hierarchy、control state、form language 与 surface/depth，不能把重复圆角卡片或普通方块拼接描述为完成。每个 target 首次渲染截图后必须先记录结构化 review，才允许 refinement；持久交付账本在全部 target verified 前阻止完成。详细决策见 [ADR-0018](adr/0018-agent-design-plan-and-visual-review.md)。

生产模型当前提交唯一 Design Plan v1。Main 按 deliverable 绑定固定内置 Skill：UI 使用三个 UI skills，海报、Logo、品牌、插画、演示视觉与其他图形交付使用两个 Graphic skills；模型在首个材料写入前提交可验收的 visual thesis、signature motif、证据媒介判断，以及只包含主动采用图片的可选 referenceStrategy。未声明 raster 附件默认忽略，问题截图不构成写入门禁；临时 attachmentId 保持 Run-scoped，Design File 图片资产则通过稳定 assetId 跨 Run 使用。真实主题证据需要图片时，compact first-slice 可先落可编辑构图，随后生成/放置已声明 raster role；该图片写入会使旧 capture 失效并要求重新 capture，而不是被误当作 review 后 refinement。clean capture 后由 Main 使用同一 Run 的视觉模型发起全新 stateless critic request，只发送 brief、当前 target、exact-revision JPEG、review skills 和 Plan 授权的最多两张 visual references，不发送作者 Conversation/reasoning/tool history。宿主从 1..5 scorecard 计算非补偿 threshold；Draft 自动形成账本 Visual Review v1 并进入 refinement，Final 低分保持 refined，pass 才 verified。Skill/Review/Critic/Reference Strategy 都不进入 `DesignDocument`，也不冒充确定性几何事实；旧实验 Plan/Review 不再为会话恢复读取。见 [ADR-0098](adr/0098-versioned-built-in-ui-design-skills.md)、[ADR-0102](adr/0102-resilient-design-run-quality-protocol.md)、[ADR-0104](adr/0104-deliverable-scoped-design-skills-and-evidence-media.md)、[ADR-0117](adr/0117-stateless-independent-visual-critic.md)、[ADR-0118](adr/0118-bounded-design-reference-strategy.md) 与 [ADR-0146](adr/0146-explicit-run-references-and-document-assets.md)。

同一次 exact-revision inspection 还提供有界的 Design File-local Component catalog：当前 scope 已出现和高频 Component 优先，最多返回 64 项名称、说明、变体、属性类型与用量，不复制其他 Page 的 Main subtree。`componentStrategy` 可以声明 `reuse-component`，只绑定当前目录 `componentId` 与交付 target 内计划 Instance；Main 不从名称猜匹配，也不让目录授予跨 Page 写权限。Instance 仍由 typed Component Service 创建，Styles/Variables 继续使用 inspection 的正式定义。该目录不是跨文件 Library、发布源或更新协议；见 [ADR-0119](adr/0119-bounded-design-file-component-catalog.md)。

Design File-local Component catalog 的 Component、Variant Property、Component Property、usage 与 scope 摘要现由一个 executable Schema + Contract 拥有；Renderer 从 exact revision 生成同一结构，Main 保留 `/componentCatalog/components/...` 的准确失败路径。Catalog 仍是只读有界投影，不复制跨文件 Main subtree，也不从组织关系推导写权限，见 [ADR-0201](adr/0201-design-file-component-catalog-contract.md)。

Frame capture 还携带 `DesignLayoutQualityReport v6`。Renderer 从离屏 capture 使用的同一不可变 `DesignDocument` revision 计算世界坐标几何；Component Service 同 revision 生成可丢弃派生 subtree/provenance，生产 Leafer plain/rich text providers 对包含派生 Text 的真实子树生成 `TextLayoutQualityEvidence v1`；Main 验证报告的 document/revision/Page/Frame/profile 身份后才交给交付账本。当前确定性规则覆盖目标身份、Component resolution、内部 clipping ancestor chain、artboard 完全/部分/大面积越界、显式 UI safe area、平台最小交互尺寸、文字证据缺失和无 ending 声明的静默 clip；visible overflow 与实际 ending truncation 是不阻塞交付的 warning。存在 error 的 capture 不进入 Visual Review，而是先返回显式 `repair-layout-overflow`；安全右/下越界由一次可撤销 Runtime 事务扩展真实 artboard/持久 clipping Frame，unsafe 结构继续要求 inspect 后修正。报告不读取活动 viewport、selection 或截图像素，也不把启发式审美判断伪装成确定性事实。无作者上下文的独立 critic、有界 Style/Composition/Brand reference 与 Design File-local Component catalog 已由 ADR-0117/0118/0119 接入；ADR-0120 进一步固定 UI/Logo prompt、上下文预算、首轮工具面、真实 Run evidence contract 和匿名非补偿评分，但尚未产出真实打包产品盲评结论。普通结构 Pattern 聚类、Agent 跨文件 Library 检索/插入授权、持久 Brand Context、独立 critic model 配置、生成 rubric 与真实固定样张人工盲评仍是后续质量切片。详细决策见 [ADR-0034](adr/0034-deterministic-layout-quality-gate.md)、[ADR-0096](adr/0096-plan-v6-ui-safe-area-and-interaction-quality.md)、[ADR-0097](adr/0097-exact-revision-text-clipping-quality.md)、[ADR-0099](adr/0099-deterministic-interaction-overlap-and-occlusion.md)、[ADR-0116](adr/0116-component-projection-layout-quality-and-overflow-repair.md)、[ADR-0117](adr/0117-stateless-independent-visual-critic.md)、[ADR-0118](adr/0118-bounded-design-reference-strategy.md)、[ADR-0119](adr/0119-bounded-design-file-component-catalog.md) 与 [ADR-0120](adr/0120-current-build-design-skills-and-live-evaluation.md)。

Quality Profile、Text Evidence 与 Layout Report 分别由 Design Contracts、Text Service 与 EditorRuntime 的一个 executable Schema + Contract 拥有；Desktop Provider Schema 与嵌套 text measurement 直接组合这些 owner，旧手写结构副本已删除。Main 仍独立校验 document/revision/Page/Frame/profile 身份，见 [ADR-0200](adr/0200-design-quality-contract-ownership.md)。

Active Page 的 top-level Frame、Component Main root 与 Slice 还会在画布边界上方投影固定屏幕字号名称；位置只由权威 world bounds 和 viewport 计算，离屏不挂载，点击只更新唯一 EditorRuntime selection。标签属于 Renderer overlay，不进入 Leafer scene、文档、history、capture 或 export，见 [ADR-0203](adr/0203-top-level-canvas-frame-labels.md)。

Agent 的画布生成过程以正式设计事实为主，可丢弃展示只投影已经提交的 revision。accepted plan 不再显示紫色 skeleton，而是由 Main 立即分配真实 Frame。`opendesign_edit_design` 可按真实依赖顺序组合普通 node、hierarchy 与 arrange edit，Renderer 对每个中间 command set 使用唯一 EditorRuntime 流水线做只读投影，最终只产生一个 revision/undo；first-slice 与 checkpoint 的内部 semantic steps 继续按真实提交投影，不按命令条数制造过程。各步骤共享 rollback-safe history group，取消回滚；实时 progress 和 durable `committedSteps` 只携带有界 label/revision，Timeline 为每个真实 revision 显示独立步骤并在刷新后去重重建。阶段间优先等待真实 animation frame，默认无固定人为 delay；Electron 因窗口后台、遮挡或 GPU 状态暂停 RAF 时，单帧等待 250ms 后继续，不能让已提交语义步骤卡到 Renderer idle timeout。Leafer reveal/tween、focus point 与 Agent cursor 继续消费这些真实 revision；cursor 只有真实 Frame 存在时出现。Provider 自由文本、partial JSON 和展示属性不写入文档。普通 hover 不绘制无信息灰框。新建设计首稿后的 Provider continuation 继续使用 `new-design` surface，只披露当前阶段必需的真实继续入口，不再因实现错误一次性展开完整专业 catalog；统一编辑仍保留基础节点写入与确定性布局修复，设计系统只投影 Component Main/Instance 创建。需要高级矢量、字体、图片编辑、导入导出或 Page 生命周期的明确后续编辑 Run 才进入 general surface。详见 [ADR-0049](adr/0049-trusted-generation-order-and-presentation.md)、[ADR-0050](adr/0050-allocated-artboards-and-semantic-generation-steps.md) 与 [ADR-0230](adr/0230-compact-new-design-continuation-surface.md)。

生产工具 catalog 采用只影响 Provider 视图的渐进披露。Main 初始预检成功时，首个 Provider turn 发送 inspect refresh、Plan、显式 read-image、Page 授权/生命周期和基础 `opendesign_edit_design` node edit；普通新建设计可在同一 assistant turn 按 `Plan → 首个真实切片` 顺序提交，Main 先分配 Frame roots并推进 revision，再执行材料事务。image generation 仍等待 accepted Plan 声明角色。预检不可用时保留原七工具 bootstrap，公开 inspection 后只增加 Capability 与 SVG/Raster Export，create-artboard Plan 与首个材料切片继续保持轻量视图。基础 edit_design node edit 仅包含 Frame/Group/Rectangle/Ellipse/Text、solid paint 和基本 insert/update/move/delete。create Plan 分配的真实空 Frame 不算材料进展；第一笔材料 revision 后，新建设计进入带基础节点写入、确定性布局修复和组件 authoring 的紧凑 continuation，普通 general Run 才在材料 revision 后开放完整专业 catalog 与完整 edit_design schema；existing-artboard Plan 仍在下一轮直接开放专业编辑工具。各视图执行同一原始 tool definition、完整 runtime validator、Main host、EditorRuntime、approval、revision 和 history，不存在 bootstrap executor 或第二份设计状态。工具视图变化会重新计算 Model Profile fixed protocol budget。详见 [ADR-0073](adr/0073-progressive-agent-tool-disclosure-and-bootstrap-apply.md)、[ADR-0075](adr/0075-host-inspected-design-orchestrator.md)、[ADR-0078](adr/0078-host-inspected-plan-and-first-slice-turn.md)、[ADR-0161](adr/0161-unified-provider-design-edit-tool.md) 与 [ADR-0230](adr/0230-compact-new-design-continuation-surface.md)。

Agent 参考 Pi/OpenCode 的工程思路：保持核心循环小而透明，以消息、工具、事件和持久会话为基础，通过 provider adapter、skills 和 MCP Client 扩展。生产 Model Gateway 已通过 OpenDesign canonical adapter 使用固定 `@earendil-works/pi-ai 0.84.1`；ADR-0020 接受固定 `@earendil-works/pi-agent-core 0.84.1` 的 headless `Agent`。阶段 1—3 已完成三种 API identity、`AgentEvent 3.8`、唯一 journal writer、完整生产设计工具目录、plan/review completion guard、取消/失败分流、累计 checkpoint、逐轮 `transformContext` 预算压缩和内容寻址多模态/资源句柄投影。utilityProcess 的唯一生产入口现为 `OpenDesignPiRuntime`；旧自研通用循环及其测试已删除，没有双循环或 fallback，设计事务、权限、凭据、revision、journal 和恢复仍由 OpenDesign 边界拥有。compact first-slice 两工具首轮、完整 catalog、200K 配置和八轮多模态循环均有契约证据，Pi transcript 不含 inline base64、SVG XML 或 raster export bytes；当前待同一 commit 的 macOS/Windows protected package 与 packaged Agent smoke 后关闭迁移。固定版本的 `AgentHarness.prompt()` 仍抛出 `HarnessNotImplemented`，Pi Coding Agent、TUI、文件/shell 工具、凭据和资源发现不进入产品路径。详细裁决见 [ADR-0020](adr/0020-pi-headless-agent-loop-migration.md) 与 [ADR-0073](adr/0073-progressive-agent-tool-disclosure-and-bootstrap-apply.md)。

### 当前模型 Provider 边界

`AgentRequest / AgentEvent 3.8` 把 Provider 失败作为受限结构化 `AgentRunFailure` 从 Main canonical Model Gateway 贯通到 utilityProcess、durable `run.state`、session history、诊断与 Timeline。首响应、流空闲和总时限分别保留 `phase + thresholdMs`，并明确携带 `retryable`、Provider 身份、已知的 Provider request ID 与始终由 model bridge 注入的本地 model request ID；首响应前上游尚未返回 ID 时明确记为 unavailable，不伪造。Main 对普通 Provider 连接中断在首次请求后最多重连 5 次，Timeline 用一条 `正在重新连接 N/5` 活态覆盖展示；每个 attempt 的语义事件先缓冲到 terminal，失败 attempt 的半截文字、推理和 tool call 不进入 Pi 或 journal。用户取消、不可重试失败和精确 watchdog timeout 不重连。Renderer 设计工具使用独立的首确认、90 秒活动空闲和 15 分钟总时限；accepted/applying/capturing/persisting 进度只续租空闲时限，总上限不可续。其结构化 `renderer_*_timeout` 明确显示为画布操作问题，不能按错误字符串猜成 Provider/模型超时。旧无 failure journal 保持可读。详细裁决见 [ADR-0030](adr/0030-structured-provider-failures-and-run-history.md) 与 [ADR-0043](adr/0043-bounded-provider-reconnect.md)。

Agent 的视觉审查 JPEG 使用隔离的离屏 Leafer App：等待该 App 的真实 `waitViewCompleted` 后调用固定 export plugin 的同步 `UI.syncExport`，严格解码 data URL；geometry/readiness 等可等待阶段受 Renderer 30 秒 deadline 与销毁路径约束，同步编码则由 `1280×960` 审查尺寸硬上限约束工作量。它不再进入 `@leafer-in/export 2.2.9` 包级串行异步任务队列，因此一次挂起的 `waitViewCompleted/canvasToBlob` 不能毒化后续独立 capture。用户显式专业交付导出继续使用独立异步 Blob 工作流；两者不共享完成语义。见 [ADR-0054](adr/0054-isolated-agent-capture-export.md)。

桌面设置页实现版本化 `ModelProviderCatalog v3`。每个 Provider profile 只保存对话推理所需的稳定 ID、名称、启用状态、对话 API 格式、鉴权方式、Base URL 和模型能力列表；能力区分 tool use、图片输入与 reasoning，不包含图片生成。当前对话 API 格式为 OpenAI Responses、OpenAI Chat Completions 与 Anthropic Messages，新建自定义 Provider 默认 Chat Completions。连接测试先验证文本传输，再验证一个无副作用的三参数工具调用，并严格区分 `compatible / text-only / unreachable`；模型能力勾选仍只是配置声明，不能让文本可达冒充 Agent 兼容。OpenAI-compatible Chat 返回的 `reasoning_content/reasoning/reasoning_text` 属于原始推理流，不进入 canonical summary、journal 或 Timeline，只保留 usage reasoning token；Responses/Anthropic 明确提供的有界 summary 继续可见。Provider API Key 按 `providerId` 由 Electron `safeStorage` 加密后存入 Main-only `WorkspaceStore`，Renderer 只能读取 `hasApiKey`，不会收到明文或密文。v1/v2 Catalog 确定性升级到 v3，v2 中的图片生成字段在迁移后剥离。详见 [ADR-0048](adr/0048-provider-agent-compatibility-preflight.md)。

Agent composer 在每个 Conversation 中只选择 `Provider/Model` 与模型支持的 reasoning effort，不再要求用户选择生成深度。`AgentRequest` 把这些选择、发送时选区、单一 Mutation Target 和可选的内容寻址附件显式放入 `run.start`，run journal 保存对应快照与附件元数据；Main 只解析并执行该会话选择，并从可信 Model Profile 补入上下文预算。当前交互请求使用 Main-owned interactive Provider watchdog（60 秒首响应、60 秒流空闲、5 分钟单请求总时限），但宿主质量策略按交付类型自适应：首个真实可用 revision 优先，普通明确编辑可确定性验收，Logo/品牌识别必须执行一次有界 Critic 与一次证据精修。发送时选区只作为模型上下文，`opendesign_edit_design`、`opendesign_update_image`、`opendesign_edit_image` 与 `opendesign_import_svg` 等写工具必须携带检查结果中的稳定资源 ID，不能把该选区或用户执行期间变化的实时选区当作写目标。图片生成与编辑复用独立的应用级 `GlobalImageGenerationSettings v1` 配置，拥有启用状态、API adapter、Base URL、鉴权方式、独立 API Key 和用户模型 ID。它位于设置页单独的全局图片服务入口，不写入 Project、Conversation、`run.start` 或图片 tool 的 Provider/Model 参数；切换、保存或删除 Conversation Provider 都不能覆盖或补全该配置。当前 adapter 为 `openai-images`：生成使用 `/images/generations`，去背景、背景替换、整图提示词编辑、区域 Erase/Isolate、扩图和分辨率提升使用 `/images/edits`；背景替换只提交一张源图和用户的新环境描述，由 Main 追加固定保主体语义；提示词编辑允许一张可选参考图，区域编辑由 Main 从受校验的归一化源图 lasso 生成同源尺寸 PNG mask，扩图由 Main 根据受控边距和 placement 生成 Provider canvas/mask 并在返回后逐像素恢复未扩展的原图保护区，分辨率提升由 Image Service 从真实 source pixels 计算唯一合规输出并保持节点设计几何。首个验证模型是 `gpt-image-2`，但模型 ID 由用户填写且没有运行时名称分支。后续不同协议通过版本化窄 adapter 增加，不改变 Agent tool 参数或重新并入 Provider Catalog。见 [ADR-0121](adr/0121-generation-depth-and-request-scoped-logo-delivery.md)、[ADR-0127](adr/0127-adaptive-first-screen-quality-and-host-bound-content.md)、[ADR-0134](adr/0134-trusted-prompt-image-editing.md)、[ADR-0135](adr/0135-trusted-area-image-editing.md)、[ADR-0136](adr/0136-trusted-image-expansion.md)、[ADR-0137](adr/0137-trusted-image-resolution-boost.md) 与 [ADR-0138](adr/0138-trusted-image-background-replacement.md)。

一条消息最多包含 6 个附件，单个不超过 16 MB、合计不超过 32 MB。Main 按真实内容与受控扩展识别图片、SVG 和受支持文档，不要求用户预先选择类型；raster 图片使用 `image_<sha256>`，文档使用绑定 MIME 的 `file_<sha256>`，SVG 使用绑定 `image/svg+xml` 的 `svg_<sha256>`。PDF/DOCX/UTF-8 文本文档在 Main 中提取为最多 200,000 字符的只读参考上下文，DOCX 先经过条目数、展开大小、压缩比、加密和路径检查；SVG 不提取为文本，也不作为 Provider image/document block，只把 handle/name/byteSize 投影给模型并等待 typed import tool。只有包含 raster 图片的请求才要求模型声明 `imageInput`；纯文档或 SVG 句柄请求可以发送给文本模型。文件选择器、内容/扩展名/大小校验、SHA-256 存储和完整性复验都在 Main 中完成，模型 bridge 不接受 utility process 提交 inline base64、SVG XML 或任意路径。Agent 附件 selection/import/preview 与 Design Image selection/edit/cancel 由 executable Media Input schemas、集中 domain refinement 和稳定 Contract facade 分层拥有；preview MIME、内嵌资产、action 分支及 derivation/supporting identity 不再由 Desktop API 平行遍历。Canonical Model Wire 的 Selection、Resolved Identity、Message/Block、Tool、Serializable Request 与八类 Stream Event 由 `@opendesign/model-gateway` 的同一 TypeBox Schema 和 Static 类型拥有；Desktop Model Bridge 只组合 Request/Cancel/Response envelope 与工具字节、reference MIME、inline-image 禁止 refinement，不再手写另一套 event switch。`ParentModelGateway` 通过内部、受校验的 model bridge 把可序列化请求交给 Main；Main 在发起网络请求时才解密对应 Conversation Provider 凭据、解析获准附件 ID，把 raster 图片转成原生多模态 block、把文档转成带不可信边界标记的 text block，再通过固定 adapter 适配三种协议。SVG 只在 `opendesign_import_svg` 执行时由 Main 复核当前 Run 授权并物化到 Renderer worker。图片生成和编辑请求由独立 `ImageGenerationHost` 解密同一份全局图片服务凭据并执行。模型桥接受完整生产设计工具契约，并同时限制单工具 schema 与工具集合总大小；任何跨进程请求/响应校验失败都会回传可关联的失败终态，不能只写日志后丢弃。取消通过关联 `requestId` 的 `AbortController` 传递。生产模型流由 Main 同时执行 180 秒首响应、120 秒流空闲和 15 分钟总时限 watchdog；普通可重试连接中断使用最多 5 次 bounded reconnect，重连退避计入同一 15 分钟总时限，取消会停止当前 iterator 与退避。图片生成和编辑有独立 10 分钟上限。应用启动时还会把 JSONL 中孤立的 started Run 和 pending tool 终结为可恢复错误，避免重启后保留假运行状态。该链路不授予 Agent 原始凭据、任意网络入口或文件系统能力。typed tools 只操作 Main 绑定到 run 的 Design File、可信 Page/计划 Frame capture target、默认 Page Mutation Target、获准后的同文件 effective document target、Run-scoped plan/review、当前 run 明示引用、只读 capability manifest、独立全局图片服务配置或 Main 原生 SVG/Raster import-export 入口，并通过受校验的事务/附件/审批/交付桥执行。用户当前活动 tab 和 viewport 不参与工具目标解析。SVG 导入/导出与 Raster 导出都要求先 inspect，只接受稳定资源 ID；SVG 导入执行一次原子事务并自动选中新根，SVG/Raster 导出由 Main 打开保存框，模型不接收 SVG 源码、Raster bytes、内部 ID 前缀或路径。Page 结构审批已实现精确 Run/tool/approval 绑定、拒绝、发送回滚和终态回收；每次 run 的完整外发数据预览、通用跨资源 Main approval bridge 和完整工具审计策略链仍未实现。详细决策见 [ADR-0007](adr/0007-main-hosted-model-provider.md)、[ADR-0008](adr/0008-multi-provider-model-catalog.md)、[ADR-0013](adr/0013-global-gpt-image-generation.md)、[ADR-0014](adr/0014-standalone-global-image-generation-settings.md)、[ADR-0015](adr/0015-versioned-design-capability-manifest.md)、[ADR-0018](adr/0018-agent-design-plan-and-visual-review.md)、[ADR-0023](adr/0023-versioned-svg-interchange-service.md)、[ADR-0029](adr/0029-contextual-page-structure-approval.md)、[ADR-0031](adr/0031-versioned-professional-raster-export.md)、[ADR-0043](adr/0043-bounded-provider-reconnect.md) 与 [ADR-0095](adr/0095-conditional-design-checkpoints.md)。

Conversation 的原始 append-only journal 与模型上下文投影分离。Agent Runtime 在完整 run 边界把旧事件写成累计 `context.compacted` checkpoint，并在同一 Run 的每个 Provider turn 前重新预算；较早的 assistant/tool 段在超限时进入临时有界 checkpoint，当前用户原文和最近完整 tool call/result 段继续保留。checkpoint 只含有界消息摘录、附件元数据、工具统计和最新 design revision，原始 Timeline 与工具审计不删除。模型投影会同时限制超长单字段和大量短字段组成的超大结构化工具结果，原始 journal 仍保存完整审计。Main 注入所选 Model Profile 的 `contextWindow/maxOutputTokens`，Agent 对文字、图片、文档、工具 schema 和输出预留做保守 token 估算；有可信模型窗口时 token 预算是唯一硬门禁，本地字符限制只用于缺少模型窗口元数据的保底路径。固定协议装不下返回 `model_context_incompatible`，最小必要上下文仍过大才返回 `context_budget_exceeded`；两类错误按 system、tool schemas、Conversation/tool results 和请求 framing 提供估算分账。Run 级防失控限制另外使用 turn、tool-call 与实际 Provider output 预算；重复 input 只受每轮窗口约束，不会在工具往返时反复累计并把未完成 delivery 提前终止。模型可见设计工具使用紧凑跨 Provider Schema，所有工具输入仍由完整运行时 Schema 重新验证。Pi→canonical Message/attachment/Tool 与 canonical→Pi stream 分别由独立 owner 投影，入口只创建请求并调用 Main-proxied ModelGateway，不解析凭据或建立 Provider 旁路；canonical→Pi transcript 的纯消息转换又与动态预算/current prompt/attachment WeakMap 状态分离。服务端模型元数据探测、精确 tokenizer/image 预算、可替换语义 compactor 与上游超限单次恢复仍未完成，详见 [ADR-0016](adr/0016-durable-agent-context-compaction.md)、[ADR-0017](adr/0017-model-token-budget-authority.md)、[ADR-0217](adr/0217-pi-model-gateway-owners.md) 与 [ADR-0218](adr/0218-pi-context-projection-owner.md)。

专业设计回归使用 `fixtures/professional/manifest.json` 作为手动样张证据索引。每个样张分别保存固定 prompt、干净初稿、一个可校验 refinement 事务和预期最终 `.opendesign` 文档；生成器记录 SHA-256，但生成内容或 hash 漂移不再阻塞普通 push。EditorRuntime 与 Leafer 的纯测试直接验证事务、历史和投影；旧 Electron fixture smoke bridge 已退休，fixture 不进入安装包。当前结构自动化不冒充像素视觉、真实 Agent 工具轨迹、专业导出或 macOS/Windows 实机验收。

用户请求停止后，Renderer 立即把对应 Run 显示为“正在停止”并去除流式活动光标，但在 `run.completed` 或失败终态到达前仍保持并发占用。终态会兜底结束该 Run 遗留的 partial message、tool 与 approval 活动态，避免对话中残留看似仍在运行的蓝色光标。

Timeline 把最后一个 Run 的 error/budget 作为当前高权重状态，显示具体 failure、阈值、重试语义和请求关联；后续 Run 一旦开始，之前 Run 的失败转为原时间位置上的中性紧凑历史行，旧 cancelled/completed 终态折叠，不再用“任务已停止”或旧错误边框冒充当前结果。活动 Run 的 `message/tool/approval/run` checkpoint 会 debounce 回读 durable `session.history`；live delta/progress 按稳定 ID 合并，只补充尚未持久投影的活动状态，不再以 200 条窗口截断旧消息。任何包含真实 text block 的 assistant message 都是持久对话内容，即使后续紧跟 tool call 也不得标成 routine 或在 history 回读时消失。Conversation UI 由纯 durable/live projection、每 Conversation composer controller 和受控 Composer view 组成；Conversation epoch 丢弃切换后迟到的附件选择、附件导入和提交结果，Timeline 继续独占贴近底部才跟随的滚动语义。Provider 已明确返回的有界 `reasoning_summary` 无论位于纯 reasoning message 还是带正文的 assistant message，都从正文中分离并按 Run 合并为唯一、稳定、默认折叠的低权重“模型思考摘要 · N 条”；正文保持原位置，摘要展开后注明它是模型过程摘要而非系统测试或已执行画布操作，普通工具和真实 revision 步骤的相对顺序不变。只有真实提交的 revision 才投影为设计步骤。OpenDesign 不请求、推断或显示隐藏思维链，省略 summary 时继续只展示 typed plan/tool/review/delivery 状态。`invalid_tool_input`、重新 inspection 和相同失败抑制等模型可自行恢复的内部调用不会显示成用户终态红卡，但仍保留在 journal/诊断；真正业务失败继续可见。该规则同时作用于 live events、durable history 与 Conversation 切换，不删除 journal 审计，也不会让旧 approval/tool/cursor 恢复可操作状态。Main diagnostic v3 可复制同一受限 failure，但仍不记录 Prompt、附件正文、设计正文、凭据、路径或完整工具参数。Renderer report、Main input、持久 event 与 correlation context 由 executable Diagnostics Contract 统一 exact wire 和字段路径，嵌套 failure 直接复用 canonical Agent schemas，Preload/Main 不维护平行字段判断。

失败按“是否还能可靠地继续模型循环”分类，而不是按任意一层是否抛错分类：

- 可恢复工具/业务失败：参数校验、节点不存在、目标越界、revision conflict、审批拒绝、Renderer 工具超时或设计工具桥拒绝。它们写入 `tool.failed`，作为结构化 tool result 回给仍可用的模型；`EditorRuntime` invariant 失败还保留有界 `commandId / nodeId / path / message`、稳定 fingerprint 和 `inspect-and-revise` 恢复动作。Schema union 会根据节点 `kind`/command `type` 选择最相关分支并展开具体字段，`update_properties` 先合并真实目标节点再验证完整 `DesignNode`，因此不会再把可定位的属性错误压扁为顶层 `Expected union value`。模型 insert/replace 的 Line/Polygon/Star/Text/Image/Path/Vector 语义必填项直接由 Provider Schema 拒绝；node/Paint 跨分支字段由一个 model refinement 返回具体 path。只有这些模型契约通过后，total compiler 才按 kind 生成无操作 Shape 外观：`fills/strokes=[]`、`strokeWidth/cornerRadius=0`、Frame `clipsContent=false`，并用完整 canonical `DesignOperationSchema` 断言宿主输出；它不猜测或修复非法模型输入。仍然无效的 `apply_transaction` 直接向模型返回准确 `commandId/nodeId/path/message`，不再只返回泛化 schema mismatch。Agent `insert_element` 的单节点 `childIds` 在可信边界验证对应的后续 child insert 后规范为空，层级只由有序 `parentId/index` 建立，避免父容器预声明与 Runtime splice 造成 duplicate child ID；缺失/错序/错 parent 在 revision 前明确失败。失败事务不改变 revision，Runtime 会阻止随后的设计写，直到 `opendesign_inspect_document` 成功；相同输入与 fingerprint 的盲重试被有界抑制。模型可以重新检查、修正参数、换方案或向用户解释，Run 不由中间层直接终结。
- 需要用户动作但模型仍可回复：活动 Design File 已切换、目标不可用或用户拒绝授权。工具失败仍回给模型，由模型说明需要的用户动作并自然完成本轮。
- 不可继续的 Run/基础设施失败：模型请求或响应桥损坏、Provider watchdog 超时、Agent 进程/协议事件异常、Run 注册/可信绑定丢失。此时已经无法安全地继续同一循环，Main 取消对应 Run，发送可关联的 `agent.error`/终态，Renderer 解除输入和画布的运行状态并向用户显示错误。

任何一类失败都不得只写终端日志。能继续的必须进入模型上下文，不能继续的必须进入用户可见终态；同一 `requestId`/`runId` 用于关联、审计和释放资源。

Main 在应用 `userData/diagnostics/events.jsonl` 中维护有大小上限和单代轮转的结构化诊断日志。事件只包含时间、级别、来源、稳定错误码、错误消息、应用/平台版本，以及可用的 Conversation、Run、Request、Tool Call、Project 和 Design File ID；设计事务 invariant 事件可附带单条工具失败的有界 command/node/path issue 与恢复动作，但不记录 Prompt、附件正文、设计正文、Provider 凭据或完整工具参数。带 Conversation+Run 的任务诊断由 Agent Timeline 呈现，不再同时生成 Composer 错误和右下角 toast；JSONL 审计仍完整保留。非任务级不可继续错误和明确系统通知才投影为不透明桌面通知，编辑器视图中停靠在画布右下并避开 Agent composer，其他视图停靠窗口右下；错误在用户关闭前保持，用户可一键复制当前事件的完整关联信息交给 Agent 排查。普通可自动恢复的 workflow 门禁仍静默。

Agent composer 还支持粘贴和拖入图片/文件。模型可按需调用 `opendesign_read_image` 读取当前 run 已附加的图片，或用户在当前 prompt 中精确明示的绝对路径、`file:` URL 和 HTTP(S) 图片 URL；Main 只做 source 授权、受限读取、内容寻址和完整性校验，识别由模型完成。tool result 内保存 attachment metadata，下一轮由 Model Gateway 解析成真实多模态图片块。`opendesign_place_image` 可把同一 attachment 以受信任的 asset + image node 原子事务嵌入画布。`inspect_document` 只返回引用 asset 的名称、类型、尺寸、source 类型和扩展键，不把 data URI、外部 URI 或像素内容复制进工具结果；Agent Runtime 对当前轮和旧 journal 中意外出现的超长工具字段还会在模型投影时省略，避免一张图片把下一轮上下文顶爆。远程读取不携带 Cookie 或 Provider 凭据，并限制协议、重定向、超时与大小。通用网页文本读取和隔离截图仍是后续 `fetch_reference` / `capture_reference` 能力，不把仅获取 HTML 描述为已经看见页面视觉。

当设计需要原创位图时，模型可调用 `opendesign_generate_image`。工具输入只有 prompt、计划中声明的 role、size、quality 和 output format，不能指定 Provider/Model；Main 只读取独立 `GlobalImageGenerationSettings v1` 的 adapter、Base URL、鉴权、凭据和用户模型 ID。当前 `openai-images` adapter 已用 GPT Image 2 验证；同协议的新模型不需要增加模型名分支。Main 校验 plan/role、HTTP/JSON/base64/大小/取消，把结果写入现有内容寻址 attachment store 并只授权给当前 Run。结果返回 attachment metadata 和多模态引用，但不会自动修改文档；模型必须继续调用带相同 role 的 `opendesign_place_image`，才能通过 `put_asset + insert_element(image)` 的同一事务、revision 和 undo 历史进入计划 Frame。`editable-composition` 不允许 `final-single-image`；单图模式必须引用用户当前消息中明确要求扁平图片的原文。未配置全局生图服务时工具明确失败，不回退到 Conversation Provider。

参考图分析、确定性图片处理和 AI 图片编辑是三个不同边界。`read_image` 只让多模态模型理解参考图；当前 Image service 已提供 Image 节点的非破坏 placement/crop、adjustment/filter、mask、扩图几何与分辨率目标，检查器和专用 typed tools 共用可信 planner。AI 图片编辑已包含去背景、背景替换、整图提示词编辑、区域 Erase/Isolate、Expand 与 Upscale：去背景/Isolate 验证透明像素，背景替换只接受新环境描述并由 Main 添加保主体语义，提示词编辑接受最多一张人工选择或当前 Run 已授权的参考图，区域/扩图 mask 和保护像素由 Main 生成，Upscale 的 source/target pixels 则由宿主验证。所有动作都由 Inspector 或 `opendesign_edit_image` 锁定当前 `expectedAssetId`，通过独立 `openai-images` `/images/edits` adapter 执行；只有 Provider 成功且目标仍未过期时，Renderer 才把结果 asset、可选 supporting mask/reference asset、typed derivation 与节点变化作为一笔 revision 提交。取消、失败、无效输出或 stale target 不产生文档 revision，原图与未声明变更的节点属性均保留；来源历史可切换、恢复、撤销、保存重开。带提示词的局部重绘、重打光、多参考图与风格统一仍是后续能力。

`opendesign_capture_canvas` 只渲染当前 Run 绑定 Design File 的可信设计目标：计划 Frame 已建立时导出该 Frame，否则导出绑定 Page。Main 从 Run/plan 状态产生 `captureTarget`，Renderer 用 captured revision 创建与活动编辑画布分离的 Leafer 投影，再把有界 JPEG 通过 Main 附件导入边界变成内容寻址图片。创建临时 surface、加载 adapter、同步场景、导出 JPEG 与导入附件形成真实进度阶段；单次离屏导出有 30 秒硬上限，超时会释放临时 Leafer surface 并在进入视觉审查前返回可恢复错误，而不是靠虚假 heartbeat 延长 Main 的总时限。用户同时切换 Design File、pan、zoom、resize 或改变选区不会改变像素、document revision 或 mutation target；生成 skeleton/cursor/reveal 也不会进入截图。它不会截取桌面、其他窗口或应用。Agent 在实质设计写入后可把该图片作为多模态结果回读，再根据实际渲染结果迭代。Main 的 dispatch-bound `DesignCaptureReviewSession` 统一承接公开 capture、first-slice 和 checkpoint：capture 的确定性布局报告验证后必须紧接同 revision 权威 inspection；布局无错误且 coordinator 判定需要时才运行无作者 Conversation 上下文的独立 critic，最后由唯一 delivery ledger 记录结果。布局已失败或 revision 不一致时不会错误推进完成状态，也不会浪费一次 critic Provider 调用。该能力不等同于网页抓取或外部页面截图，后两者仍属于后续 `fetch_reference` / `capture_reference`。见 [ADR-0163](adr/0163-main-design-capture-review-ownership.md)。

`EditorRuntime` 提供版本化、引擎无关的设计预检，`inspect_document` 对当前 Mutation Target 返回 Path、渐变、光晕、模糊、blend、mask、图片和文字的实际特性计数，并识别空内容、不可见/无绘制外观、缺失资源、非有限世界 bounds、完全越出 clipping Frame 与根图层碎片。该预检不替代 Leafer 绘制或像素视觉基线；它用于在调用 `capture_canvas` 前排除结构上必然失败的结果。

ADR-0127 已取代用户可选快速/精细的描述：当前 Composer 提交统一使用 interactive `60/60/300 秒` 单请求 watchdog，自适应质量策略不通过放宽事务、revision、scope 或 Logo 视觉门禁换取速度；普通重连退避计入同一单请求总时限。

### 9.1 Workspace 级 Conversation 与 Project 归档

Conversation 是 Workspace 一级持久会话。每个 Conversation 保存稳定 `conversationId`、不可变且可空的 `originProjectId`，以及可移动、可清空的 `filedProjectId`；两种 Project 关系都只服务来源记录与 UI 归档，不构成 sandbox、文件权限或 Run target。Main 按活动 Run、最近 Global Task、归档 Project 默认文件的顺序解析打开目标；无有效目标时 Timeline 仍可读，但 Composer 禁用。

Conversation 列表按 `updatedAt` 降序排列。Main 在接受新 Run 以及收到 assistant/tool/终态活动时推进持久时间，Renderer 在同一事件链中立即重排本地投影；因此发送消息后当前会话马上置顶，重启后顺序与持久状态一致。

Workspace Home 直接显示最近 Conversation 与 Project，不把同一工作再拆成独立 Global Task 卡片；任务生命周期只作为对应 Conversation 的状态摘要，持久任务记录仍由 Main 用于恢复、删除门禁和审计。Project 创建由 Main 在原生目录选择后使用目录 basename 命名，Renderer 不提交路径或重复名称。Project-backed Design File 没有活动 Conversation 时，Composer 允许直接输入；首次发送先创建持久 Conversation，再以创建响应为显式目标提交同一 prompt。正文输入独占 Composer 整行，附件、当前 Page/Selection 上下文与发送操作位于下方工具栏。见 [ADR-0150](adr/0150-project-contextual-conversation-workbench.md)。

每个 Run 保存其实际 `targetSet`、作用域和权限快照。Project 被移动、删除或不可用后，会话审计记录仍有效。预发布 `homeProjectId` schema 直接重建，不迁移为 attached root、持久授权或隐式目标。

### 9.2 Working Set、Mutation Targets 与 Capabilities

目标运行模型明确分离三类集合：

| 集合             | 回答的问题           | 典型内容                                             | 不代表什么           |
| ---------------- | -------------------- | ---------------------------------------------------- | -------------------- |
| Working Set      | 本次推理可以看到什么 | 固定 revision 的文件、Page、节点、外部文件和检索结果 | 不授予写权限         |
| Mutation Targets | 本次计划要改变什么   | Design File/节点范围、输出文件、预期 revision        | 不代表调用已经获准   |
| Capabilities     | 主体最多能请求什么   | 主体、资源选择器、操作、有效期、配额和来源           | 不替代审批或执行隔离 |

一个写调用必须同时满足：资源已列入 Mutation Targets、主体持有匹配 Capability、所需 Approval 已完成，并且执行符合 Sandbox 约束。三类集合不得从 Conversation 组织字段、当前选区或彼此隐式扩大。上下文可读不等于可写，多目标计划也不等于跨文件原子事务。

### 9.3 Attached roots 与 per-run references

Project 可以保存零个或多个经用户或受管策略批准的 attached roots。Main 为每个 root 登记稳定 ID、规范化边界、允许操作、来源、有效期和撤销状态；Agent 只获得资源 ID 或不透明句柄，不获得可任意拼接的绝对路径。Attached root 建立持久关联，但每次工具调用仍需匹配 Capability。

用户可以通过文件选择器、拖放、打开文件或明确命令创建 per-run reference，把未附加目录中的文件或其他 Project 的资源只加入当前 run。Run 结束、取消或权限撤销后，临时句柄失效；该引用不改变 Project 归属，也不会自动成为 attached root。

### 9.4 跨项目多目标与并发

一次 run 可以跨 Project 指定多个 Mutation Targets。每个目标单独携带 Project、Design File、`baseRevision`、能力和审批，并通过各自的 `DesignTransaction` 提交。当前目标架构不承诺跨 Design File 原子提交；发生部分成功时，UI 必须逐目标显示结果、冲突和可用的撤销或补偿动作。

多个 Conversation 可以并发运行。只读操作固定到 revision 后可并行，不同 Design File 可以独立提交；同一 Design File 的权威 runtime 按 `baseRevision` 做乐观并发控制。过期事务返回 `conflict`，Agent 重新读取、重新预演，并在作用域和审批仍有效时重试；运行时不得静默覆盖、自动重放语义不明的命令、建立会话私有事实副本或以长时间项目级锁掩盖冲突。

### 9.5 工具优先级与回合

一个典型回合包含：解析用户目标、固定三类作用域、构建最小上下文、选择工具、完成策略与审批、执行、读取结构和渲染结果、视觉复核、形成后续动作并输出可审计事件。上下文按需拉取，优先传递结构化摘要和相关节点，避免默认上传整个设计文件或无界截图。

内置 Agent 优先使用 typed design tools。默认工具集不暴露裸 `fs`、通用 Bash/shell 或任意命令执行；确需文件、进程或网络能力时，只能调用 Main 托管的窄工具。设计写操作生成 `DesignTransaction`，包含 Design File、基准 revision、作用域、命令列表和可读摘要；高影响事务先预演并返回差异，应用后进入同一 Design File 的统一撤销历史。模型输出永远不等于执行授权。

## 10. 双向 MCP

MCP 是内置设计 Agent 的互操作和生态边界，优先级低于应用内完整设计闭环。MCP Server 不替代内置模型接入，外部客户端也不能获得比内置 Agent 更宽的设计权限或绕过同一事务历史。

当前仓库没有占位的 MCP host/server 或独立 `DesignEngineAdapter` package：早期无生产调用者的门面已经删除，不能把空包或第二套 `open/save/apply/undo/redo` 生命周期误写成已实现 MCP。以下两种方向仍是目标架构；开始实现时必须由 Main 组合稳定 `DesignReadPort`、`ToolInvocationPort`、resource handle 与 revision，并复用唯一 Tool Runtime、Capability、Approval、审计、取消和 Design Transaction 入口。

### 10.1 OpenDesign 作为 MCP 客户端

Agent 可以连接用户配置的 MCP Server，以读取设计素材、代码上下文、品牌数据或业务系统。每个连接独立声明 transport、身份、可用工具、资源和提示词，Tool Runtime 在调用前执行 schema 校验、Capability 检查、Approval、Sandbox、超时和输出大小限制。外部 Server 返回的路径或资源标识不自动成为 attached root、per-run reference 或 Mutation Target。

### 10.2 OpenDesign 作为 MCP 服务端

外部获准客户端可以通过稳定 Workspace、Project、Design File、Page、节点或 root handle 查询摘要、读取选区、请求导出或提交受限设计事务。设计写操作进入与内置 Agent 相同的 Tool Runtime、`DesignTransaction` 校验、权威 `EditorRuntime`、revision 冲突和审计链。服务端不得默认暴露模型密钥、任意文件读取、原始引擎句柄、未保存的全量文档或无提示写权限。

### 10.3 共同策略

两个方向共享 Capability 标识、风险等级、Approval 记录、来源标签、审计事件、撤销信息和断开机制。连接身份与资源身份分离；切换 Project、Workspace 或用户，以及句柄、目标或 revision 改变后，必须重新计算授权范围。MCP 工具不得接受模型可控的任意本地 `filePath` 并直接加载、创建或保存文件；兼容适配器只能在 Main 的可信边界内把用户明确选择的文件转换为受限句柄。

## 11. Trust、Capability、Approval 与 Sandbox

Agent、skills、MCP 和所有外部资源调用依次经过四层控制：

1. **Trust** 对代码、调用主体和数据来源分类。内置控制代码可以比第三方扩展更可信，但模型输出、文档文本、网页和 MCP 返回值始终是不可信输入。Trust 影响默认策略，不直接授予动作。
2. **Capability** 是 Main 可验证的最小权限，绑定主体、资源选择器、操作、有效期和配额。Project 归属、Working Set、连接成功或 skill 声明都不能自行生成 Capability。
3. **Approval** 把用户或受管策略的决定绑定到具体动作、目标、revision、影响摘要和不可变调用参数。目标或风险变化后重新评估；Approval 不能绕过被禁止或不存在的 Capability。
4. **Sandbox** 限制获准代码或工具的文件、网络、进程、时间、内存和输出。Sandbox 是执行隔离，不替代前三层授权判断。

四层在同一策略链中协作，但不得合并语义。每个审计事件关联 Workspace、Conversation、run、主体、工具、Working Set 摘要、Mutation Target、Project、Design File、base/current revision、审批和结果。

## 12. Skills 安全模型

Skill 是包含说明、参考资料、脚本或资产的扩展包，应默认视为不受信任内容。运行时先解析清单并显示来源、版本、完整性和请求能力；只有用户或受管策略可以授予权限。

加载说明不等于执行附带脚本。脚本应在受限环境中运行，并受工作目录、文件路径、网络域名、命令、时间、输出和资源配额约束。Skill 内容、MCP 返回值、设计文档文本和网页内容都可能包含提示注入，不能改变系统策略或提升权限。

当前 `@opendesign/discovery` 已能在隔离边界内发现 user/project/builtin `SKILL.md` 和分层 `AGENTS.md`，处理来源优先级、符号链接逃逸与内容哈希；用户/Project discovery 结果仍未接入生产 Agent、管理 UI、能力审批或审计链，因此用户自定义 Skill/提示词不能描述为已可用。生产设计 Agent 另通过 `@opendesign/design-skills` 自动装配受信任、随当前应用构建且按 deliverable 路由的内置方法包：UI bundle 约束视觉策略、UX 结构与 capture critic，Graphic bundle 约束主题证据、媒介选择、图形构图与非 UI capture critic。当前 Plan 与账本 Visual Review 只记录宿主选择的稳定 skill ID；生产 capture 的 review skills 只进入无作者上下文的 stateless critic request。内置 skill 不另设功能版本或手工内容哈希，也不替代真实设计工具、不动态读取远端内容、不扩大写入权限。见 [ADR-0098](adr/0098-versioned-built-in-ui-design-skills.md)、[ADR-0104](adr/0104-deliverable-scoped-design-skills-and-evidence-media.md) 与 [ADR-0117](adr/0117-stateless-independent-visual-critic.md)。

详细的开放源码和扩展边界见 [ADR-0004](adr/0004-agent-open-source-boundaries.md)。项目自带 UI 设计工作流见 `../.agents/skills/ui-design/SKILL.md`。

## 13. 历史引擎迁移记录

早期 OpenPencil 原型验证过单 Design File、多 Page 和完整编辑器嵌入，但同时引入第二份页面、图层、历史和任意 `filePath` 工具边界。OpenDesign 保留“单文件多 Page”的产品结论，不采用其文档状态、运行时或路径授权方式。当前 OpenPencil 固定提交 `449f31dd8b7df12965f65d9da774597332fc153d` 继续作为产品行为与验收矩阵参考：工作台层级、Pen/锚点编辑、画布 overlay、属性面板、图片裁剪、SVG import/export 与模板回归值得对照；能力矩阵见 [OpenPencil 能力对照](openpencil-capability-benchmark.md)，节点编辑裁决见 [ADR-0027](adr/0027-versioned-vector-point-editing.md)。

OpenPencil vendor/runtime、旧 Canvas2D 产品包、手写 React 画布交互及其构建/发行资源均已移除。缺失的专业能力继续通过 OpenDesign 公共语义、LeaferJS 和可替换成熟服务实现，不能以能力尚未完成为理由恢复 fallback 或双写。历史原因见 [ADR-0005](adr/0005-opendesign-owned-editor-runtime.md)、[ADR-0006](adr/0006-project-conversation-agent-scope.md)、[ADR-0009](adr/0009-leafer-rendering-and-interaction-engine.md) 与 [ADR-0011](adr/0011-professional-design-capability-architecture.md)。

## 14. 数据、隐私与恢复

- 本地文档采用原子写入，保留可恢复快照或操作日志，并为格式升级提供显式迁移。
- 当前每个 Provider 的 API Key 由 Main 使用 Electron `safeStorage` 分别加密；Renderer 与 Agent 只看到脱敏 Catalog 或 canonical model events。密钥不写入 Project、日志、提示词或 Renderer 存储。
- 用户明确选择的 Agent 附件默认保存在本机 `~/.opendesign/attachments`；只有在发送包含该附件的 Conversation 消息时，Main 才把对应图片内容或本地提取的文档文本交给当前选择的外部模型。图片要求模型声明 `imageInput`，文档不授予原文件或目录访问。项目正文、Utility journal 和 model bridge 不保存原始路径或 inline base64。
- 发送给外部模型或 MCP 的每段数据都带来源、Working Set 与资源作用域，并受 provider 配置、Capability 和 Approval 约束。
- 日志默认去除设计正文、提示词、令牌、附件内容和工具参数。当前支持从通知复制单条结构化诊断；后续批量诊断导出必须先允许用户预览。
- Agent 与 MCP 写操作逐目标记录主体、Conversation/run、工具、参数摘要、Project、Design File、base/current revision、结果和撤销句柄。

## 15. 质量属性

### 响应性

指针、键盘、缩放和选区更新不得等待 Agent 或远程服务。长任务异步执行、可取消，并以渐进状态更新 UI。

当前 Leafer adapter 直接消费 `DesignTransaction` 的 `DesignChangeSet`。相邻 revision 只遍历活动 Page 的结构 ID，并为 added/changed/removed 节点及引用变更 asset 的节点重建投影 spec；未变 spec 保持引用稳定，reconcile 只访问该 affected set，只对实际变化的 data、transform 和父子顺序调用 Leafer。普通 revision 不再隐藏 Editor、重放整棵场景或强制更新 tree bounds；只有变化与当前选区存在祖先/后代关系时，才刷新对应选中元素的 bounds。首次挂载、Design File/Page 切换、revision 断档和交互失败恢复仍使用全量可丢弃投影作为正确性回退。Mapping、projection、reconcile、frame scheduler、generation presentation 与七组交互 session 各自拥有完整资源生命周期；`LeaferAdapterEventController` 显式成对管理 Editor/App/Window/host listener，adapter teardown 先停止事件再释放其他 owner；`LayerHoverController` 独占 Layers panel 的不可命中普通/Component-derived hover Stroker 和 visibility/tool/edit-mode 门禁。所有 hover、DOM、marker、preview 与 Leafer element 都是可丢弃投影，不进入 document/history/save/export。固定节点规模、效果复杂度和帧时间的真实 Electron 基准仍需持续记录；不能通过建立第二份可写状态、跳过 revision 或牺牲选区准确性换取表面流畅。见 [ADR-0166](adr/0166-leafer-host-events-and-layer-hover-ownership.md)。

### 可恢复性

Renderer、Agent 或引擎子系统异常后，主进程应隔离故障并尽可能恢复最近的持久状态。单个 Design File 的事务要么完整提交，要么不产生可见修改；跨文件多目标计划可能部分完成，必须保留逐目标状态、冲突与撤销或补偿信息。

### 可替换性

模型 provider、MCP transport 和低层渲染后端都通过契约接入。Provider 连接只在尚未发布任何 text/reasoning/tool block 时允许有界透明重连；一旦语义内容已经进入 Agent 流就实时转发，后续中断直接失败而不缓存、重放或生成重复工具调用。升级基线必须通过兼容性与视觉回归验证。替换渲染后端不得改变 OpenDesign 文档、事务或 editor state 语义。

### 可测试性

契约使用确定性 fixtures 和 contract tests；引擎适配器验证快照、事务与事件；Agent 使用录制或伪造工具响应测试取消、重试、三类作用域、四层安全和同文件 revision 冲突；跨项目多目标覆盖部分失败与恢复；关键 UI 进行键盘、可访问性与视觉验证。

## 16. 演进顺序

当前演进顺序由 [`roadmap.md`](roadmap.md) 维护：在已经建立 capability manifest 后，先完成固定样张、渲染诊断与实机证据；精确矢量之后优先完成 Component → Instance → Override 主流程，再并行推进图片/文字/海报交付，随后扩展响应式布局、Variants/Variables、导入导出与完整 Agent 权限/MCP。Component/Variant/Slot、派生层统一选择/安全 override、Variables Core 同文件能力与同 Project Component/Variant/Shared Style/Variable Library 用户主流程已完成并保持 `degraded`；更多 Variable binding、Workspace/远端 Library 与外部 adapter 继续按后续切片推进。

阶段顺序不承诺发布日期，但每一阶段必须保持唯一事实状态、可运行、可验证、可撤销，并且不得恢复旧引擎作为过渡入口。
