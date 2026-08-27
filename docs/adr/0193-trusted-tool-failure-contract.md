# ADR-0193：跨进程 TrustedToolFailure 单一契约

## 状态

已接受。

## 背景

`TrustedToolFailureContract` 已组合失败 envelope Schema 与设计工作流跨字段 refinement，但生产 `isTrustedToolFailure()` 仍使用 `Value.Check` 和另一个 details 布尔守卫。这条路径只验证结构，可能接受 failure code、workflow code、phase、inspection 要求或 issue code 互相矛盾的数据。

Session 历史恢复还需要独立判断旧 tool failure 的 details 是否符合当前结构。该判断只负责保留或移除 details，不能把依赖外层 failure code 的工作流关系塞进 details 层，也不能因为 details 损坏而删除整条历史消息。

## 决策

1. `TrustedToolFailureContract` 是 Trusted failure envelope 结构和跨字段关系的唯一验证入口；`isTrustedToolFailure()` 只代理其 parse 结果。
2. `AgentToolFailureDetailsContract` 直接组合现有 discriminated union Schema，只负责 transaction、tool-validation 与 design-workflow details 的结构。
3. `isAgentToolFailureDetails()` 只代理 Details Contract，供 Session 历史恢复使用；外层 code 与 workflow details 的一致性继续只由 Trusted failure 或 Agent Event 的 domain refinement 校验。
4. 历史 details 不兼容时只移除 details，保留 tool 行、错误 code/message 和消息顺序；合法结构化 details 原样保留。
5. 不增加兼容格式、消息文本分类或第二套 workflow 定义。

## 结果

- Renderer bridge、Tool Event 和其他生产 failure guard 不再绕过 workflow domain refinement。
- 矛盾的 workflow failure 返回稳定 `code/path/expected/actual/recovery`，不会作为可信失败继续流转。
- Session 历史仍能读取旧错误，同时不会因局部 details 损坏而丢失整条消息。

## 验证

- failure code、phase、requiresInspection 与 issue code 四类不一致均被同一 Contract 拒绝，并定位到准确字段路径。
- 合法 transaction failure 与 workflow failure 继续通过。
- 合法历史 details 保留；不兼容 details 仅被移除，tool 消息仍存在。
