# ADR-0103：首切片契约诊断与完成恢复

- 状态：Accepted
- 日期：2026-08-19
- Compact first-slice：`1`（版本不变）
- Agent Event：`3.6`（协议版本不变）
- 文档协议：不变
- 关联：ADR-0018、ADR-0072、ADR-0080、ADR-0095、ADR-0102

## 背景

生产 Run `run_1787143874973_1` 的两次 `opendesign_generate_first_slice` 在任何设计事务前失败。Durable journal 证明模型第一次提交了两个真实语义 stage，分别包含 10 与 15 个元素；第二次只修改了 safe-area 集合。Provider 可见 JSON Schema 只对每个 stage 声明 `maxItems: 24`，Runtime 却另有“所有 stage 合计最多 24 个”的隐藏约束。模型因此提交了公开 schema 看来合法的 25 元素登录页，Runtime 又只返回顶层 `arguments do not match its schema`，无法指出应修改 `/firstSlice/stages`。两次失败后没有成功 design-write record，旧 completion guard 将该 Run 当作普通文字会话允许完成，画布保持空白。

这不是画布层级、Renderer 或模型审美问题，而是 Provider 契约、Runtime 语义 validator、失败恢复和完成判定没有形成闭环。

## 决策

### 首个可编辑画面的容量以真实常见结构校准

首切片仍只允许第一 target 的一个 planned region 与 1–3 个真实 semantic stage，但合计基础元素上限从 24 调整为 32。32 能容纳生产样本中的品牌身份、说明、两个输入、恢复入口、主操作和注册链接，同时继续限制首轮输出、事务命令和上下文增长；其余 region 与非必要细节仍在首个 material revision 后继续。

Provider 工具描述与 `stages` schema description 必须明确这是“所有 stage 合计”的上限。JSON Schema 无法对多个嵌套数组表达该聚合，因此 Runtime 继续执行权威合计校验，但超限不能再退化为泛化 schema mismatch。

### 每个工具拥有可操作的字段级失败解释

Compact first-slice 注册 `explainInvalidInput`，按当前统一 normalizer 的层级返回首个可操作问题：字段路径、实际数量/形状、期望约束与恢复动作。尤其是跨 stage 总数要报告各 stage 计数与需延后的元素数。未知顶层字段、target、quality profile、stage/element kind 和跨字段层级错误也必须至少定位到最近的稳定路径。

`skillRefs` 始终由 Main 绑定。模型省略它是标准输入；历史或 Provider 回抄值被可信边界丢弃并替换为当前本地固定 refs，不能影响 hash、权限或验证结果。其他未知字段继续拒绝。

### 无 revision 的 design-write 失败不能文字完成

Agent Runtime 对所有可恢复 design-write 失败维护 unresolved 状态，包括在 Pi 内部 schema 层、`beforeToolCall` 或可信 executor 之前发生的 `invalid_tool_input`。只有成功推进文档 revision 的设计写入才能清除该状态；普通文本、inspection 或模型“已修复”声明不能清除。

Completion guard 遇到 unresolved `invalid_tool_input` 时必须要求基于字段路径提交纠正后的 tool call，不得允许 text-only completion，也不得让模型要求用户重开请求。既有需要 inspect-and-revise 的事务 invariant 继续使用原恢复链路。

## 后果

- 生产 25 元素登录页参数可在首个 Provider 调用直接进入真实 EditorRuntime 事务，不再为一个人工预算边界浪费完整往返。
- 超过 32 的首切片仍失败封闭，但模型会知道确切路径、计数和需延后数量。
- Pi 内部先于 OpenDesign hook 拒绝参数时，失败仍进入统一 unresolved completion 语义。
- 首轮容量略增会允许最多八个额外基础节点；是否影响 T1 仍由打包产品 `1/4/12` target 样本衡量，不能用静态 schema 数字推断。
- 本决策不降低文档 invariant、Page/Frame scope、revision、history、quality profile 或 capture/review 门禁。

## 验证

- 使用生产 journal 中第二次完整参数离线复现：修复后同一 25 元素输入通过统一 normalizer。
- 固定回归覆盖 25 元素两 stage 成功，以及 33 元素失败时返回 `/firstSlice/stages`、`33` 与 combined maximum `32`。
- Production tool spec 测试证明 first-slice 注册统一字段解释器且描述合计上限。
- Agent Runtime 测试证明 Pi schema 预拒绝的 design-write 也留下 unresolved failure。
- Completion guard 测试证明 invalid first-slice 后的文字收尾被拒绝，必须继续提交纠正调用。
