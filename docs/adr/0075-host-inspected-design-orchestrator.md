# ADR-0075：宿主预检与新建设计 Plan-first 编排

- 状态：Accepted
- 日期：2026-08-15
- Agent 协议：`3.10.0`
- 文档协议：不变（`DesignDocument 1.29.0`）
- 部分取代：ADR-0078 已让 host-inspected 首轮同时披露 compact apply；本 ADR 的预检与有界上下文决策继续有效
- 关联：ADR-0016、ADR-0029、ADR-0050、ADR-0072、ADR-0073
- 参考：OpenPencil compact plan、真实 scaffold 与 segmented design workflow

## 背景

ADR-0050 已让 Plan 后的 `1..N` 个真实 Frame 根一次分配，ADR-0073 也把初始 catalog 从完整二十一工具压到七工具，但新 Run 仍通常需要模型先决定调用 inspection，再在下一次 Provider 请求决定 Plan，第三次请求才生成第一笔材料事务。生产样本显示 Provider 串行时间远大于 Renderer 工具执行时间；继续压缩 schema 不能消除这次独立决策。

OpenPencil 内置生成路径的可借鉴点是宿主先准备上下文、第一轮只返回紧凑计划、随后创建真实 scaffold，再分段提交真实内容。OpenDesign 不能复制其私有 DSL、文件路径或第二份文档状态，但可以在既有 Main/Renderer/EditorRuntime/revision 边界内采用同样的阶段关系。

## 决策

### Main 在首个 Provider turn 前执行同一 inspection

Run 已经通过 Project/Design File/Page/revision 注册后，Main 使用与公开 `opendesign_inspect_document` 完全相同的 Renderer tool host、scope 解析和结构化结果执行一次预检。结果必须精确匹配 Run revision，随后进入同一个 `GlobalTaskCoordinator.recordDocumentInspection()`；并发 revision、Renderer timeout 或任何预检失败都不伪造成功，而是回退到公开 inspection 工具链。

预检不修改文档、不产生 revision/history，也不伪装成模型 tool call。`RendererDesignToolHost` 继续记录真实耗时；用户 Stop 会 abort 正在进行的预检并阻止 Run 进入 Agent utility process。预检使用独立的 5 秒首响应、10 秒空闲和 15 秒总 deadline，不能继承材料生成的 15 分钟总时限并让 Composer 看似无响应；deadline 后才允许回退公开 inspection 工具链。无论预检成功或回退，Main 都必须在发送 Agent Run 前重新读取注册 Design File 并核对 document/revision，避免等待期间的其他 Run 把初始上下文变成陈旧快照。

### AgentRequest 3.10 只携带有界 Main-owned 投影

Main 使用现有 `projectToolResultForModel()` 将 inspection 限制在最多 50,000 个模型投影字符，再通过最多 60,000 字符的 `initialDesignInspection { version, observedRevision, content }` 发送给 Agent。Renderer 发来的 `run.start` 不得包含该字段；跨进程 schema 拒绝额外字段、超限内容和不等于 Run revision 的快照。

Provider 当前用户消息前会临时加入明确标记的 trusted-host context；文档字符串仍是不可信设计数据，不是指令。append-only journal 的 `message.user` 继续只保存用户原文，模型投影构造与 Pi 初始消息校验复用同一个纯函数，不能用上下文优化破坏 durable transcript 事实。

### Host-inspected 阶段只暴露五个计划期工具

宿主预检成功但尚未 Plan 时，Provider 只看到：

1. `opendesign_inspect_document`，用于授权后刷新、冲突或恢复；
2. `opendesign_define_design_plan`；
3. `opendesign_read_image`，只读取用户显式引用；
4. `opendesign_request_page_structure_access`；
5. `opendesign_manage_pages`，实际受 Main 授权与 inspection 门禁保护。

`generate_image` 与基础 `apply_transaction` 在 Plan 前延后。create-artboard Plan 成功并由 Main 分配真实 Frame roots 后进入 ADR-0073 的 inspected 轻量阶段，下一 Provider turn 获得基础 apply 和图片生成；第一笔材料 revision 后恢复完整工具。existing-artboard Plan 仍直接展开完整编辑工具。没有宿主快照的 Run 保留原七工具 bootstrap，因此预检优化失败不会阻断设计。

## 后果与限制

- 正常新建设计从“Provider 决定 inspect → Provider 决定 Plan → Provider 生成材料”减少为“Main inspection → Provider 决定 Plan → Provider 生成材料”，消除一次串行 Provider 决策；Plan 后的真实 Frame allocation、active target、semantic steps、capture/review/refinement 和 completion guard 不变。
- 图片和 Page 权限按意图披露：显式图片可在计划期读取，生成图片必须等 Plan 声明角色；跨 Page 请求仍必须审批并重新 inspection。
- 这不是新的 executor、第二份 inspection 状态或模型直写通道。公开工具与预检共用 Renderer、Coordinator、revision、failure 和有界投影。
- 静态五工具请求与确定性轨迹只能证明调用图少一轮，不能证明真实 Grok/GLM/Codex 或 macOS/Windows 打包产品的 `T_plan/T1` 已改善；仍需固定 `1/4/12` target 样本。
- 当前第二轮仍由通用 Provider 生成基础 section 事务；并行 section agents、流式半事务 JSON 和跨 target 同屏并发仍未实现，也不应在没有真实样本前引入。

## 验证

- Agent contract 覆盖 Main-owned、exact-revision、60,000 字符与 extra-property 边界；Renderer 伪造字段在 Main 被拒绝。
- Main preflight 测试覆盖 effective scope、同一 inspect tool、bounded projection、unfinished delivery、并发 revision 和 Stop abort。
- Runtime 测试证明宿主快照进入临时模型投影但不改变 durable user prompt；首个请求只有五工具，不含 apply/generate。
- disclosure 测试证明 create Plan 后从 host-inspected 进入 inspected，材料 revision 和 existing Plan 继续按 ADR-0073 展开。
- 真实收益继续由 `design_generation_performance_v1` 的打包产品 `1/4/12` target 样本验收。
