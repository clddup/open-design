# ADR-0144：单一来源的工具契约验证

- 状态：Accepted，first-slice、node apply、Design Plan、Visual Review、Checkpoint、图片获取、公开图片操作、Page、Component、Style、Variable、Hierarchy、Vector、Arrange 与公开 SVG/Raster Import-Export 工具已实施，其余契约分阶段实施
- 日期：2026-08-23
- 首个迁移对象：compact first-slice
- 关联：ADR-0018、ADR-0100、ADR-0103、ADR-0141、ADR-0143

## 背景

OpenDesign 当前复用固定 `@earendil-works/pi-agent-core` / `pi-ai` 的 Agent loop 和 TypeBox tool 参数校验，但多个产品工具又分别维护 Provider JSON Schema、`isXxx`、`normalizeXxx`、`explainInvalidXxx`、Main guard 与 EditorRuntime 校验。Pi 的结构校验不是问题来源；OpenDesign 在它之后建立的多套平行结构事实才造成 schema 与 Runtime 漂移、重复遍历、union 顶层错误和依赖错误字符串的恢复 UI。

first-slice 的 32/35 元素、region ID/kind 和扁平父级冲突证明：同一输入在 Provider 看来合法，仍可能在后续手写 validator 或 Main 被另一种结构规则拒绝，并重新消耗一次完整 Provider 往返。

## 决策

### 一个工具契约入口

每个迁移后的工具只暴露一个解析入口：

```ts
type ValidationIssue = {
  code: string;
  path: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
  recovery?: string;
};

type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };
```

权威 TypeBox schema 同时用于 pi 的 `AgentTool.parameters`、Runtime 基础结构解析和 Provider schema 投影。OpenDesign 不重新实现对象形状、required、enum、长度、范围、unknown field 或 discriminated union 分支。Provider 可以接收压缩投影，但投影必须来自同一 schema tree，并由一致性测试证明 Provider 合法样本不会再次被 Runtime 结构层拒绝。

### 四层职责

1. 结构 schema：字段、类型、枚举、长度、范围、未知字段和 discriminated union；
2. 单一 domain refinement：跨字段 ID、预算、父子图、parent-local bounds、material 与 target 对应；
3. Main guard：Run binding、Page、Mutation Target、Capability、approval、revision 与当前 ledger；
4. EditorRuntime：文档层级、引用、事务和文档 invariant。

同一规则只能由一层拥有。EditorRuntime 保留自己的 `DesignError`，不把内部文档错误重写成通用 validator；跨工具边界时再适配为 `ValidationIssue`。Timeline、恢复、诊断与测试消费稳定 `code/path/details`，不再解析英文 message。

### Normalization 仅属于可信宿主绑定

Normalization 只允许绑定当前 Page、权威 Run prompt、固定 skill refs、受权资源句柄，以及删除模型无权控制的回抄字段。它不能默默猜测或修复普通非法模型输入。结构 parse 后只运行一次 domain refinement；不再由 `normalize/is/explain` 分别遍历同一对象。

### 迁移顺序

1. compact first-slice；
2. 其他 Agent tool 输入；
3. Main/Preload IPC；
4. Provider 配置；
5. Agent Event；
6. Workspace/Conversation 持久化；
7. DesignDocument 与事务协议作为独立高风险切片。

每个切片删除被替代的手写结构 validator，不保留双校验 fallback。尚未迁移的契约继续使用现有入口，不能先增加一个空统一 facade 再长期双写。

## First-slice 验收

- 一个 `FirstSliceContract.parse(input, hostContext)` 返回 canonical value 或结构化 issues；
- 删除独立 `isDesignFirstSliceToolInput`、`normalizeDesignFirstSliceToolInput`、`explainInvalidDesignFirstSliceToolInput` 的重复结构遍历；
- 覆盖 35 元素登录页、`auth_region → form_region`、footer Text、region/跨 target ID 冲突、越界/循环、material、准确 path 和零 revision 失败；
- 48 个模型内容元素与宿主 region Frame 的预算语义只定义一次；
- pi/Provider schema、Runtime parse 和 Main handler 对同一 fixture 结果一致；
- 结构化 issue 贯通 completion recovery、journal、diagnostic 与 Timeline 聚合。

## 当前实施状态

compact first-slice 已完成首个迁移切片：模型可见输入由可执行 TypeBox schema 直接生成并由 pi 预校验；Main 使用同一 `FirstSliceContract.parse(input, hostContext)` 完成可信宿主绑定与唯一 domain refinement。旧 `isDesignFirstSliceToolInput / normalizeDesignFirstSliceToolInput / explainInvalidDesignFirstSliceToolInput` 已删除，Provider 描述中的 32 元素旧事实也已移除。

