# ADR-0218：Pi Context Message Projection Owner

## 状态

已接受。

## 背景

`pi-context-adapter.ts` 同时负责 journal/checkpoint 准备、每轮上下文预算与压缩、attachment WeakMap，以及 canonical Message→Pi Message 的全部字段投影，超过 500 行。消息投影是确定性转换，不应与动态预算状态混在同一 owner。

## 决策

1. `pi-context-message-projection.ts` 唯一拥有 canonical user/assistant/tool Message 到 Pi Message 的 text、attachment、tool name、reasoning、API、usage 与 result 投影。
2. `OpenDesignPiContextAdapter` 继续唯一拥有每轮 transformContext、预算、current prompt anchor、attachment WeakMap、failure port 与工具 schema 更新。
3. `prepareOpenDesignPiContext` 继续唯一拥有旧 journal checkpoint、初始 prompt 和 prior tool-call ID 准备；不改变原始 Conversation journal。
4. 不增加 tokenizer、Provider 特例、兼容 fallback、版本或数量门禁；inline bytes 仍被拒绝，附件仍只通过 content-addressed reference 进入 Main-proxied ModelGateway。

## 结果

- `pi-context-adapter.ts` 从 545 行降至约 451 行；消息投影 owner 约 112 行。
- 动态上下文状态与纯 Message 转换分离，均低于 500 行。
- checkpoint、预算、临时 in-run compaction、附件和 failure 行为保持不变。

## 验证

- Agent Runtime 与 Desktop typecheck；
- Pi Context、Model Gateway 与 Runtime tests；
- Desktop production context budget tests；
- Desktop production build 与 Renderer bundle 模块数。
