# ADR-0228：Model Gateway Owner Boundaries

## 状态

已接受。

## 背景

`@opendesign/model-gateway` 的根 `index.ts` 同时拥有 canonical wire schema、Runtime ports、响应聚合、Pi request/context 投影、Pi stream event 投影、真实多协议 Provider 和 Mock Provider。公共入口超过一千行，协议变化、Provider 适配和测试 fixture 互相影响，根入口也不再是稳定 facade。

## 决策

1. `canonical-wire.ts` 唯一拥有 Usage/Error、Message/Block/Tool、Serializable Request 与 Stream Event schemas/types。
2. `model-gateway-ports.ts` 只定义 `ModelRequest`、`ModelGateway`、`CredentialHost` 与 Main 解析后的 Provider 配置。
3. `pi-context-projection.ts` 只把 canonical request 投影为 Pi Model/Context；`pi-stream-projection.ts` 只把 Pi event/error 投影为 canonical event。
4. `multi-protocol-model-gateway.ts` 只组合三种固定 Pi API adapter、凭据 header 和 stream lifecycle；`mock-model-gateway.ts` 独立拥有确定性测试 Provider。
5. `model-response-accumulator.ts` 独立聚合 exact attempt 的 terminal response。
6. 根 `index.ts` 只 re-export 原有公共 API，不新增 deep-import 要求或兼容 facade。测试按 Provider、wire、response 与 config owner 拆分，共享 fixture 只构造请求和受控响应。

## 结果

- 根入口从 1019 行收缩为 22 行，生产与测试 owner 均低于项目 500 行边界。
- canonical schema 对象与公共导出保持不变，Desktop/Agent 消费者继续从 package 根入口导入。
- Provider 协议选择、认证、reasoning、附件、retryability、stream event 和 response accumulation 行为不变。
- 没有新增第二套 Model Gateway、兼容 fallback、源码数量或内容 hash 门禁。

## 验证

- Model Gateway typecheck 与完整 owner tests；
- Agent Runtime Pi Model Gateway/Context 回归；
- Desktop Model Provider Host/Stream 回归；
- Agent Runtime/Desktop typecheck 与 Desktop production build。
