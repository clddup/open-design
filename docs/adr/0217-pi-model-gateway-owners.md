# ADR-0217：Pi Model Gateway 转换与 Stream Owner

## 状态

已接受。

## 背景

`pi-model-gateway-adapter.ts` 接近 800 行，同时定义 failure/context ports、Pi Message→canonical Message、ModelRequest、canonical stream→Pi stream 和所有 block/usage/API 转换。该文件既是 Provider 请求入口又是双向协议投影实现，导致消息附件规则、stream 状态机和失败边界无法独立审查。

## 决策

1. `pi-model-gateway-ports.ts` 唯一拥有 Adapter options、failure port 与 context projection port。
2. `pi-model-message-projection.ts` 唯一拥有 Pi user/assistant/tool-result Message、attachment reference 与 Tool schema 到 canonical wire 的投影。
3. `pi-model-stream-bridge.ts` 唯一拥有 canonical attempt/block/delta/completion/failure stream 到 Pi Assistant stream 的状态机、identity、usage 与 API 映射。
4. `pi-model-gateway-adapter.ts` 只创建请求、处理请求投影失败并启动 stream bridge；公共导入继续从原入口 re-export。
5. Main-proxied `ModelGateway` 仍是唯一 Provider 执行入口；该拆分不接触凭据、不增加 Provider adapter、兼容 fallback、版本或数量门禁。

## 结果

- 原 796 行入口拆为约 142/52/165/476 行的四个 owner，均低于 500 行。
- Pi inline image 禁止、attachment reference、tool schema、attempt identity、block 顺序、stream terminal、usage 与 failure port 行为保持不变。
- 请求投影和 stream 投影可以分别验证，不再通过聚合入口形成隐式 owner。

## 验证

- Agent Runtime 与 Desktop typecheck；
- Pi Model Gateway、Context Adapter 与 Runtime tests；
- Desktop production context budget tests；
- Desktop production build 与 Renderer bundle 模块数。
