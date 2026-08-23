# ADR-0144：单一来源的工具契约验证

- 状态：Accepted，first-slice、node apply、Design Plan、Checkpoint 与图片获取已实施，其余契约分阶段实施
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

`ValidationIssue` 的稳定 `code/path/expected/actual/recovery` 通过 `tool-validation` failure details 进入 Agent event、journal 和 Timeline；这种参数修正使用 `correct-and-retry`，不冒充需要文档 inspection 的事务错误。Design transaction 仍保留独立 `inspect-and-revise` 恢复语义。

Visual Review、图片放置/更新/编辑、导入导出、结构、Page、Component、Style、Variable 等其余 Agent tools 与 IPC/持久化契约尚未迁移，不得据此宣称全仓已实现单一验证入口。

## 后果

- 不重写 pi-agent-core 已有的循环或 TypeBox 参数验证；OpenDesign 只增加产品 domain refinement 和边界 issue adapter。
- 首个迁移会删除较多手写代码并改变测试入口，属于允许的破坏性开发更新。
- 在迁移完成前，新增 first-slice、node apply、Design Plan、Checkpoint、Read Image 或 Generate Image 字段必须进入对应单一入口；不得继续扩展三套旧函数。
