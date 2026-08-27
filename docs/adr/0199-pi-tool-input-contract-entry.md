# ADR-0199：Pi Tool 输入单一契约入口

## 状态

已接受。

## 背景

`AgentToolDefinition` 同时允许 `validateInput()`、`validateInputIssues()` 和 `explainInvalidInput()`。Desktop 生产工具还维护一份按工具名分支的 `validateDesignAgentToolInput()`，导致同一输入可能分别经过布尔 guard、Contract issues 和错误解释。Pi 的 `beforeToolCall`、tool `execute` 与 error projection 也可能重复调用 validator；模型既可能得到结构化字段路径，也可能退化为通用或手写说明。

## 决策

1. `AgentToolDefinition` 只保留必需的 `validateInputIssues(input)`。删除 `validateInput` 与 `explainInvalidInput`，安全目录也只接受具有结构化 issue 入口的定义。
2. 每个公开 Design Agent tool 必须直接提供其权威 Contract `.issues`。Capabilities、Inspect 与 Capture 的空输入共用一个 executable empty-object Contract，不再手写 `isRecord + Object.keys`。
3. Desktop 只维护 Tool Name→Contract issues 的注册映射；内部 Apply/Image/SVG/Component/Style/Variable 工具同样映射到已有权威 Contract。`validateDesignAgentToolInput()` 仅是该映射的布尔薄投影，供仍只接受 boolean 的 trusted bridge/runtime 使用，不再含工具分支或结构规则。
4. Pi Adapter 的 schema failure 始终由 issues 生成稳定 message、fingerprint 与 `tool-validation` details；删除 generic validator fallback 与 tool-owned explanation 分支。
5. 活动 tool call 首次通过 issues 后记录 validated 状态。Pi `beforeToolCall`、executor 与 terminal projection 复用该结果，同一调用只解析一次；仅测试或独立直接执行、没有 active lifecycle 的工具在 execute 边界解析一次。
6. 该切片不合并 Typography、Image、Vector 等语义和风险不同的工具，也不改变公开工具数量、Provider Schema 或 Main 权限边界。

## 结果

- Tool 输入只有一个结构/领域 issue 入口，不再并行维护三类 validator。
- 模型非法参数稳定获得准确 `code/path/message/recovery`，不再因调用路径不同退化为另一套文本。
- 正常 Pi 调用不会在 hook、execute 和 terminal 阶段重复遍历大型工具输入。
- Main Tool Runtime 与 Renderer bridge 仍执行防御性校验，但都从同一 issues owner 投影，不产生第二份事实源。

## 验证

- 完整公开 catalog 每项都具有 `validateInputIssues`。
- 空输入工具未知字段、未知工具和 internal tool 映射路径。
- 合法 Pi tool call 的 issues 函数只调用一次。
- 非法输入返回 `tool-validation` details、准确 path 和可恢复失败。
- Progressive disclosure 保留同一 trusted issue parser。
- Production Pi catalog、Context budget、Main Tool Runtime 与 Agent Host 回归。
