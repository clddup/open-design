# ADR-0146：显式 Run 参考图与 Design File 资产边界

状态：Accepted，取代 ADR-0118 中“全部 Run 图片必须分类”和“漏项拒绝”的决策。

## 背景

ADR-0118 曾要求有 raster 附件的 Run 把每张图片恰好分类一次。实际产品中，用户经常附加当前画布截图来指出间距、遮挡或流程错误；这类图片不是设计参考，也不是交付素材。Main 仍强制模型回抄所有 attachmentId，导致没有 `referenceStrategy` 时设计写入被拒绝，恢复时又容易从 Conversation 历史误用上一 Run 的临时 ID。结果是同一 Design File 的后续消息无法继续修改已经存在的设计。

该门禁混淆了两种所有权：Run 只拥有本次消息的临时附件授权，Design File 才拥有持久节点、图片资产和 revision。用户开始新消息不应失去对已授权目标 Design File 的编辑能力。

## 决策

- `referenceStrategy` 是可选的显式采用清单，不是全部附件清单。
- 未声明的当前 Run raster 附件默认 `ignore`，不阻塞 Plan 注册、首轮生成或后续设计写入；问题截图无需产生条目。
- Main 只校验显式声明的 attachmentId：必须属于当前 Run 且不得重复。历史 Run 或另一 Run 的临时 attachmentId 继续拒绝。
- `style-reference`、`composition-reference` 与 `brand-reference` 才进入独立 Critic，仍最多两张；`content-asset` 和显式 `ignore` 不进入 Critic。
- 已经导入当前 Design File 的图片属于文档资产。后续 Run 在 targetSet 授权同一 Design File/Page 后，通过 inspection 返回的稳定 `assetId` 读取、放置和修改，不把历史 attachmentId 写入 `referenceStrategy`。
- Conversation 历史可以保留附件内容作为只读上下文，但不把历史 attachmentId 变成新 Run 的临时能力。跨 Design File 仍需显式导入或 Library 能力。

## 后果

- 附一张问题截图不再让一次普通修改先经历 reference strategy 恢复往返。
- 后续 Conversation/Run 可以继续修改同一 Design File 已有节点和图片资产。
- 真正采用视觉参考时仍有结构化、可审计、Critic 可消费的策略；取消的是无价值的“全部回抄”，不是当前 Run 附件授权边界。
- `ignore` decision 保留为可选的显式说明，但省略与 ignore 具有相同的执行效果。

## 验证

- 新 Run 附问题截图但省略 `referenceStrategy`，可以注册 existing-artboard Plan 并产生材料 revision。
- 新 Run 声明上一 Run 的临时 attachmentId，Main 拒绝。
- 当前 Run 有多张图片时，只声明其中一张可以注册 Plan，Critic 只收到该 active reference。
- Design File-local 图片继续通过 stable assetId 的既有 inspection/place-image 路径跨 Run 使用。
