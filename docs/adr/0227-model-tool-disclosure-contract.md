# ADR-0227：Model Tool Disclosure Contract 与 Catalog Safety Owner

## 状态

已接受。

## 背景

Provider 渐进工具面已将执行注册和模型可见定义分离，但 `modelDisclosure` 仍在 `tool-disclosure.ts` 手写对象键、枚举、数组唯一性、字符串长度和 bootstrap schema 顶层约束。与此同时，`OpenDesignPiRuntime` 与 `tool-definition-safety.ts` 各自维护一套 Tool Definition 安全筛选。两份判断可能漂移，使同一工具在 Runtime 初始目录和 Pi 阶段目录得到不同结果。

## 决策

1. `ModelToolDisclosureSchema` 唯一拥有 bootstrap、Plan/inspection 阶段、角色、Provider surface、紧凑描述、紧凑输入 schema 和 Delivery Scope 条件的结构约束。
2. `ModelToolDisclosureContract` 是 catalog 边界唯一 executable parser；删除 `isSafeModelDisclosure()` 及其手写字段遍历。
3. `ModelToolSurface` 从同一 schema 派生，`AgentToolDefinition.modelDisclosure` 直接引用 Contract 类型，不再在 Runtime ports 复制字段。
4. `selectSafeDefinitions()` 唯一拥有 Tool Definition 安全筛选和名称去重；`OpenDesignPiRuntime` 与 `PiToolSurfaceCatalog` 都复用该 owner，不再各自维护判断。
5. 该切片只统一工具目录事实和 Provider 披露边界，不合并 Typography、Image、Vector 等语义不同的公开工具，也不改变执行权限、阶段工具面或 Provider 往返。

## 结果

- 非法 disclosure 返回稳定 `agent_tool_disclosure.schema_invalid` 和准确字段路径。
- Runtime 初始工具目录与 Pi 阶段工具目录使用同一安全筛选结果。
- 删除重复 Tool Definition validator 和 disclosure 手写结构规则，没有新增兼容入口、工具数量/hash 或源码形状门禁。

## 验证

- Agent Runtime typecheck；
- disclosure、Pi Tool Adapter 与 Pi Runtime 定向回归；
- Desktop 生产 Agent catalog/context budget 回归；
- Desktop typecheck 与 production build。
