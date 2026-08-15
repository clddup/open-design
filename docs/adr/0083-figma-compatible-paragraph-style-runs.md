# ADR-0083：Figma-compatible paragraph style runs

- 状态：Accepted
- 日期：2026-08-15
- 文档协议：`DesignDocument 1.32.0`
- Text Paragraph Service：contract v1
- Text Run Layout Service：contract v3

## 背景

`DesignDocument 1.31.0` 已建立 UTF-16 character runs、真实 DOM range selection、唯一 Runtime 事务，以及 native/HarfBuzz 的 exact-revision 投影，但 `paragraphIndent` 与 `paragraphSpacing` 仍只能作用于整个 Text 节点。Figma Plugin API 把二者定义为可通过 `[start,end)` range getter/setter 修改的 per-paragraph 字段，并把它们包含在 `getStyledTextSegments()` 结果中。直接把字段追加到 character run 会允许同一段落内部出现互相冲突的段落值，也会在删除换行后留下不确定状态。

## 决策

### 文档事实

Text 新增规范化 `paragraphRuns`，每项只保存 `paragraphIndent` 与 `paragraphSpacing`。`[]` 表示全部段落使用节点 base 值；非空 runs 必须有序、完整覆盖 content、只在 LF、CRLF 或 CR 段落边界开始和结束，相邻同样式合并。character `runs` 与 `paragraphRuns` 分离存储，但 inspection/Figma adapter 可按二者边界交集生成统一 styled segments。

`update_text_range_style` 继续是唯一范围样式事务：character 字段严格应用于原 `[start,end)`，paragraph 字段扩展到该范围触及的完整段落，两部分在同一 revision 原子提交。直接内容编辑继续使用 bounded diff；插入换行继承所在段落，删除换行后由合并结果首段样式决定新段落，行为确定且可重放。`update_properties` 不允许直接替换任一 run 集合。

### 布局与产品表面

Text Run Layout contract v3 接收 paragraph runs。Leafer native 与 HarfBuzz provider 都在换行、首行缩进、换行宽度、段后间距、Auto Width/Auto Height 和 Fixed 布局中读取当前段落样式；paragraph-only 文本同样进入 disposable rich projection。Inspector 的真实 selection 显示 Mixed，并把 Indent/Paragraph spacing 路由到同一 range transaction。Agent 的 deferred `opendesign_style_text_range` 复用同一小型 schema，不增加 bootstrap 工具负担。

Figma adapter 在 character/paragraph 边界交集处生成 styled segments，导入时要求同一段落的 paragraph 字段一致。SVG metadata v7 保存两类 runs，并在标准 `<tspan>` 上输出 UTF-16 range、paragraph indent/spacing 与显式段落定位证据；继续读取 v6/v5/v4/v3/v2/v1。raster capture/export 消费同一生产投影，派生 fragments/glyphs 不进入文档、history 或作者 SVG 数据。

## 后果与边界

该切片只完成有字符证据的逐段 indent/spacing。末尾零长度空段落没有 UTF-16 range，继续使用 base style；caret typing style 需要后续 editor-session 语义，不能伪造持久 run。Figma 的 ordered/unordered/none list options、indentation level、list spacing 与 hanging list 需要 marker shaping、计数、RTL 和 wrapped-line 几何，将在下一独立协议切片实现，不能用文本前缀冒充。高级 decoration、OpenType features、variable axes、text-on-path、字体随文件迁移、新版 bidi 与双平台像素证据仍保持门禁。

## 验证

- `1.31.0 → 1.32.0` 迁移、段落边界、LF/CRLF/CR、range 扩展、split/merge remap、锁定/no-op、undo/save/reopen。
- Leafer 与 HarfBuzz 的逐段首行缩进、段后间距、wrap 与 Auto Size。
- Inspector/Agent 共用 transaction、Figma styled segments、SVG metadata v7/tspan 往返与篡改拒绝。

## 参考

- [Figma TextNode Plugin API](https://developers.figma.com/docs/plugins/api/TextNode/)
- [Figma getStyledTextSegments](https://developers.figma.com/docs/plugins/api/properties/TextNode-getstyledtextsegments/)
- [Figma Plugin API Update 105](https://developers.figma.com/docs/plugins/updates/2024/12/13/version-1-update-105/)
