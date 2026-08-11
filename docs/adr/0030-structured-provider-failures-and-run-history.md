# ADR-0030：结构化 Provider 失败与 Run 历史终态

- 状态：已接受
- 日期：2026-08-11
- 文档协议：不变（`DesignDocument 1.8.0`）
- Agent 协议：`3.7.0`
- 关联：ADR-0008、ADR-0016、ADR-0017、ADR-0020、ADR-0028

## 背景

生产 Provider 已分别限制等待首响应、响应流空闲和单次请求总时长，但旧链路把 watchdog 超时抛成裸 `DOMException`。Main model bridge 再把异常压成字符串，Pi 只保留 `AssistantMessage.errorMessage`，最终 `agent.error` 和 durable `run.state` 只剩泛化的 `run_failed` / `error`。用户无法判断是模型从未响应、流中途停滞还是达到总时限，复制诊断也缺少阈值与请求关联。

Conversation Timeline 同时把所有历史 `error/budget` Run 保持为当前红色阻塞卡。新 Run 已经开始后，旧的“已达到上下文限制”仍显得像当前状态；这与真实运行状态冲突，也让旧错误、当前进度和可操作 approval/tool 混在同一视觉层级。

只在 Renderer 匹配错误字符串不能解决问题：本地化文案、Provider 原始错误和 bridge 包装都会改变字符串，并且 durable history 仍然无法恢复丢失的字段。

## 决策

### Canonical ModelError 是唯一 Provider 失败事实

`@opendesign/model-gateway` 的 `ModelError` 增加以下可选字段：

```ts
type ModelError = {
  code: string;
  message: string;
  retryable: boolean;
  provider?: string;
  providerRequestId?: string;
  modelRequestId?: string;
  timeout?: {
    phase: "first-response" | "stream-idle" | "total";
    thresholdMs: number;
  };
};
```

Provider watchdog 超时统一产生 `code: "provider_timeout"`，但必须保留具体 `phase` 与实际生效的 `thresholdMs`。watchdog 会 abort 真实 fetch/source iterator，再以一个 terminal `attempt.failed` 结束 canonical stream；不得让 Main 依靠 catch 后的字符串重新推断 phase。

`providerRequestId` 只在 Provider 已经返回并被 adapter 观察到时携带。首响应之前通常无法取得该 ID，系统必须明确显示 unavailable，不能伪造。utilityProcess 发起的 model bridge `requestId` 作为 `modelRequestId` 注入每个结构化失败，因此即使上游 ID 未知，Main、Agent、诊断和日志仍有一个共同关联键。

### Pi 字符串错误与结构化 failure 分离

Pi 的 `AssistantMessage.errorMessage` 继续只承担 Pi loop 的终止语义。OpenDesign 在 canonical gateway adapter 与 run event adapter 之间维护一个 Run 内短生命周期 failure port：gateway 记录最近的 terminal `ModelError`，run adapter 在 `agent_end` 消费一次。

该 port 不写第二份 transcript，不持久化 Provider 内容，也不授权工具。用户取消产生的 `cancelled` failure 只维持取消终态，不得把 Run 改成 error。上下文预算、completion guard 和协议失败在 OpenDesign 边界补成同一受限 `AgentRunFailure`，但不会冒充 Provider timeout。

### AgentEvent 3.7 与 durable journal

`agent.error` 增加可选、严格校验的 `failure`；`run.state` 与 `SessionTimelineItem.run` 保存同一结构。`agent.error.code/message` 继续保留，兼容现有消费方与简短状态展示。

旧 journal 中没有 `failure` 的 `run.state` 继续读取并投影为泛化终态，不重写、不删除，也不从历史 message 猜测 Provider phase。JSONL 启动恢复产生显式 `run_interrupted` failure，便于区分应用退出恢复与 Provider 错误。

Main diagnostic v3 可以携带同一 `failure`，复制报告保留 timeout phase、阈值、retryable、Provider、Provider request ID 和 model request ID。结构继续限制字段、长度和允许键，不接受 prompt、凭据、路径或任意 Provider payload。

