# ADR-0079：Figma-compatible 文字范围核心与原生投影边界

- 状态：Accepted
- 日期：2026-08-15
- 文档协议：不变（`DesignDocument 1.30.0`）
- Text Layout Service：contract v4（不变）
- Text Range Service：contract v1
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

## 后果与后续门禁

Range Service v1 已提供 Figma-compatible 索引、规范化和直接编辑重映基础。Leafer 结构 spike 也已保留一个稳定原 Text 作为透明可命中的 edit proxy，并把完整覆盖的 provider fragments 投影为同父级原生 Text：局部偏移与原 transform 正确合成，sibling 顺序稳定，synthetic metadata 回映原 Text/range，派生元素不进入文档。用户仍不能创建或查看 rich-text runs；下一切片继续验证 mixed face/size/fill 的 run-aware wrapping/baseline、真实 child hit → original selection、编辑 proxy 打开/关闭与 capture/export，之后才共同升级 `DesignDocument`、EditorRuntime、Inspector、Agent、Figma/SVG 和 capability manifest。

首版 `TextRunStyle` 只应纳入能够真实渲染、编辑和往返的字段。Figma 的列表、OpenType、hyperlink、variables 和段落范围属性继续分阶段实现，不能因为官方 API 存在就提前写入不可执行 schema。

## 验证

- UTF-16 emoji range 使用 `[1,3)`，拒绝位于 surrogate pair 中间的 boundary。
- 非空 runs 必须完整连续覆盖 content；空 content 只能有空 runs。
- base style materialization 与相邻同样式合并。
- boundary 插入的 before/after 样式继承。
- 跨多个 run 删除、平移和两侧同样式合并。
- emoji replacement 的 bounded diff 与后续 styled suffix 保留。
- 原 Text edit proxy、原生 synthetic Text fragment、transform 合成、parent/root 顺序、原 ID/range metadata 与非法 provider output 拒绝。
- `@opendesign/text-service` 专项测试、typecheck 和 scoped lint；不运行本地全量 verify 或打包。
