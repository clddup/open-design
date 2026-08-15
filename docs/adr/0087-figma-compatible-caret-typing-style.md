# ADR-0087：Figma-compatible Caret Typing Style

- 状态：Accepted
- 日期：2026-08-15
- DesignDocument：1.33.0（不变）
- Text Editing Session Service：contract v2

## 背景

ADR-0085 已把列表输入、结构键和一次编辑会话的一次 Runtime 提交收进短生命周期 Text Editing Session，但 Inspector 在 TextEditor 打开时仍只有两种不完整行为：非空选区会立即绕过 session 写 Runtime；折叠光标无法保存“接下来输入的字使用什么样式”。把折叠光标样式伪造为持久零长度 run 会污染文档、导出和 revision 语义，而每次输入后重建整个 `contenteditable` DOM 又会破坏浏览器原生输入、IME composition 和普通输入 undo 的连续性。

Figma Plugin API 的 `insertCharacters(start, characters, useStyle?)` 明确使用 JavaScript UTF-16 offset；默认或 `BEFORE` 继承前一字符，`AFTER` 继承后一字符，字符串边界继承最近字符。TextNode 同时允许整节点或字符范围拥有不同属性，并以 `figma.mixed` 表达混合值：

- <https://developers.figma.com/docs/plugins/api/properties/TextNode-insertcharacters/>
- <https://developers.figma.com/docs/plugins/working-with-text/>
- <https://developers.figma.com/docs/plugins/api/TextNode/>

## 决策

### Session v2 独占编辑中样式

Text Editing Session Service 升级为 contract v2。Session 在 exact document/revision/node 边界内同时持有 original/current character runs、paragraph runs、当前 UTF-16 selection 和可选 caret typing style：

- 非空 selection 的 character/paragraph 修改只写 session；Inspector 立即读取 session 的 style 与 mixed fields；
- 折叠 caret 的 character 修改只建立 `{ offset, style }` override，不产生零长度 run；
- 用户在该 offset 真正插入字符时，override 才物化到 inserted UTF-16 range，并随连续输入向后移动；
- 没有显式 override 时沿用 Figma `BEFORE` 规则：优先前一字符，字符串边界取最近字符；
- caret 移动清除 override；段落字段作用于 caret 所在段落或 selection 触及的完整段落；
- Escape、stale revision、锁定或投影身份变化丢弃整个 session 并恢复当前权威 projection。

Session 仍不进入 `DesignDocument`、save、history、Agent/MCP context 或 Leafer 私有序列化。

### Disposable edit-DOM marker

Adapter 仅在折叠 caret 存在 typing style 时插入带 `data-opendesign-typing-style` 的短生命周期 span，并用 `U+200B` 保持空样式容器。serializer 和 selection offset 归一化会移除 `U+200B`，它不进入 content、runs、transaction、revision、capture 或 export。

TextEditor 打开时可以从权威 runs 初始化一次 styled DOM；普通 input 和 composition 期间不得 `replaceChildren` 重建整棵 edit DOM。浏览器直接在 marker span 中输入并继承 CSS；caret 移动时 marker 被 seal 为普通样式 span，`U+200B` 被删除，已经物化的真实字符保留。非空 range 修改只在选区内切分/包裹必要 text nodes，不替换未触及 DOM。Inspector 获得焦点时可以继续修改 session，但 Adapter 不把 DOM selection 或焦点强制切回画布。

自动列表等明确结构 rewrite 仍可重写必要 DOM 并使用 ADR-0085 的专用立即 Undo；普通输入 undo 继续由浏览器编辑器负责，关闭 TextEditor 后由 OpenDesign history 负责。

### 一次正式提交

`commit_text_edit` 扩展 optional canonical character `runs`，与 final `content`、最小 `paragraphPatches` 在同一 EditorRuntime transaction 中校验、compact、reflow 和提交。关闭一次有效编辑只产生一个 revision、一个 undo step；只有 caret override 而没有真实输入时是零写入。纯 range 样式修改即使 content 未变化也必须提交 runs，不能被 no-op 门禁丢弃。

`commit_text_edit` 仍是人工 TextEditor 的内部 typed operation，不加入 Agent tool schema 或 MCP 写入口。Agent 继续使用已检查、非空 UTF-16 range 的 `update_text_range_style`。

## 后果与边界

用户可以在真实光标位置调整字体、字号、字重、字距、行高、大小写、装饰、fills 与受支持 Style ID，随后连续输入；未输入的光标样式不会污染文件。非空范围、段落字段、Escape、焦点切换、IME 与 undo 都经过同一 session 生命周期，不再形成 Renderer 侧第二份持久状态。

本切片不增加通用编辑会话内逐键 history、不实现高级 decoration 几何、OpenType/variable axes、text-on-path、字体打包或跨平台像素一致性。macOS/Windows 原生 IME、浏览器 undo 产品 smoke 和多字体缺失场景仍是发布级人工门禁，因此 rich typography capability 继续标记为 degraded。

## 验证

- pure session：collapsed override 零持久化、连续输入、caret move 清除、非空 range、段落 caret、UTF-16 与 bounded remap；
- Runtime：content + optional runs + paragraph patches 一次 revision/reflow/undo，纯 runs commit、no-op、stale 与非法 runs 零写入；
- Adapter：一次 styled DOM 初始化、typing marker 不进入 content/commit、连续输入 marker identity、selection move 清理、range 局部 DOM、composition 不重建、Inspector focus 保留、Escape 零 transaction；
- Renderer：editing selection/Mixed Inspector 读取 session，关闭前不发 range transaction，`commit_text_edit` 不出现在 Agent tool schema；
- 文档基线明确 DesignDocument 仍为 1.33.0，双平台原生输入法和视觉证据尚未完成。