### 当前失败与历史终态使用不同视觉层级

Conversation 中最后一个 Run 的 error/budget 仍是高权重错误 activity，包含明确标题、阶段说明、时限、重试语义和请求关联。后续 Run 一旦开始，之前 Run 的 error/budget 转成紧凑历史行：

- 保留在原时间顺序中，不删除审计；
- 不使用当前错误边框和危险底色；
- 通过“之前的任务已结束”文案与中性 indicator 表达历史状态，不只依赖颜色；
- 旧 partial message、tool、approval 和 cursor 继续收口，旧 approval 不可操作；
- 切换 Conversation 或重新加载 durable history 后使用相同规则，不能只处理 live event。

该视觉投影不修改 journal、Run status 或错误事实。当前 Run 仍由 `activeRunId` 和最后 Run 顺序共同确定。

## 当前实现

- `ModelProviderHost` 对 `first-response / stream-idle / total` 产生结构化 `attempt.failed`，并 abort 实际 Provider stream。
- `ParentModelGateway` 为 canonical failure 注入 model bridge request ID，同时保留已知 Provider request ID。
- `OpenDesignPiRuntime` 通过 Run 内 failure port 把结构化错误交给 `PiRunEventAdapter`；取消不升级为 error。
- Agent 协议、journal、session projection、Main diagnostic 和 Renderer Timeline 共同使用受限 failure 结构。
- Timeline 在 live event、durable history、Conversation 切换和新 Run 开始后使用同一当前/历史层级规则。
- Renderer 不再把活动 Run 限制为最后 200 个原始 live event。`message.delta` 按 message/block 合并，`tool.progress` 按 tool call 覆盖；`run.started`、`message.completed`、`tool.completed/failed` 与 approval checkpoint 在 Run 进行中也 debounce 请求 `session.history`。durable item 成为同 ID 完成节点的权威状态，live event 只补充尚未落入 history 的活动状态，因此历史投影单调且不会在长流或重试中消失。

## 验证

- Provider host 覆盖首响应、流空闲、总时限，以及 fetch/source abort。
- model bridge 覆盖已知/未知 Provider request ID、Main model request ID 注入、非法 phase/阈值拒绝。
- Pi gateway/run adapter 覆盖结构化 failure 消费、journal 持久化、取消分流和旧泛化错误 fallback。
- session store 覆盖新 failure 投影、旧无 failure journal 兼容与 interrupted recovery。
- Renderer 覆盖三种 timeout 文案、阈值、重试语义、请求关联、后续 Run 的历史折叠和当前 Run 活态。
- Renderer 另覆盖 200 个以上 live event 后完成消息仍存在、活动 Run checkpoint 回读 durable history、同 ID live/durable 合并和 Conversation 隔离。
- diagnostic v3 覆盖结构校验和复制报告，不包含凭据、用户 prompt 或任意路径。

## 结果

### 正面结果

- 用户可以分辨 Provider 从未响应、流停滞和总时限，不再只有模糊“模型超时”。
- 诊断可以沿 model request ID 关联 Main 与 utilityProcess；Provider ID 已知时继续关联上游。
- 新 Run 不再被旧上下文限制或旧失败红卡视觉阻塞，同时完整历史仍可审计。
- 旧 Conversation journal 无需迁移或删除即可继续打开。

### 代价与风险

- Agent、session 与 diagnostic 协议都要维护严格、重复的运行时校验；新增 failure 字段必须同步边界测试。
- 首响应超时通常没有 Provider request ID，只能依赖本地 model request ID；这是上游尚未返回 ID 的事实，不应通过伪造解决。
- 当前只表达一次 Provider attempt 的终态。Provider 级自动 retry、退避、熔断和多 attempt 汇总仍需后续独立策略。

## 复审条件

如果接入 Provider 自动重试、多候选模型切换、服务端异步任务、可恢复 SSE cursor、跨设备 Conversation 或外部遥测，应复审 attempt/run failure 的聚合、隐私、保留期和 UI 层级。不得把一次 attempt 的 request ID 当成整个 Conversation 的稳定身份。
