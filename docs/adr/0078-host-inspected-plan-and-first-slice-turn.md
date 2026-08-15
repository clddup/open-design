# ADR-0078：宿主预检后的 Plan 与首个真实切片同轮提交

- 状态：Accepted
- 日期：2026-08-15
- Agent 协议：不变（`3.11.0`）
- 文档协议：不变（`DesignDocument 1.30.0`）
- 部分取代：ADR-0075 的“首轮仅 Plan、下一 Provider turn 才披露基础 apply”
- 关联：ADR-0050、ADR-0072、ADR-0073、ADR-0075
- 参考：OpenPencil 专用 planning → host scaffold → segmented generation

## 背景

ADR-0075 把 exact-revision inspection 移到 Main，在正常新建设计中删除了一次由 Provider 决定 inspection 的串行往返；但它同时让 host-inspected 首轮保持 Plan-only，必须等 Plan 工具结果进入下一次 Provider 请求后，模型才能看到基础 `opendesign_apply_transaction`。生产样本已经显示 Provider 时间远大于 Renderer apply，因而为减少约 7 KB 基础 schema 而固定增加一次完整 Provider turn，不符合“尽快看到第一个真实可用区域”的目标。

OpenPencil 值得借鉴的不是空 skeleton 或第二套 DSL，而是 plan 之后由宿主立即建立真实 scaffold，并尽快让第一段真实内容进入画布。OpenDesign 已具备同样的安全前提：Plan 选择稳定 target/Frame/region ID；Main 按 accepted Plan 原子分配真实 Frame；Pi 工具强制 sequential；模型输入不携带 `baseRevision`，Main 在每个成功工具后推进可信 revision；Global Task Coordinator 会在 Plan 不存在、失败或不匹配时拒绝材料写入。

## 决策

### Host-inspected 首轮同时披露 compact apply

Main 初始预检成功后，首个 Provider turn 披露：

1. `opendesign_inspect_document`，仅用于明确刷新与恢复；
2. `opendesign_define_design_plan`；
3. `opendesign_read_image`；
4. `opendesign_request_page_structure_access`；
5. `opendesign_manage_pages`；
6. 使用 ADR-0073 基础 schema 的 `opendesign_apply_transaction`。

`opendesign_generate_image` 继续等 accepted Plan 声明 raster role 后再披露。完整专业工具仍只在首个材料 revision、Page lifecycle 写入或 existing-artboard Plan 后展开。

### 同一 assistant turn 的顺序是契约

普通新建设计的首个可编辑区域只依赖模型自己在 Plan 中声明的稳定 Page/Frame/region/node ID 与局部几何时，模型应在同一 assistant turn 依次发出：

```text
define_design_plan
→ compact apply_transaction（首个 navigation/Hero/mark/content 等真实切片）
```

Pi 按工具 block 顺序串行执行。Plan 成功后 Main 先分配真实 Frame roots、推进 revision 并自动保存，再以新 revision 执行材料写入。Plan 失败、未接受或未建立 active target 时，材料门禁按既有结构化错误拒绝第二个调用，不能越过 Plan 或写到 Page root。

以下依赖不能合并到同一 turn：Page approval、重新 inspection、必须先看结果的 `read_image`、capture 图片分析、未知 attachment ID、失败恢复或任何需要读取前一工具结果才能构造下一输入的操作。模型可以退回多轮执行，正确性优先于强行省轮次。

### 不建立新执行器

基础 apply 继续复用同一个 tool definition、完整 runtime validator、Main tool host、Global Task Coordinator、Renderer tool bridge、唯一 `EditorRuntime`、revision、history、autosave、recovery 和 audit。此次只改变 Provider 可见时机；不解析文本 JSON、不接收半截流、不新增 scaffold 文档、不并行执行同一 Design File 的写工具。

## 后果与限制

- 对能在一个响应中产生多个参数化工具调用的 Provider，正常新建设计从“Provider Plan → Provider 首稿”压缩为一个 Provider turn，`T0` 与 `T1` 可在同一响应的两个真实工具提交中先后发生。
- 首轮固定协议增加基础 apply 的约 7 KB schema，但仍远小于完整专业 catalog；这是一笔以固定输入换一次潜在 Provider 往返的明确权衡。
- 不支持多工具调用、必须读取 Plan 结果或选择一次只调用一个工具的模型仍走两轮，不能把静态调用图冒充真实提速。
- reveal、cursor 和 Timeline 仍只消费成功提交的真实 revision；模型同时声明两次调用不会提前播放过程。
- 本切片不实现 OpenPencil 式 section worker、跨 target 并发或专用 node script。是否继续引入这些能力仍由打包产品 `1/4/12` target 的 `T_plan/T0/T1/T2/T_all` 数据决定。

## 验证

- disclosure 测试证明 host-inspected 首轮包含 compact apply，仍不包含 image generation 或完整专业工具。
- 生产 catalog 测试证明首轮 apply 使用基础 Frame/Group/Rectangle/Ellipse/Text schema，而不是完整联合类型。
- Pi Runtime 测试在一个 Provider response 中返回 Plan 与 material 两个 tool block，证明执行顺序为 Plan revision 后的材料 revision，随后才展开完整工具。
- system prompt 明确同轮条件、调用顺序与不可跨越的 approval/image/capture/recovery 依赖。
- 真实收益继续由打包产品性能样本验证；自动化只证明调用图和事务顺序。