通用 node apply 已完成第二个迁移切片：`DesignApplyContract.parse(input, context)` 明确区分模型 compact 输入、Main/Renderer canonical 输入与 trusted internal 操作，但三种阶段共享同一个契约入口和结构化 issue。模型可见 JSON Schema 被原样赋予不可序列化的 TypeBox runtime metadata，Provider JSON 与 Runtime schema 不再复制；宿主只补全 canonical node/export defaults。旧 `normalizeDesignApplyToolInput / isDesignApplyToolInput / isInternalDesignApplyToolInput / explainInvalidDesignApplyToolInput` 已删除。语义 step 顺序、内部字段、允许的 operation、Component Instance 边界与 rebase target 唯一性只在一个 refinement 中维护；Pi 直接消费 `validateInputIssues`，不再回退到字符串 explainer。

Design Plan 已完成第三个迁移切片：`DesignPlanContract.parse(input, context)` 使用同一可执行 schema 接受模型 Plan 或验证 canonical Plan，模型无权控制的 `skillRefs` 只由宿主绑定。target/Frame/region ID、parent-first 与 parent-local bounds、quality profile、Component occurrence、Reference Strategy、Logo exploration 和 single-raster 关系集中在一个 domain refinement，并返回稳定字段路径。旧 `isDesignPlanToolInput / normalizeDesignPlanToolInput` 及仅为该 Plan 服务的 `isDesignBriefFidelity / isDesignReferenceStrategy / isDesignPlanComponentStrategy` 手写结构遍历已删除；Pi、Main handler、compact first-slice compiler 和 Renderer Timeline 消费同一解析入口。

Design Checkpoint 已完成第四个迁移切片：`DesignCheckpointContract.parse(input)` 以 action discriminant 直接选择 `apply-and-capture` 或 `refine-and-capture` 的真实 schema 分支；Provider、Pi、Main handler 与 Renderer Timeline 复用同一入口。顶层 schema 已验证完整嵌套 Apply 后，`DesignApplyContract` 只继续 canonicalization 和唯一 domain refinement，不再对相同结构重复遍历；嵌套错误保留 Apply 的稳定 code，并准确前缀为 `/apply` 或 `/refinement`。旧 `isDesignCheckpointToolInput / normalizeDesignCheckpointToolInput` 已删除。材料 apply 成功、capture 单独失败时保留已提交 revision 的现有恢复语义不变。

图片获取已完成第五个迁移切片：`ReadImageContract.parse(input)` 与 `GenerateImageContract.parse(input)` 分别成为读取用户授权图片和调用全局生图模型的唯一输入入口，Provider、Pi、工具聚合校验与 Main 执行消费同一可执行 schema。旧 `isReadImageToolInput / isGenerateImageToolInput` 已删除。显式生成尺寸的每边 `256..4096`、最大 `4:1` 宽高比和 `16,777,216` 像素总面积仍由一个 domain refinement 负责，但准确限制同步进入模型可见 schema 描述；空白 prompt 在结构层直接拒绝，不再出现 Provider 合法、Runtime 才失败的隐藏规则。

公开图片操作已完成第六个迁移切片：`PlaceImageContract / UpdateImageContract / EditImageContract` 分别以一个可执行 schema 同时服务 Provider、Pi、工具聚合校验和 Main 执行。placement 与 filters 直接复用 `DesignDocument` 的权威 `ImagePlacementSchema / ImageFiltersSchema / ImagePaintSchema`；action discriminant 选择放置来源、非破坏更新或 AI 派生编辑的准确分支，未知/串用字段返回真实字段路径。旧 `isPlaceImageToolInput / isUpdateImageToolInput / isEditImageToolInput` 已删除。只有“扩图至少一个边大于零”保留为单一跨字段 refinement；Run attachment 授权、Design File asset、Page/Mutation Target、source-family stale guard 和事务 invariant 继续分别由 Main 与 EditorRuntime 拥有。Figma 兼容边界保持 asset/paint 与 placement/filter 语义；OpenDesign 的去背、扩图、重打光等 AI 能力继续作为带 provenance 的资产派生，不伪装成 Figma 原生文档字段。通用 `contractSchemaIssues` 会去除 union/intersection 的重复根错误并按字段路径去重，Pi、journal、diagnostic 与 Timeline 因此只收到可操作 issue。

