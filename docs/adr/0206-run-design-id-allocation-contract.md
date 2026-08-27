# ADR-0206：Run 设计 ID Allocation 单一契约

## 状态

已接受。

## 背景

每个设计 Run 都从 inspection 获得一个只用于新文档实体的稳定 ID prefix。该对象此前用手写 record、字段相等和 `Object.keys().length` 校验，结构错误与跨 Run namespace 复用都只能返回布尔失败。

## 决策

1. `AgentDesignIdAllocationSchema` 唯一拥有 `version/scope/newNodeIdPrefix` 结构、closed object 和 prefix 基础格式。
2. `AgentDesignIdAllocationContract` 的唯一 domain refinement 校验 prefix 等于当前 `runId` 经既有 `agentDesignNodeIdPrefix()` 派生的结果。
3. `isAgentDesignIdAllocation()` 只保留为带当前 Run context 的 Contract 布尔薄投影。Renderer 创建规则、Main inspection 和既有节点可编辑性不变。

## 结果

- 未知字段与跨 Run prefix 分别获得准确字段路径。
- 删除手写 record 与 key-count 守卫，不增加 ID 限制或兼容分支。
- Allocation 仍只约束本 Run 新建 ID，不形成历史节点写入所有权。

## 验证

- 当前 Run 派生结果通过 Contract。
- 另一 Run 的 prefix 返回 `agent_design_id_allocation.run_mismatch` 和 `/newNodeIdPrefix`。
- 未知字段返回其真实路径，且不进入 identity refinement。
