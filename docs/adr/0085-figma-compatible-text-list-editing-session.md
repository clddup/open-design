# ADR-0085：Figma-compatible Text List Editing Session

- 状态：Accepted
- 日期：2026-08-15
- DesignDocument：1.33.0（不变）
- Text Editing Session Service：contract v1

## 背景

`DesignDocument 1.33.0` 已把 ordered/unordered、五级 indentation、list spacing 与 hanging marker 建模为权威段落事实，并贯通 Runtime、Inspector、Agent、Leafer/HarfBuzz、Figma、SVG 和 raster。然而 Leafer TextEditor 只在关闭编辑时提交完整 content；Tab 会离开编辑器，Backspace/Enter 只修改字符，`- `、`* `、`1. `、`1) ` 仍会成为正文。协议“能表达列表”不等于用户能像专业设计工具一样自然编辑列表。

Figma 当前公开行为是：

- `- ` / `* ` 自动建立 unordered list，`1. ` / `1) ` 自动建立 ordered list；
- `Command/Ctrl + Shift + 7/8` 切换 ordered/unordered；
- Tab、Command/Ctrl + `]` 增加层级，Shift+Tab、Command/Ctrl + `[` 减少层级，最多五级；
- 在列表项开头按 Backspace/Delete 会移除 counter 但保留 indentation；
- 在空列表项按 Enter 会逐级减少 indentation，一级时退出列表；
- 自动建立列表后立即 Undo 会恢复输入的创建字符并取消自动样式。

依据：

- <https://help.figma.com/hc/en-us/articles/360040449773-Create-bulleted-and-numbered-lists>
- <https://developers.figma.com/docs/plugins/api/TextNode/>
- <https://developers.figma.com/docs/plugins/api/TextListOptions/>

## 决策

### 短生命周期编辑状态

新增纯函数 `Text Editing Session Service v1`。它只持有一次 TextEditor 打开期间的 exact document/revision/node、当前 UTF-16 content、规范化 paragraph styles、零长度末尾段落 typing style，以及最近一次自动列表转换的可撤销快照。该状态不进入 `DesignDocument`、save、history、MCP、Agent context 或 Leafer 私有序列化；权威事实仍只有 EditorRuntime 当前 revision。

DOM selection 只在 Adapter 边界转换为 UTF-16 `[start,end)`。任何跨 surrogate、越界、非当前 edit root、IME composition 中的自动转换或 stale document/revision 均关闭失败。Renderer 不直接写文档，也不从 DOM 推导第二份持久事实。

普通输入每次只更新短生命周期会话并复用既有 bounded diff remap。Enter 创建的新段落继承当前 list facts；末尾零长度段落可以在本次编辑中携带 typing style，只有出现真实 content 后才成为 paragraph run。关闭一个仍为空的末尾段落不会伪造零长度文档 run。

### 列表键盘语义

Adapter 在 TextEditor 的真实 edit root 上处理：

- 非 composition 的 Space input 命中四种创建前缀时，删除前缀正文并在 session 中启用 level 1 list；
- 自动转换后的首次 Undo 恢复前缀和转换前 paragraph style；后续输入会使该专用 undo 快照失效并回到浏览器普通 undo；
- Tab/Shift+Tab 与 bracket shortcuts 只在 active list paragraph 中拦截，逐段 clamp 到 1..5；
- Backspace/Delete 只在 collapsed caret 位于 item body start 时移除 marker，保留 indentation；
- Enter 只在当前 item body 为空时拦截，level > 1 时减一级，level 1 时变 none/level 0；非空 Enter 继续由 TextEditor 插入换行并继承列表事实；
- `Command/Ctrl + Shift + 7/8` 对当前 item 或完整 selection 触及的段落切换列表类型。

所有规则由 Text Editing Session Service 计算；Adapter 只负责键盘/DOM/caret 翻译和即时 rewrite。输入法 compositionstart～compositionend 期间不运行自动列表或结构键盘命令。

### 一次 Runtime 提交

新增非 Agent 暴露的 typed `commit_text_edit` DesignOperation。它携带 final content 与相对 Runtime 默认 bounded-remap 的最小 paragraph patches。Runtime 在同一 transaction draft 中：

1. 校验 Text、锁定、UTF-16 范围和 patch；
2. remap character/paragraph runs 到 final content；
3. 应用全部 paragraph patches；
4. 只执行一次 Auto Size/Auto Layout reflow；
5. 产生一个 revision、一个 undo step 和一份 change set。

这避免把一次编辑会话拆为 content update + N 次重复 layout，也避免 Renderer 直接替换 runs。无 content/style 变化明确返回 no-op；事务失败恢复 exact-revision projection，成功后等待新 revision 再恢复 disposable fragments/markers。

## 后果与边界

用户可在真实 TextEditor 中以 Figma 习惯创建、缩进、退出和撤销语义列表；marker 仍不写入 content。普通文本编辑继续保持关闭编辑器时一次 revision，不新增逐键文档事务、模型调用或固定延时。

本切片不持久化通用 caret typing style，不支持 rich character style 的空段落延续、自定义 marker/start number/reversed list，也不取代完整文本编辑 undo stack。自动列表专用 Undo 只保证紧接转换的一次恢复；其余 DOM 输入 undo 仍由浏览器编辑器负责，关闭后由 OpenDesign transaction undo 负责。列表 marker 在 edit DOM 内的富视觉投影、IME 双平台产品 smoke 和跨平台像素基线仍是后续门禁。

## 验证

- pure session：四种 shortcut、immediate undo、UTF-16、Enter 继承、Tab/Shift+Tab、五级 clamp、selection、多段 toggle、marker removal、空 item exit；
- Runtime：content + patches 一次 revision/undo/reopen，只测量一次，stale/locked/no-op/非法 range 零写入；
- Adapter：真实 edit root input/selection、composition guard、DOM rewrite/caret restore、keyboard prevention、关闭 commit、Escape restore、Page/revision change cleanup；
- Renderer：唯一 `onOperations` 入口、错误恢复、Inspector selection 不被 synthetic marker 污染；
- 文档/能力基线明确 DesignDocument 仍为 1.33.0，不能把通用 caret typing style 或双平台实机证据写成已完成。
