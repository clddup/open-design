# ADR-0095：宿主条件式设计 checkpoint

- 状态：Accepted
- 日期：2026-08-19
- Agent 协议：不变（新增模型可见 typed tool，不改变事件或持久 journal 契约）
- 文档协议：不变
- 关联：ADR-0018、ADR-0050、ADR-0052、ADR-0072、ADR-0080

## 背景

生产测量显示设计生成的大部分等待来自 Provider 回合，而不是 Renderer 事务。普通首稿需要模型分别发起 material apply 与 capture；视觉审查后又需要 review、refinement 和 final capture。即使模型在一个 assistant turn 返回多个普通 tool call，固定 `pi-agent-core` 的 sequential 执行也只保证顺序，不保证前项失败后停止后项。apply 或 refinement 失败后继续 capture 会审查旧 revision，并制造额外恢复噪音。

这类依赖是宿主已经能够确定的控制流，不需要新的模型判断。它仍必须复用现有 Coordinator、Renderer host、EditorRuntime、revision、autosave、熔断、取消、附件和 delivery ledger，不能为提速建立第二套设计写入或截图路径。

## 决策

### 新增一个有界联合工具

完整通用工具面新增 `opendesign_design_checkpoint` v1，只有两个 action：

1. `apply-and-capture`：接收一笔 canonical `DesignApplyToolInput`；material apply 成功并返回新 `designRevision` 后，才捕获该 revision。
2. `review-refine-and-capture`：先接收既有 typed visual review，再执行一笔 canonical refinement；review 被 Coordinator 接受且 refinement 成功并返回新 revision 后，才执行 final capture。

工具不跨越 approval、inspection、图片生成/读取、Page lifecycle 或任何后一步必须读取前一步未知结果的边界。模型输入继续经过原 apply/review validator；复合工具不放宽节点、Plan、active target、brief fidelity、layout quality 或 visual-review 门禁。

### 复用唯一执行路径

Main 的普通 review、apply 与 capture 路由和 checkpoint 子阶段调用同一组执行函数：

- apply 继续经过 `assertVisualReviewBeforeWrite`、Plan/target authorization、Renderer host、EditorRuntime、autosave、apply result 校验和 ledger 推进；
- capture 继续按“离屏渲染 → exact-revision inspection → deterministic layout quality → Coordinator recordCanvasCapture”执行；
- review 继续只由 Coordinator 登记，不把模型文本当作渲染或完成证明。

首个高置信空白画布 `opendesign_generate_first_slice` 成功提交真实材料 revision 后，由 Main 在同一次工具调用中自动走上述 capture 路径。它不新增第二个模型输入，也不改变 compact first-slice 的单 history group。

### 短路与部分成功

- apply 失败时不 capture；review 失败时不 refine/capture；refinement 失败时不 capture。
- apply/refinement 已成功提交而 capture 失败时，不回滚有效设计写入，也不把工具伪装成完全失败。结果保留可信 `designRevision`，以 `checkpoint.status = capture-failed` 返回结构化 failure 和当前 delivery，不返回虚假的 `observedRevision`。Agent Runtime 因此先推进当前 revision，模型只能重试 capture，不能重复材料写入。
- capture 成功时，其 `observedRevision` 必须严格等于材料 `designRevision.revision`；结果同时返回该 revision、capture attachment、review workflow 和最新 ledger。
- 复合工具不是跨阶段数据库事务。材料 revision、语义步骤、history 和 autosave 在 capture 失败时仍然有效；用户可通过既有目标级 undo/history 恢复。

### 过程展示与完成判断

checkpoint 是一个用户可见的原生设计工具活动，内部 progress 映射到单调有界区间。画布真实步骤仍来自 EditorRuntime 已提交 revision，Timeline/cursor/reveal 不播放模型声明或虚假拖拽。

completion guard 以最新可信 delivery ledger 为权威：所有 target 已 `verified` 时允许完成，不再要求外层事件必须分别出现普通 capture/review 工具名。没有 verified ledger 时仍执行原有门禁。

## 后果与限制

- 首个真实切片不再等待模型专门发起首次截图；已知的 apply→capture 和 review→refine→capture 各删除纯控制型 Provider 往返。
- 工具 schema 增加固定协议成本，因此只进入完整通用工具面，不加入 compact first-slice 首轮。
- capture 失败后的“已写入但未验收”成为明确状态；调用方必须保留 revision，并在恢复时只重试未完成阶段。
- 该变更优化调用图，不证明真实 Provider 延迟已下降。macOS/Windows 打包产品仍需按 `1/4/12` target 采集 `T0/T1/T2/T_all`。

## 验证

- 契约测试覆盖两个 action、非法缺失字段和额外字段；
- handler 测试覆盖阶段顺序、每个失败点短路、capture 失败保留 revision、首 slice 附件合并、exact revision 与单调 progress；
- production context 测试继续约束完整工具面和 schema/token 预算；
- Renderer 投影测试覆盖 checkpoint 的 native Timeline 标题、reviewing/refining phase 与可信 Run 状态；
- completion guard 测试覆盖单个 checkpoint 返回全 verified ledger 后可以完成。

## 复审条件

如果未来引入 target 并行生成、跨 Design File checkpoint、服务端事务、可恢复工作流引擎或跨阶段 approval，需要复审 action 边界、取消和部分成功语义；不得用复合工具绕过每个目标的 capability、revision 或 Coordinator ledger。
