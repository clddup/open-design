# ADR-0100：Design Agent 工具能力族边界

- 状态：Accepted
- 日期：2026-08-19
- Design Plan：`1`
- Visual Review：`1`
- 文档协议：不变
- 关联：ADR-0046、ADR-0086、ADR-0095、ADR-0098、ADR-0099

## 背景

`apps/desktop/src/shared/design-agent-tools.ts` 曾同时拥有工具名称、模型 schema、输入类型、validator、Plan/Review 投影和 25 个工具的注册顺序，增长到 4209 行。任何 Plan、Image、Component 或 Import/Export 变更都需要进入同一个聚合模块，容易复制 schema、误改工具顺序，并让能力 ownership 和进程边界难以审查。

这不是按行数拆文件的问题。ADR-0086 已退休机械行数预算；本阶段要建立可验证的业务所有权，同时保持 Provider 可见 schema、版本、risk/approval、工具顺序和执行语义不变。

## 决策

### 稳定聚合出口

`design-agent-tools.ts` 继续作为现有 Main、Agent、Renderer 和测试的公共导入入口，但只负责：

- 重导出稳定类型、schema、名称和 validator；
- 按原顺序聚合 25 个公开 `DESIGN_AGENT_TOOL_SPECS`；
- 按工具名把不可信输入分发给对应 family validator。

聚合入口不得重新声明 family 类型或复制 schema。新增工具必须先确定 owner，再进入有序聚合。

### 能力族所有权

- `design-agent-plan-review`：Design Plan v1、Visual Review v1、skill refs、质量 profile 组合和纯投影。
- `design-agent-checkpoint`：Checkpoint v1 的 schema 与条件校验。
- `design-agent-image-tools`：Read/Generate/Place/Update Image 及内部 materialized update。
- `design-agent-import-export-tools`：SVG import/export、Raster export 和可信 host 结果校验。
- `design-agent-structure-tools`：Hierarchy 与 Vector edit。
- `design-agent-document-tools`：Page、Page structure approval、Font 与 Text Range。
- `design-component-tool-schema` 与既有 component contract/validator：Component family。
- 既有 Arrange、Variable、Style 模块继续拥有各自 schema/validator。
- `design-agent-operation-schemas`：Apply、Text 和 Component 共同复用的无状态节点/paint/effect schema primitives，不持有 Runtime、文档、revision 或 Electron 能力。
- `design-agent-tool-names`：唯一工具名称来源；`design-agent-validation`：仅包含无业务状态的基础校验函数。

上述模块都位于 `shared`，继续遵守禁止 Electron、Node builtin 和 Main/Renderer/Agent 实现反向依赖的边界。拆分没有建立第二份文档状态，也没有改变唯一 `EditorRuntime` 事务入口。

### 聚合门禁

新增聚合契约测试必须同时锁定：

- 25 个公开工具的精确数量、名称和顺序；
- 每个已拆 family 的 `inputSchema` 与其 owner 导出的对象身份一致；
- 既有 validator 正反样例继续通过。

对象身份门禁用于发现聚合入口重新复制 schema；它不把 JavaScript 对象身份写入跨进程协议，序列化后的 JSON schema 仍是公共事实。

### Workspace 基线

ADR-0098 新增的 `@opendesign/design-skills` 是无 `@opendesign/*` production dependency 的固定本地 skill 包，登记到 `scripts/architecture-baseline.json` 为 `[]`。这修复的是架构事实漂移，不放宽 dependency DAG。

## 明确不做

- 不改变 Design Plan、Visual Review、Checkpoint、Apply 或文档协议版本；
- 不改变工具名称、顺序、描述、risk、approval、模型披露或执行器；
- 不借拆分增加新的质量门禁、Provider 往返、截图、延时或恢复分支；
- 不保留旧万能 schema 的兼容副本或双写路径；
- 不用重新导出壳掩盖互相循环的实现依赖。

## 后果

- 修改某一能力时可以在 owner 内完成类型、schema 和 validator 审查，聚合入口只接线；
- 共享节点 schema 只有一个来源，Component/Text/Apply 不复制 Paint、Effect 或 Node patch 定义；
- 后续 Figma-shaped 能力可以按 family 增长，不再把万能文件作为默认落点；
- `design-agent-tools.ts` 从 4209 行收敛为约 680 行，但验收依据是 ownership 与契约测试，不是行数本身。

## 验证

- Desktop typecheck；
- `design-agent-tools.test.ts` 的既有 35 项 validator/schema 行为；
- `design-agent-tool-aggregation.test.ts` 的工具顺序与 schema 单一来源；
- `pnpm architecture:check` 的 Electron layer、workspace dependency DAG 与 package baseline。

## 复审条件

公开工具注册需要按 Provider 动态裁剪、schema primitives 被提升为独立 workspace package、跨 family 产生循环，或某个 family 需要自己的版本迁移时复审。不得通过把实现重新堆回聚合入口来绕过复审。
