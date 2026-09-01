# ADR-0262：Text Ending Truncation 精确投影与 Flatten

## 状态

接受。

## 背景

Text 节点的权威 `content` 必须保留完整文本，但 ending truncation 实际显示的是源文本前缀与省略号。若把显示 fragments 伪装成覆盖全文，会污染 UTF-16 范围、点击映射、质检和 Flatten；若直接截断已经 shaping 的 glyph，阿拉伯文等上下文相关文字还会沿用错误的连接形态。

## 决策

1. Text Run Layout contract 6 在成功结果中明确返回 `displayContent`、`sourceContentEnd`、`truncated` 与 `fullContentBounds`；`contentBounds` 只表示实际显示内容，权威 `request.content` 不改变。
2. Provider 先布局完整内容，再从真实 cluster ends 中选择可显示的最大 UTF-16 前缀，并对 `prefix + "..."` 重新 shaping。不得裁切旧 glyph 或按字符数、字号估算。
3. `maxLines` 与 Fixed box 的宽高共同决定可见范围；Fixed 且未显式设置 `maxLines` 时，以 Provider 的真实行几何推导可见行数。无法精确容纳省略号时返回受控 `unsupported`。
4. 显示串重新构造连续合法的 character runs 与 paragraph runs。synthetic ellipsis 只存在于可丢弃投影，点击范围映射到 `sourceContentEnd`，不进入文档、history 或保存。
5. Layout Quality 使用 `fullContentBounds` 判断全文溢出，使用 `contentBounds` 判断实际显示；两份证据不得混用。
6. EditorRuntime Flatten 只物化 Provider 返回的显示 glyph 与 decoration，仍通过现有 `flatten` action 形成一个 editable Vector、一次 revision/undo，不增加专用 Agent 工具。
7. 原 Text 和 Flatten 结果都属于 Design File，不属于创建它的 Run。失败只终结当前 Run；同一 Conversation 的后续消息仍可继续读取附件、当前 revision 并修改既有设计。

## 结果

- Auto Height + `maxLines` 与 Fixed box ending truncation 可在生产投影、质检和 Flatten 中共享同一精确事实。
- 权威全文、显示内容和 UTF-16 source mapping 不再互相冒充。
- 系统字体 exact outline、高级 decoration 字段、Unicode 13 之后 bidi 数据与真实 macOS/Windows 像素基线仍是后续切片。

## 验证

- Contract：拒绝非法 display identity、越界或非 UTF-16 边界的 `sourceContentEnd`，并验证 fragments/lines/glyph clusters 只覆盖显示串。
- Provider：真实字体覆盖 ending truncation 的重新 shaping、全文/显示 bounds 与单行限制；Leafer provider 覆盖 Auto Height `maxLines` 和 Fixed 高度推导。
- Projection/Quality：synthetic ellipsis 可清理、点击映射不越过源前缀，全文/显示尺寸分别进入质量证据。
- Runtime：Flatten 只生成实际显示 glyph，对权威全文不做突变，并保持单事务替换。
