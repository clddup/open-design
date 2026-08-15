# ADR-0084：Figma-compatible Text Lists

- 状态：Accepted
- 日期：2026-08-15
- DesignDocument：1.33.0
- Text Paragraph Service：contract v2
- Text List Service：contract v1
- Text Run Layout Service：contract v4

## 背景

`DesignDocument 1.32.0` 已把字符 runs 与段落 runs 分离，并让段落缩进/间距贯通 Runtime、Inspector、Agent、Leafer/HarfBuzz、Figma、SVG 和 raster。但列表仍只能由用户或模型在正文前手写 `1.`、`•`，这会污染作者 content、破坏重编号与嵌套语义，也无法表达 hanging marker、列表间距和 RTL。

Figma Plugin API 把 `listOptions`、`indentation` 与 `listSpacing` 暴露为 UTF-16 range/styled-segment 字段；`hangingList` 是 Text/TextStyle 的节点级属性。Figma Design 支持 ordered/unordered/none、最多五级 indentation、有序 marker 在数字/字母/罗马数字间轮换、像素 list spacing，以及把 marker 移出文本框的 hanging 模式。依据：

- <https://developers.figma.com/docs/plugins/api/TextNode/>
- <https://developers.figma.com/docs/plugins/api/TextListOptions/>
- <https://developers.figma.com/docs/plugins/api/properties/TextNode-getstyledtextsegments/>
- <https://help.figma.com/hc/en-us/articles/360040449773-Create-bulleted-and-numbered-lists>

## 决策

### 文档事实

Text 节点新增 required `listSpacing` 与 `hangingList`。Text Style 同步保存这两个 Figma-supported 字段。`paragraphRuns.style` 扩展为：

- `listOptions.type: none | ordered | unordered`
- `indentation: 0..5`
- `listSpacing >= 0`
- 既有 `paragraphIndent`、`paragraphSpacing`

活动列表必须使用 1..5 级；普通段落可以保留 0..5 indentation，以支持移除 marker 后仍保留缩进层级。`[]` 继续表示全部段落使用 base paragraph style：none、level 0、节点 base list spacing。`1.32.0 → 1.33.0` 迁移补 `listSpacing:0`、`hangingList:false`，并把既有 paragraph runs 补成明确 non-list，不改变内容与几何。

`update_text_range_style` 仍是唯一范围写入口。列表字段扩展到 selection 触及的完整段落，与 character 字段在同一 revision 原子提交。把 none 改为 ordered/unordered 且未显式给 indentation 时，level 0 确定升级为 level 1；显式无效层级失败。直接 content 编辑继续使用 bounded diff：插入换行继承所在列表项，删除换行由合并后首段决定列表事实。`update_properties` 不允许直接替换 runs；节点 base list spacing 更新会同步现有 paragraph runs，hangingList 保持节点级。

### Counter 与排版

Text List Service 从 paragraph facts 派生 marker，不修改 `content`：

- unordered 使用不可定制 `•`；
- ordered level 1/4 使用 decimal，level 2/5 使用 lower-alpha，level 3 使用 lower-roman；
- 同一连续 list block 内按层级维护 counter，进入 plain paragraph 后重置；nested item 不重置父级 counter；
- marker 样式取该段落首个 character style。

Text Run Layout v4 返回独立、受预算约束的 `markers`。正文 fragments 仍一对一覆盖原 UTF-16 content；marker 使用自己的短字符串/glyph cluster，不能冒充 source range。每个 list block/level 计算稳定 marker column、gap 与 indentation step；wrapped lines 对齐正文 body，不回到 marker 左侧。list item 相邻时 previous `listSpacing` 作为 item gap，否则使用 previous `paragraphSpacing`。hanging 模式保留正文 box/Auto Size 宽度并允许 marker 进入负 x（RTL 为 box 右侧）；`contentBounds` 包含真实可见 marker。

Leafer provider 测量 native marker Text；HarfBuzz provider 用同一已导入 face 真实 shape marker glyph path，并按 bidi paragraph level 把 marker 放在 logical start edge。生产 projection 把 marker 作为 disposable Text/Path sibling，命中、selection 和 text edit 全部映射回唯一权威 Text proxy；marker 不进入 document、history 或 save。

### 产品表面与互操作

Typography Inspector 在现有紧凑 grid 中提供 List style、level、list spacing 和 Hanging marker。存在 DOM text range 时作用于触及段落；普通选中 Text 时作用于完整非空 content。Mixed 状态来自真实 paragraph runs。所有操作复用 EditorRuntime transaction、revision、undo、冲突与错误恢复。

Agent deferred range tool 暴露相同字段，并明确禁止把 marker 写进 content。普通 Text insert 需要 node-level listSpacing/hangingList；列表 type/level 必须在内容存在后通过 range transaction 写入。

Figma adapter 在 character/paragraph 边界交集处双向转换 `TextListOptions`、indentation 和 list spacing；同一段落冲突稳定失败。Text Style payload 增加 listSpacing/hangingList。为避免复制并逐渐分叉 UTF-16 段落边界算法，隔离的 `@opendesign/figma-interop` 在既有 Component Service 与 Design Contracts 依赖之外，新增对纯函数 `@opendesign/text-service` 的单向生产依赖；核心 Runtime、Renderer、Leafer 和 Contracts 仍不反向依赖 Figma adapter，workspace 依赖继续保持无环。

SVG text metadata 升级为 v8，继续读取 v7/v6/v5/v4/v3/v2/v1。v8 保存完整列表事实，在标准 `<tspan>` 中输出可见 marker、list type/level/spacing、方向和位置证据；导入同时校验 metadata、正文 tspan 与 marker 文本/几何，任何篡改失败。raster capture/export 继续消费 exact-revision 生产 projection。

## 后果与边界

列表不再依赖伪字符，重编号、嵌套、wrap、RTL、hanging、Figma/SVG 往返和 undo/save 都有统一事实。普通无列表 Text 的 paragraphRuns 仍为空，不会因为新增字段进入 rich projection，也不会增加设计生成的模型往返。

当前 marker 采用 Figma 的固定 bullet 和五级 counter cycle，不提供自定义 marker、start number、reversed list 或跨 Text 节点续号。TextEditor 的 Tab/Shift+Tab、`1. ` / `- ` 自动识别、空列表项 Enter 退出，以及末尾零长度段落 typing style 需要后续 editor-session/caret 协议；不能通过修改 content 或猜测 caret 持久状态实现。Unicode bidi 数据仍是 13.0.0，双平台打包像素基线仍保持门禁。

## 验证

- 1.32 migration、严格 current schema、Text Style migration；
- paragraph range expansion、split/merge inheritance、active level validation、counter reset/nesting/five-level cycle；
- Runtime transaction、no-op/failure、Text Style detach、undo/redo/save/reopen；
- Leafer native marker、stable column、word wrap、list spacing、hanging negative x；
- HarfBuzz marker glyph path、RTL logical-start geometry与 exact content coverage；
- projection proxy/hit/edit cleanup、capture/raster exact revision；
- Inspector whole-node/range/Mixed、Agent typed schema与作用域；
- Figma styled segments/Text Style、SVG metadata v8/v7..v1、marker tamper rejection。