Visual Review 已完成第七个迁移切片：`DesignVisualReviewContract` 以同一模型 schema 服务 Provider/Pi，并以 canonical schema 验证进入交付 ledger 的完整 Review。模型无权提交 `skillRefs`；Main 从当前 active Plan 读取真实 UI/Graphic/Logo review refs 后一次绑定，不再先默认 UI 再由 Coordinator 覆盖。十项摘要、九项 criterion evidence 与 refinement 先经过结构 schema，再由一个 refinement 拒绝泛化赞美或不可执行文本并返回 `/hierarchy`、`/criteria/visual-thesis`、`/refinements/0` 等准确路径。旧 `isDesignVisualReviewToolInput / normalizeDesignVisualReviewToolInput` 已删除；legacy recovery tool 与 stateless independent Critic 的 ledger 输出都经过 canonical contract。Review 继续属于 Run/交付证据，不进入 DesignDocument、画布 revision 或 Figma 兼容节点协议。

Page 工具已完成第八个迁移切片：`PageStructureAccessContract / DesignPageContract` 分别成为 Run-scoped Page 结构授权请求与 Page 生命周期写入的唯一结构入口，同一个 action-discriminated 可执行 schema 服务 Provider、Pi、Main approval/preauthorization/execution 与 Renderer canonical bridge。`create / rename / duplicate / reorder / clear / delete` 只接受各自分支字段；Page ID 继续由宿主创建，模型在 `create` 中回抄 `pageId` 或在 `rename` 中夹带 `index` 会得到准确字段路径，而不再被 normalizer 静默删除。Page 名的非空、长度与控制字符边界进入公开 schema；授权 action 的枚举、去重和有界 reason 同样不再由手写遍历重复维护。旧 `isDesignPageToolInput / normalizeDesignPageToolInput / isPageStructureAccessToolInput` 已删除。Main 仍独立拥有当前 Design File、Run capability、approval identity、Mutation Target 与 revision guard；Renderer 只执行已经通过相同 canonical Contract 的请求，EditorRuntime 继续拥有最后一页删除、Page/node 引用、事务和 history invariant。

