# ADR-0187：Agent Request IPC 结果契约

## 状态

接受。

## 决策

Renderer → Main 的合法 `AgentRequest` 不再依赖 Electron 丢失字段的异常文本表达业务拒绝。Main 对通过结构校验的请求统一返回 `AgentRequestResult`：成功为 `{ ok: true }`，失败为 `{ ok: false, error: { code, message } }`；当前稳定 code 为 `conversation_busy`、`preflight_stale` 与 `request_rejected`。

`AgentRequestResultContract` 是 Main、Preload 与 Renderer 的唯一 wire owner。Preload 对返回值只解析一次；Renderer 根据稳定 code 选择本地化提示，不解析 message。发送方身份、请求结构或参数数量等 IPC 边界错误继续抛出并失败关闭，不能伪装成合法业务结果。

同一 Conversation 的第二个显式 Run 由 Main 返回 `conversation_busy`，不能进入 utility-process session lock 静默排队。宿主预检后发现 Design File revision 已推进时返回 `preflight_stale`，不把陈旧上下文发给 Agent。

## 后果

- 被拒绝的 optimistic user message 会被移除，Composer 保留原输入。
- Main-owned Global Task 继续作为 Renderer 活动 Run 状态的兜底。
- 后续 Agent request admission 错误必须扩展同一枚举与契约，不得新增 message substring 分类。

## 验证

- Contract 拒绝缺少 code、未知 code 和额外字段。
- Main IPC 覆盖成功、一般拒绝和结构化 admission failure。
- Renderer 覆盖 transport failure、`conversation_busy` 本地化、输入保留与 optimistic message 回滚。
- Run starter 覆盖预检后 revision 二次核对，同 Conversation 排他与 terminal 后重新发送。
