# ADR-0302：Main 单次解析工具输入与统一普通编辑入口

## 状态

已接受，取代 ADR-0173 与 ADR-0212 中“跨进程 bridge 再次执行工具语义输入校验”的部分。Envelope、Trusted Context、result、revision 与 correlation 的决定继续有效。

## 背景

Provider 已按权威工具 Schema 生成参数，Utility 也会在执行前使用同一 Contract 给出字段错误；但 Utility→Main 与 Main→Renderer 的 bridge 又把 `call.input` 交给工具 validator。一次输入因此可能被多层重复解析，且 bridge envelope、工具语义和当前文档 guard 的职责混在一起。Hierarchy 与 Arrange 还保留独立公开名称和 Renderer 直达分支，虽然生产 Provider 已经通过 `opendesign_edit_design` 使用相同 planner。

## 决策

1. Tool Call 和两段 bridge Contract 只验证 envelope、可信上下文、关联身份与结果结构；`call.input` 保持 opaque，不在 bridge Contract 中重复解析。
2. `MainDesignToolRuntime` 是工具语义输入的唯一可信解析边界。它按 `toolName` 调用对应权威 Contract，成功后把 canonical value 交给领域 handler；失败统一返回结构化 `code/path/expected/actual/recovery`。
3. Renderer 只接收 Main 已解析并授权的 canonical 输入。Renderer bridge 继续验证 request/context/capture target/result，但执行分支不再次调用工具 Contract。
4. 普通节点、层级和排列编辑统一由 `opendesign_edit_design` 承载，并按 `edits` 顺序投影后原子提交。独立 `opendesign_edit_hierarchy`、`opendesign_arrange_layers` 名称和 Renderer 直达分支删除，不保留兼容 alias。
5. 是否发生材料写入只由可信 `designRevision` 证明。工具结果中的 observed revision 或对输入数组、命令数量和节点 kind 的手写检查不能推进工具披露或 Completion Guard。
6. Component、Vector、Typography、Image、Page、Design System 与 Import/Export 仍保留独立语义工具；本决策不按固定工具数量建立门禁。

## 结果

- Provider、Utility 和 Main 使用同一工具 Contract；跨进程 bridge 不建立第二份语义事实。
- 普通 Figma 式节点、层级和排列修改只有一个模型入口，但继续复用原 planner、事务、revision 与 undo。
- 只观察文档而未提交事务的工具不会被误判为材料写入，也不会错误切换 Provider 工具面或让完成门禁放行。
- 当前 Design File 的历史内容继续可由后续 Run 编辑；Run 失败只终结当前执行。

## 验证

- Tool wire 测试验证 opaque input 与严格 envelope。
- Main parser 测试验证权威 Contract、host binding 和准确字段路径。
- Renderer 统一编辑测试覆盖 node、hierarchy、arrange 的有序投影、单 revision、单 undo、失败原子性与 planner warning。
- Agent Runtime 测试验证只有可信 `designRevision` 才记录 `revisionAdvanced` 并推进 continuation。
- 全仓 lint、typecheck、行为测试与 production build。