Component 工具已完成第九个迁移切片：`DesignComponentContract` 以一个 action-aware 可执行 schema 覆盖 Main/Instance、Component Set/Variant matrix、BOOLEAN/TEXT/INSTANCE_SWAP/SLOT property、source-path override、detach 与 go-to-main 共 29 个 action，并同时服务 Provider、Pi、工具聚合、Main policy/execution 与 Renderer canonical bridge。每个 action 只接受自己的闭合字段集合；Component/root 数量与 Variant matrix member 对应、property type 与 preferred values 对应、Slot child-count 范围是仅存的三个跨字段 refinement。旧约 500 行 `isDesignComponentToolInput / explainInvalidDesignComponentToolInput` 与其 `exactKeys`/形状遍历已删除。Provider 原本不公开而 Runtime 暗中接受的 `set-override.patch.locked` 分叉也已关闭；人工 Instance 派生层 locked/visible 继续属于 Layer State 路径。该契约保持 Figma 的 Main→Instance 自动同步、Component Set、typed properties、preferred values、Slot settings、override 与 detach 语义；OpenDesign 额外保留稳定 ID、Page capability、revision、preview/apply 与单 undo 事务边界。Figma Plugin API 的 [`createComponentFromNode`](https://developers.figma.com/docs/plugins/api/properties/figma-createcomponentfromnode/)、[`combineAsVariants`](https://developers.figma.com/docs/plugins/api/properties/figma-combineasvariants/)、[`InstanceNode`](https://developers.figma.com/docs/plugins/api/InstanceNode/) 与 [`ComponentPropertyDefinitions`](https://developers.figma.com/docs/plugins/api/ComponentPropertyDefinitions/) 只作为公开语义参照，不成为第二份文档状态或私有格式依赖。

Style 与 Variable 工具已完成第十个设计系统迁移切片：`DesignStyleContract / DesignVariableContract` 分别以一个 action-aware executable schema 覆盖六类 Shared Style 操作与十二类 Collection/Mode/Variable/Binding 操作，Provider、Pi、工具聚合、Main policy/execution 与 Renderer canonical bridge 不再维护另一套结构判断。Style reference field 直接复用 `StyleReferenceTargetSchema`，Variable value、resolved type、scope 与 binding target 直接复用 `DesignDocument` 的权威 schema；CUSTOM_CUBIC_BEZIER/CUSTOM_SPRING 等完整 Variable value 因此不再出现 Runtime 接受而 Provider schema 未声明的漂移。空 metadata/update、串用 action 字段和未闭合 target 在 Provider 前置结构层返回准确路径；Contract 只保留 Variable map key 的同值边界 refinement 与 replacement mode 不得等于被删 mode 两项判断，现有 collection、mode、alias、type、consumer 与 revision 关系继续由 Main/EditorRuntime 当前文档 guard 拥有。通用 schema error 展开会递归跟随 nested `type` discriminant，自定义 easing 缺字段不再退化为首个 primitive union 错误；action branch 使用顶层权威字段约束加紧凑闭合分支，避免 expanded Provider surface 重复展开完整 Variable value。旧 `isDesignStyleToolInput / isDesignVariableToolInput` 及其 `record/id/text/exact/switch` 遍历已删除。语义继续对齐 Figma Plugin API 的 [local Paint/Text/Effect/Grid Styles](https://developers.figma.com/docs/plugins/api/figma/)、[Variable Collections、typed values 与 aliases](https://developers.figma.com/docs/plugins/api/figma-variables/)、[property binding](https://developers.figma.com/docs/plugins/working-with-variables/) 和 [picker scope vocabulary](https://developers.figma.com/docs/plugins/api/VariableScope/)；OpenDesign 的稳定 ID、Page capability、preview/apply、单 undo 与跨文件 Library 仍由自身事务模型拥有。

Hierarchy 与 Vector 工具已完成第十一个结构编辑迁移切片：原混合 types、Provider guidance schema 与约 250 行 `isDesignHierarchyToolInput / isDesignVectorToolInput / exactKeys` 的 746 行文件拆为 type、executable schema 和 Contract 三个明确模块。`DesignHierarchyContract` 覆盖 Group/Ungroup、sibling Mask、Boolean group、reorder 与 reparent 十个闭合 action；`DesignVectorContract` 覆盖 open/close/reverse、connect/disconnect、单层/跨层 vertex transform 和三类 Cut 九个闭合 action。Provider、Pi、工具聚合、Main policy/execution 与 Renderer canonical bridge 现在消费同一 action branch，旧“Provider 只给宽泛字段、Runtime 另行校验 action-specific shape”的双事实已删除；Main 也不再跳过 Hierarchy 输入校验后直接强转 material target。Vector topology ID 直接复用文档权威 `VectorGeometryIdSchema`；nested `at.kind` 错误会定位到真实 `segmentId/t`、`vertexId` 或未知 `/at/kind`。跨层 target node 唯一性与 16,384 vertex 总预算是仅存的两个 domain refinements，外层数组不再用泛化 `uniqueItems` 抢先覆盖稳定 node path；Page、revision、locked、same-parent、mask source、Boolean operand、拓扑与几何歧义继续由 Main/EditorRuntime/Geometry Service 当前文档层拥有。语义参照 Figma 的 [GroupNode](https://developers.figma.com/docs/plugins/api/GroupNode/)、[BooleanOperationNode](https://developers.figma.com/docs/plugins/api/BooleanOperationNode/) 与 [VectorNetwork](https://developers.figma.com/docs/plugins/api/VectorNetwork/)；OpenDesign 继续额外拥有稳定 topology ID、事务 preview/apply、单次 undo 和受控多层宿主几何规划。

Arrange 工具已完成第十二个布局编辑迁移切片：原 962 行混合 types、宽泛 Provider schema 和约 460 行 `isDesignArrangeToolInput / isLayout* / onlyKeys` 手写结构遍历被拆为 types、action-aware executable schema 与 `DesignArrangeContract`。21 个 align/distribute/tidy/spacing/constraints/resize/Auto Layout/Grid/child sizing-positioning-limits/Layout Guides/overflow repair action 现在都是闭合分支；Provider、Pi、Main handler、Renderer canonical bridge 与聚合 dispatcher 使用同一 schema 和 parse 入口。Grid `autoTracks` 与 `row-auto-flow`、min/max 反转、Layout Guide ID 唯一性是仅存的三个跨字段 refinement；Page、revision、节点类型/祖先、locked、Grid 占用、几何、preview 与事务 invariant 继续由 Main/EditorRuntime/Layout Service 拥有。Provider 说明中“Auto Layout Grid 未支持”的旧事实已删除：OpenDesign 明确区分会驱动内容 reflow 的 Auto Layout Grid 与只作视觉辅助、不导出的 Layout Guides，这与 Figma 当前的 [Auto layout vertical/horizontal/grid 三种 flow](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)、[Grid tracks/cells/span](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow) 以及 [Uniform/Column/Row Layout Guides](https://help.figma.com/hc/en-us/articles/360040450513-Create-layout-guides) 语义一致。OpenDesign 仍通过自身稳定 ID、current Page capability、revision、原子事务和单 undo 维护文档事实。

公开 SVG/Raster Import-Export 已完成第十三个文件交付迁移切片：`ImportSvgContract / ExportSvgContract / ExportRasterContract` 分别以同一 executable schema 服务 Provider、Pi、Main policy/host 与 Renderer canonical bridge；旧 `isImportSvgToolInput / isExportSvgToolInput / isExportRasterToolInput` 已删除。SVG import 只接受当前 Run 的内容寻址 attachment handle、明确 Page/parent/index 与 parent-local 坐标；公开输入不可能夹带 XML 或路径。SVG export 接受一个 Page 上 1..512 个稳定 root ID、portable suggested name、可选 layer ID 和 padding。Raster 以 `format` 闭合 PNG/JPEG/WebP 分支：公开 scale 明确为 1x/2x/3x 或固定 width/height，PNG 不接收 quality，JPEG 必须使用不透明颜色背景，WebP 保持 OpenDesign 扩展；Provider 与 Runtime 不再一个声明 `oneOf`、另一个暗中接受 64x scale。Portable file name 的 Windows reserved device name 是唯一 domain refinement，路径、控制字符、尾随点/空格已经进入结构 schema。Run attachment 授权、Page/selection-free target、exact revision、像素/字节预算、原生保存框、取消与事务仍分别由 Main、Renderer 和 Import-Export Service 拥有；trusted internal SVG materialization、prepared bytes/result validator 暂按后续 internal bridge 切片保留，不重新暴露给模型。公开 raster 的 format + SCALE/WIDTH/HEIGHT 语义参照 Figma [`ExportSettings`](https://developers.figma.com/docs/plugins/api/ExportSettings/)；OpenDesign 当前只实现其已声明的 PNG/JPEG/SVG 子集并额外提供 WebP，不把 PDF、Display P3、absolute bounds、overlapping content 或 outline-text 写成已完成。

Text Range 与 Font 已完成第十四个文字编辑迁移切片：`DesignTextRangeContract / DesignFontContract` 分别成为富文本区间样式和显式字体 reflow/replace 的唯一公开输入入口。两者的 typography、paragraph、Paint、Style reference 与 font face shape 直接复用 `UpdateTextRangeStyleCommandSchema / TextFontDescriptorSchema`，不再在 Agent 层复制一套近似字段；Font 的 reflow/replace 是闭合 action 分支，Text Range 只保留 `end > start` 这一项跨字段 refinement。Provider、Pi、工具聚合、Main handler 与 Renderer canonical bridge 均显式 parse 同一 executable schema，旧 `isDesignFontToolInput / isDesignTextRangeToolInput / isTextFontDescriptor` 以及 `exactKeys` 结构遍历已删除。Main 继续拥有 inspect、active Page、planned target 与 review gate；Renderer/EditorRuntime 继续拥有 UTF-16/surrogate boundary、当前 Text 内容、Style 类型、font availability、locked/revision、layout、preview 与事务 invariant。该切片不把字体文件、shaping 或文档内部 run 校验混入模型输入契约。

`ValidationIssue` 的稳定 `code/path/expected/actual/recovery` 通过 `tool-validation` failure details 进入 Agent event、journal 和 Timeline；这种参数修正使用 `correct-and-retry`，不冒充需要文档 inspection 的事务错误。Design transaction 仍保留独立 `inspect-and-revise` 恢复语义。

其余 Agent tools，以及已迁移公开工具之后的 trusted internal Renderer bridge、IPC 与持久化契约尚未迁移，不得据此宣称全仓已实现单一验证入口。

## 后果

- 不重写 pi-agent-core 已有的循环或 TypeBox 参数验证；OpenDesign 只增加产品 domain refinement 和边界 issue adapter。
- 首个迁移会删除较多手写代码并改变测试入口，属于允许的破坏性开发更新。
- 在迁移完成前，新增 first-slice、node apply、Design Plan、Visual Review、Checkpoint、Read/Generate/Place/Update/Edit Image、Page Structure/Page Lifecycle、Component、Style、Variable、Hierarchy、Vector、Arrange、公开 SVG/Raster Import-Export、Text Range 与 Font 字段必须进入对应单一入口；不得继续扩展三套旧函数。
