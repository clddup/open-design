# ADR-0174：Canonical Model Wire 单一契约

## 状态

已接受。

## 背景

Agent utility process 通过 Parent Model Gateway 向 Main 提交 canonical messages、工具定义和 Provider selection，Main 再把 canonical stream events 返回 utility process。`@opendesign/model-gateway` 过去只拥有 TypeScript 类型，Desktop `model-bridge.ts` 另外维护约三百行 `record/safeId/safeText/switch/exact-key` Runtime 判断。

这导致生产事件类型与跨进程验证并非同一事实源。新增 reconnect、reasoning summary、provider failure、usage 或 attachment 字段时，模型网关可以正常产生事件，而 bridge 仍可能返回 `Agent returned an invalid event`；错误只能归结为泛化字符串，无法定位真实 discriminant/field。

## 决策

1. `@opendesign/model-gateway` 是 canonical model wire 的结构 owner，直接导出并由 Static 类型消费：
   - Model Selection、Resolved Identity、Usage、Timeout 与 Error Schema；
   - Text/Reasoning/Tool-call Block Schema；
   - User/Assistant/Tool Message 与 content-addressed reference Schema；
   - Canonical Tool 与 serializable Model Request Schema；
   - 八类 Canonical Stream Event discriminated union Schema。
2. `ModelRequest` 在 canonical wire request 上增加不可序列化 `AbortSignal`；signal 不进入 schema、IPC 或 journal。Main 物化后的 inline image 仍属于 gateway 内部 canonical content，Agent utility 的 bridge refinement 明确拒绝 inline bytes并要求 content-addressed `image_ref`。
3. Desktop `model-bridge.ts` 只组合三个 envelope Contract：Request、Cancel、Response。旧 message/block/event/model/usage/timeout/selection 手写判断全部删除。
4. Schema 负责 envelope、required、unknown field、discriminant、ID、文本、数组、attachment byte range、event retry/timeout 和 usage shape；Contract refinement 只负责：
   - 工具集合与单 schema 的 JSON 字节预算；
   - Tool message content、tool-call input 的 JSON 字节预算；
   - Agent utility 禁止 inline image；
   - image/document reference MIME family。
5. Request/Response correlation ID 使用同一窄 identity Contract；validation error 统一由 `formatValidationFailure()` 返回稳定 code/path，不再维护按分支拼接的字符串错误。
6. Canonical event object、nested identity/error/usage 和 bridge envelope 均拒绝未知字段，防止凭据、路径或 Provider 私有状态跨进程泄漏。
7. `@opendesign/model-gateway` 新增固定 `@sinclair/typebox 0.34.52` 直接依赖并更新第三方声明；不引入第二个 schema runtime。
8. 不改变 Provider adapter、Pi loop、request correlation、超时/重连、取消、凭据、attachment materialization 或模型工具执行语义。

## 结果

- canonical 类型、Runtime Schema 与 Model Bridge 使用同一事实源。
- `attempt.started/retrying/recovered`、block lifecycle、completion 和 structured failure 不再依赖 Desktop 手写 switch 同步。
- 畸形事件返回准确 schema code/path，utility process 仍生成可关联的 `model_bridge_invalid_response` 终态。
- 单一契约迁移继续处理其余 Main/Preload IPC、Provider 设置、Agent Event 与持久化协议。

## 验证

- Model Gateway 测试覆盖全部八类 stream event、unknown field、message/tool/request union。
- Desktop Model Bridge 测试覆盖 correlation/cancel、latency profile、failure/reconnect、completed tool block、image/document reference、inline image 拒绝、MIME family、完整生产工具目录和聚合预算。
- Parent Model Gateway 与 Main Model Provider Host 测试证明跨进程事件和失败终态不变。
- Model Gateway/Desktop typecheck、定向 ESLint、Prettier、tests 与 production build 通过。
