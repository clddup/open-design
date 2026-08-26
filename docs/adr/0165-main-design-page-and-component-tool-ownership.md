# ADR-0165：Main 设计 Page 与 Component 工具所有权

## 状态

已接受。

## 背景

Page lifecycle 与 Component/Instance 已分别拥有权威 Contract、EditorRuntime planner、Renderer execution 和 `GlobalTaskCoordinator` 规则，但 Main 入口仍直接实现两组策略。

Page 分支同时处理 Page structure capability 的审批身份、Run grant、Delivery Scope 前置条件，以及 create/rename/duplicate/reorder/clear/delete 的 inspection、revision 与 clear supersede。Component 分支则同时处理 access、inspection、material-write 分类、visual-review 写门禁、delivery target 解析和 revision 记录。它们是完整业务边界，不应继续作为 Main bootstrap 的条件分支。

## 决策

1. `DesignPageToolHandler` 是 Page Agent 工具族的唯一 Main policy owner：
   - 解析 `request_page_structure_access` 与 `manage_pages` 的权威 Contract；
   - 以 Run/tool-call/actions 三元身份判断 Page structure preauthorization；
   - 只在当前 Run 已获 grant 且 Delivery Scope 已确认时返回 capability；
   - 在 Page lifecycle 执行前检查 access 与权威 inspection；
   - 只在真实 revision 或显式 clear 后记录 lifecycle；
   - clear 时 supersede 当前 Page 的未完成 delivery，并返回结构化 disposition。
2. `DesignComponentToolHandler` 是 Component/Instance Agent 工具族的唯一 Main policy owner：
   - 解析权威 Component Contract；
   - 检查 Component access 与权威 inspection；
   - 复用 `component-tool-policy` 对 action 做 material-write 与稳定 target refs 分类；
   - 仅 material write 执行 visual-review 门禁、delivery target 解析、真实 revision 记录与 delivery 附加；
   - 纯 Component identity/导航或 name-only override 不冒充材料设计进展。
3. `agent-approval-handler` 继续持有 approval lifecycle 的 grant/revoke；Page handler 只消费 coordinator 的当前授权事实，不建立第二份 approval 状态。
4. `GlobalTaskCoordinator` 继续唯一持有 Page/Component access、inspection、Plan/delivery 与 revision 规则；Renderer/EditorRuntime 继续唯一写入文档。
5. Main 入口只委托两个 handler，不再解析 Page/Component Contract、不再分类 material action，也不再拼装 clear/delivery 结果。
6. 不改变公开工具名称、schema、approval、Page lifecycle、Component 语义、事务、revision、delivery 或错误语义；不保留兼容分支。

## 结果

- Page structure approval、Page lifecycle 与 clear supersede 形成一个可独立验证的完整 owner。
- Component policy 不再散落在 Main 入口，既有 classification helper 只由 Component owner 使用。
- Main design-tool dispatcher 的 Image、Capture/Review、Import/Export、Page 与 Component policy family 均已迁出，Phase 6 的 Main 所有权治理完成。

## 验证

- 非 Page/Component 工具不会触碰对应 coordinator 状态。
- malformed 输入在 access、inspection 和 Renderer 前返回准确字段路径。
- Page structure preauthorization 使用 Run/tool-call/actions 精确身份；未获 Run grant 不返回 capability。
- Page rename 只在 revision 后记录；zero-revision clear 仍 supersede delivery，非结构化 clear 结果失败关闭。
- Component identity 操作不触发 visual-review/delivery；material Instance 创建按 parent target 和 created instance ID 记录 revision。
- name-only Instance override 不冒充 material write。
- Desktop 定向 Vitest、typecheck、ESLint、Prettier 与生产 build 通过。
