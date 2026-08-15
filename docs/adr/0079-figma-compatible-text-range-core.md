# ADR-0079：Figma-compatible 文字范围核心与原生投影边界

- 状态：Accepted
- 日期：2026-08-15
- 文档协议：不变（`DesignDocument 1.30.0`）
- Text Layout Service：contract v4（不变）
- Text Range Service：contract v1
- Text Run Layout Service：contract v1
- 关联：ADR-0036、ADR-0070、ADR-0074、ADR-0076、ADR-0077
- 基线：Figma Plugin API `TextNode` / `getStyledTextSegments`

## 背景

Figma 的 `TextNode` 允许整节点或 character range 拥有字体、字号、Fill、大小写、装饰、字距、行高、Text Style、列表和段落等属性；range 使用 JavaScript 字符串的 `[start, end)` 索引。OpenDesign 当前 `DesignDocument 1.30.0` 只保存单一样式，Leafer 2.2.9 的原生 `Text` 也只接受整段样式。只给文档增加 `runs` 字段会形成“可保存、不可真实显示或编辑”的假能力，因此在升级文档协议前必须先建立范围语义与可行的原生画布投影边界。

固定 Leafer 2.2.9 还带有 `HTMLText`，但它不是专业富文本内核：实现会把 `text` 写入隐藏 DOM 的 `innerHTML`，测量后拼装 SVG `foreignObject`，再作为 Image paint 绘制；`TextEditor` 对它同样直接读写 `innerHTML`。这条路径会引入不可信 HTML、浏览器 DOM shaping、image-like 投影、矢量导出和跨平台确定性问题，不能成为 OpenDesign 的权威 rich-text 渲染或编辑实现。

## 决策

### UTF-16 `[start, end)` 是唯一范围坐标

`@opendesign/text-service` 增加独立 Text Range Service contract v1：

- offset 按 JavaScript UTF-16 code unit 计数，与 Figma range API 对齐；
- start inclusive、end exclusive；
- 非空 runs 必须按顺序、无重叠、无空段并完整覆盖 content；
- 合法 range boundary 不得切开一个有效 surrogate pair；
- 相邻且完整样式相同的 runs 规范化为一个 run；
- 空 content 不保留 runs；无 runs 表示整段使用节点 base style。

Figma Plugin API 的 `getStyledTextSegments` 在调用者显式把查询边界放进 surrogate pair 时会返回原始半个 code unit。OpenDesign 的持久化与编辑契约不需要复制这一读取容错：范围仍使用相同 UTF-16 坐标，但作者态边界必须落在完整 code point 上，避免保存不可编辑的破碎 Unicode。该严格子集必须在 Figma adapter 中显式报告，不能把“同一索引单位”误写成所有异常切片行为完全相同。

服务保持 style 泛型，不依赖 `DesignDocument` 或 Paint schema。后续文档协议负责定义受支持的完整 `TextRunStyle`，范围算法、直接编辑、导入器和画布投影共同复用这一基础，不各写一套索引逻辑。

### 直接编辑用一个有界 diff 重映 runs

普通文字直接编辑仍提交完整 content，但 Range Service 会从旧/新字符串计算最长公共前后缀，得到一个有界 replace edit，并确定性重映 runs：

- replacement 继承被替换范围首字符的样式；
- 纯插入默认继承前一字符，可显式选择 after；
- 删除裁剪相交 runs，后续 ranges 按 UTF-16 delta 平移；
- 结果再次做完整覆盖、surrogate boundary 与相邻合并校验。

这只是文本内容编辑的样式保留语义。未来富文本编辑器的显式 range-style 操作仍需独立 typed command，不能把 DOM selection 或 HTML 当文档事实。

### 正式画布必须保持原生结构化文字

后续 rich-text 投影只能使用 Leafer 原生 `Text`/受控几何的 synthetic fragment，或经过独立 shaping provider 产出的等价结构；synthetic 元素必须回映原始 Text ID，selection bounds、hit test、直接编辑代理、capture/export 和 revision 仍以一个权威 OpenDesign Text 节点为中心。provider 派生 fragment 不进入 `DesignDocument`、history 或 save。

在 run-aware wrapping、baseline/line-height、selection/hit 回映和直接编辑代理全部通过前：

- 不升级 `DesignDocument`；
- 不向 Inspector、Agent、Figma/SVG import/export 暴露 runs；
- capability manifest 继续把 per-range rich text 标为 unavailable；
- 不采用 `HTMLText` fallback、双写或 rasterized rich text 冒充完成。

### mixed run 先经过可替换布局 provider

`@opendesign/text-service` 增加独立 Text Run Layout Service contract v1，但不改变 `DesignDocument`。请求携带完整 UTF-16 runs、base style、Auto Width / Auto Height / Fixed、word/character wrapping、段落缩进/间距与水平/垂直对齐；成功结果必须返回完整覆盖原文的 line/fragment ranges、局部几何、每行 baseline、内容 bounds、具体 size、provider identity 和有界字体 warning。无效范围、尺寸、provider identity、几何或原文不一致都明确失败。

固定 Leafer 2.2.9 provider 在 adapter 内读取其原生 `Text` 的 row width、`__baseLine` 与 `__lineHeight`，按保守 grapheme cluster 测量 advance；同一视觉行取最大 ascent/descent，mixed face/size fragment 通过局部 y offset 共享一条 baseline。word wrapping 对空白、连字符、CJK 与中西文标点采用固定规则；Auto Width 保持显式换行，Auto Height 计算实际高度，Fixed 保留作者尺寸并只计算内容位置。Fill 作为 concrete provider style 跟随 fragment，最终仍投影为原生 Leafer `Text`，不进入文档事实。

