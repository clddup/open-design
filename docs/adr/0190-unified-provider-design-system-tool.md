# ADR-0190：统一 Provider 设计系统工具

## 状态

已接受。

## 背景

Provider 过去分别看到 Component、Variable 与 Style 三个管理工具。三者都作用于当前 Design File 的设计系统事实，使用相同的 `design_write` 风险、Page/Document 作用域、inspection 前置条件、revision、preview 与 undo 语义；模型却必须先选择工具，目录和提示词也重复解释相同边界。

Vector、Typography、Image 和 Page 不具备上述同质性。Vector 拥有路径、顶点、切割和拓扑失败语义；Image 涉及外部资源与授权；Page 需要单独审批；Typography 有字体与 range 契约。把它们机械塞进统一入口只会扩大 union 并降低错误定位质量。

## 决策

1. Provider 只看到 `opendesign_manage_design_system`，输入以 `kind=component | variable | style` 选择分支，并在 `input` 中组合既有权威 Contract。
2. 外层 Schema 是 Provider 与 Runtime 的共同事实源。Runtime 先按 `kind` 选择同一真实分支，结构和领域错误统一定位到 `/input/...`，不复制内部字段规则。
3. Main 只解析一次公开输入，再路由到明确标记为 internal 的 Component、Variable 或 Style 调用。内部 handler、policy、planner 和 service 继续独立，不形成巨型 switch。
4. Renderer 继续只接受内部规范调用并复用唯一 EditorRuntime、revision、preview、transaction 和 undo 路径；统一工具不建立第二份文档状态。
5. 产品尚未发布，删除三个旧公开名称，不注册兼容别名。internal 名称不进入 Provider catalog。
6. `opendesign_edit_vector` 继续独立；本切片不以工具数量为目标继续合并不同风险语义。

## 结果

- Provider 公开工具从 25 个降为 23 个，设计系统操作不再竞争三个入口。
- Component、Variable 与 Style 的 schema、domain refinement 和执行 service 仍各自拥有职责；统一的是 Provider 任务入口。
- 系统提示、完成门禁和 Timeline 使用统一公开名称，用户只看到一条设计系统步骤。
- 错误保留稳定 discriminant 和具体字段路径，避免退化为顶层 union 失败。

## 验证

- 三种分支的合法输入通过同一公开 Contract，非法字段返回 `/input/...`。
- Provider catalog 只包含统一工具，不包含 internal Component/Variable/Style 名称。
- Main 路由后仍执行原有 access、inspection、visual-review、delivery 与 material target 记录。
- Renderer 的 Component、Variable 与 Style 事务测试继续覆盖 revision、Page scope、preview、apply 和失败恢复。
