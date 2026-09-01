# ADR-0266：Assistant 消息采用不可变追加语义

## 状态

已接受，取代 ADR-0020 与 ADR-0216 中 Completion Guard 通过空 `message.completed` 清除 provisional Assistant 内容的决定。

## 背景

Provider 的 Assistant text 已通过 `message.delta` 显示后，Completion Guard 拒绝、异常或 Run 中断会发布同 `messageId` 的空完成事件。Renderer 虽尝试保留 live delta，但持久 journal 不记录该消息，重载、续跑和 durable/live 合并后仍可能消失。Plan、工具状态和宿主完成判断因此事实上改写了模型对话，用户无法判断模型究竟返回了什么。

compact 新建设计提示还要求只在工具执行后返回用户文本。该策略没有吞消息，但会让只有 reasoning + tool call 的首个 Provider 回合看起来像客户端隐藏了自然回复。

## 决策

1. 每个 Provider 已结束的 Assistant message 都按原 `messageId` 和 block 顺序写入 append-only journal，并发布相同的 `message.completed`。
2. Completion Guard 只判断 Run 是否可以结束。拒绝时保留候选 Assistant message，再追加可信 continuation；异常、拒绝上限和中断同样保留已经到达的模型内容，然后追加结构化终态。
3. Plan、tool、approval、run status 与 reasoning disclosure 是独立 Timeline item，不得替换 Assistant identity。Renderer 只允许 live delta 被同一 durable message 完成，不允许状态卡或空 block 删除正文。
4. reasoning summary 可以默认折叠；Assistant text 必须正常渲染并保持在真实事件位置。
5. compact 系统提示允许模型在首个工具前自然给出简短 intent，但禁止宿主或提示注入固定“好的，我开始”模板。没有 pre-tool text 时，UI 只展示真实状态，不伪造 Assistant 回复。

## 结果

- 用户看到的模型正文与 Provider/journal 一致，校验续跑不会造成消息出现后消失。
- Completion Guard 仍可阻止 Run 虚假完成，但不再拥有对话删除权。
- 被 Guard 否决的模型完成声明会作为“不可信模型消息”保留；可信 Plan、revision 和终态继续由独立宿主事件表达。

## 验证

- Guard 首轮拒绝后，首轮和续跑回复都进入 durable journal。
- Guard 自身异常或达到拒绝上限时，已返回正文位于错误终态之前。
- Renderer 覆盖 text → tool → text、stream completion、失败/取消、Conversation 恢复和 durable/live 去重顺序。
