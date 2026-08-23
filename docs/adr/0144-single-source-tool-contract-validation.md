# ADR-0144：单一来源的工具契约验证

- 状态：Accepted，分阶段实施
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

## 后果

- 不重写 pi-agent-core 已有的循环或 TypeBox 参数验证；OpenDesign 只增加产品 domain refinement 和边界 issue adapter。
- 首个迁移会删除较多手写代码并改变测试入口，属于允许的破坏性开发更新。
- 在迁移完成前，新增 first-slice 字段必须进入新的单一入口；不得继续扩展三套旧函数。