该 provider 不用字符数估算或 DOM fallback。范围切开 grapheme、range-local title case，以及 Arabic/Hebrew/Indic/Thai/Khmer 等需要上下文 shaping 而当前 Leafer fragment 测量无法证明的脚本返回 `unsupported`；缺少原生 row/baseline 指标返回可重试 `measurement-failed`。这保留未来 HarfBuzz/CoreText/DirectWrite 等专业 shaping provider 的替换边界，也避免把当前 Latin/CJK spike 冒充完整跨平台排版。

### synthetic fragments 只参与绘制，不取得节点身份

Text run projection 现在携带精确 `documentId + revision + pageId`；错误文档、过期 revision 或错误 Page 在进入 Leafer scene 前拒绝。初始 full projection 不会把普通 sibling 从 scene 中漏掉，incremental projection 在 resolution 消失时会删除旧 fragments，并恢复原 Text 与父级 sibling 顺序。

Leafer 2.2.9 的 selector 会跳过 `editable:false` leaf，因此 synthetic fragment 使用 `editable:"single"` 仅作为单击 hit facade：它可进入 pointer selector，但不会参加 box/multi selection。Editor 选中任何 fragment 后，Adapter 使用统一 projection metadata 立即把 `editor.list` 规范化为原始 Text element，再向 Renderer 上送唯一原 Text ID。selection bounds、move/resize target 与直接编辑入口因此都围绕一个权威节点；fragment ID 不会进入 Renderer selection、事务、history 或 save。

双击 fragment 时，Leafer `beforeEditInner` 会拒绝在 synthetic Text 上打开编辑器，并在同一 microtask 把 inner editor 重定向到原 Text proxy。编辑期间 proxy 恢复原生完整 Text 外观和完整 content，全部 fragments 暂时隐藏且不可命中；Escape、无变化、拒绝提交会恢复当前 projection。成功提交仍只产生原 Text 的 `update_properties`，在新权威 revision 到达前暂时保留编辑后的 proxy，随后再恢复新 resolution 的 mixed fragments，避免闪回旧文字。锁定 Text、切页、projection 变化、revision 失效与 dispose 都清理短生命周期编辑状态。

## 后果与后续门禁

Range Service v1 已提供 Figma-compatible 索引、规范化和直接编辑重映基础。Text Run Layout Service v1 与固定 Leafer provider 已验证 mixed face/size/fill、跨 run wrapping、grapheme 保守边界、每行 baseline、Auto Width / Auto Height / Fixed、段落几何、原生字体 warning 与失败拒绝。Leafer 结构 spike 保留一个稳定原 Text 作为透明可命中的 edit proxy，并把完整覆盖的 provider fragments 投影为同父级原生 Text：局部偏移与原 transform 正确合成，sibling 顺序稳定，synthetic metadata 回映原 Text/range，派生元素不进入文档。

用户仍不能创建或查看 rich-text runs；synthetic child 实际 hit → original selection 与直接编辑 proxy 开关现已进入真实 Adapter 事件链。下一切片继续完成 capture/export，并为当前明确拒绝的复杂脚本接入专业 shaping provider。上述输出和 shaping 边界通过后，才共同升级 `DesignDocument`、EditorRuntime、Inspector、Agent、Figma/SVG 和 capability manifest。

首版 `TextRunStyle` 只应纳入能够真实渲染、编辑和往返的字段。Figma 的列表、OpenType、hyperlink、variables 和段落范围属性继续分阶段实现，不能因为官方 API 存在就提前写入不可执行 schema。

## 验证

- UTF-16 emoji range 使用 `[1,3)`，拒绝位于 surrogate pair 中间的 boundary。
- 非空 runs 必须完整连续覆盖 content；空 content 只能有空 runs。
- base style materialization 与相邻同样式合并。
- boundary 插入的 before/after 样式继承。
- 跨多个 run 删除、平移和两侧同样式合并。
- emoji replacement 的 bounded diff 与后续 styled suffix 保留。
- 原 Text edit proxy、原生 synthetic Text fragment、transform 合成、parent/root 顺序、原 ID/range metadata 与非法 provider output 拒绝。
- Text Run Layout contract 的 Auto Width / Auto Height / Fixed 约束、完整 line/fragment coverage、provider identity、结构预算与原文一致性。
- mixed face/size/fill 的 native row width、同线 baseline、跨 run character/word/CJK wrapping、显式换行、段落间距、缺失字体 warning 与固定尺寸垂直对齐。
- UTF-16 emoji 与 ZWJ grapheme 不拆分；grapheme 内 style boundary、range-local title case、上下文 shaping 脚本和缺失原生 metrics 明确拒绝。
- exact document/revision/Page 绑定，full/incremental scene 的 fragment 建立、更新与删除恢复。
- fragment click 后 `editor.list`、Renderer selection 与 anchor 立即回到原 Text；selection chrome 不停留在 fragment。
- fragment double-click 重定向原 proxy，编辑态外观切换、成功 revision handoff、Escape 恢复、锁定拒绝与 dispose 清理。
- `@opendesign/text-service` 专项测试、typecheck 和 scoped lint；不运行本地全量 verify 或打包。
