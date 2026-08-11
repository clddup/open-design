# ADR-0035：版本化文字换行与溢出语义

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：`DesignDocument 1.9.0`
- 关联：ADR-0005、ADR-0009、ADR-0023、ADR-0034；Auto Size 后续由 ADR-0036 扩展

## 背景

`DesignDocument 1.8.0` 的 Text 节点只有文字内容、字体基础属性和对齐方式。Leafer adapter 对所有 Text 硬编码按字符换行，并把 Frame 的 `overflow` 属性误用于 Text；模型、人工属性面板、保存文件和 SVG 都无法表达用户希望按词换行、不换行、显示溢出、裁切或省略。

Figma 把 Auto Width、Auto Height 与 Fixed Size 作为正式的 Text resizing 语义，并另外提供截断与最大行数。Leafer Text 2.2.9 可以直接表达自动宽/高、`textWrap` 与 `textOverflow`。但 OpenDesign 当前没有 Text/Font shaping service、受控字体 asset 或跨平台字体度量；如果仅在 Renderer 省略 Leafer width/height，实际边界会与权威 `DesignNode.size`、命中、选区、保存和导出分裂。因此本切片只交付当前能忠实贯通的固定文字框换行与溢出，不用字符数估算 Auto Size 或 max-lines。

参考：

- [Figma：Text dimensions and resizing](https://help.figma.com/hc/en-us/articles/27378154668951-Adjust-text-dimensions-and-resizing)
- [Figma：Explore text properties](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties)
- [LeaferJS Text](https://www.leaferjs.com/ui/guide/display/Text.html)

## 决策

### `DesignDocument 1.9.0`

Text properties 增加两个必需字段：

```ts
textWrap: "none" | "word" | "character";
textOverflow: "visible" | "clip" | "ellipsis";
```

- `none` 不自动换行，显式换行符仍分段；
- `word` 在允许的词边界换行；
- `character` 必要时可在字符边界换行，适合 CJK 与无断点长串；
- `visible` 显示固定框外内容；
- `clip` 在固定框边界裁切；
- `ellipsis` 在固定框内以省略号表示被截断内容。

`size` 继续是唯一权威文字框边界。上述字段不改变节点尺寸，也不暗示 Auto Width、Auto Height、max-lines、字体可用或跨平台 shaping 已实现。

### 迁移与事务

读取 `1.0.0–1.8.0` 文档时，为旧 Text 确定性补入 `textWrap: "character"` 与 `textOverflow: "visible"`。旧 adapter 的 `textWrap: "break"` 确实生效，但误写的 Box `overflow: "hide"` 不被 Leafer Text 消费，真实运行时使用默认 `textOverflow: "show"`；迁移必须遵循实际显示结果，不能按失效代码的意图偷偷裁掉历史文字。transform、size、content 和 revision 不变。未知版本继续拒绝。

人工 Inspector 与 Agent typed transaction 都只通过 `update_properties` 修改这两个字段，复用唯一 EditorRuntime、preview、revision、自动保存与 undo/redo。新建人工 Text 默认 `word + clip`；Agent 创建完整 Text 时必须显式给出两项选择，不能依赖 provider 默认值。

### Leafer 投影

adapter 做唯一映射：

| OpenDesign  | Leafer Text                |
| ----------- | -------------------------- |
| `none`      | `textWrap: "none"`         |
| `word`      | `textWrap: "normal"`       |
| `character` | `textWrap: "break"`        |
| `visible`   | `textOverflow: "show"`     |
| `clip`      | `textOverflow: "hide"`     |
| `ellipsis`  | `textOverflow: "ellipsis"` |

Text 不再错误使用 Frame/Box 的 `overflow` 属性。Leafer 仍只是当前 revision 的可丢弃投影，字段语义属于 OpenDesign 文档协议。

### SVG 保真

受控 Text metadata 升级为 v2，并保存完整 `TextProperties`。导入继续读取 metadata v1，确定性补入旧默认值后再校验标准 `<text>/<tspan>` 表示。普通 SVG 1.1 不能可靠表达自动换行、固定框溢出、justify 与准确字体 shaping，因此标准 SVG 继续输出显式 `<tspan>` 并返回 `text-layout-fidelity` warning；OpenDesign metadata 可编辑往返不等于普通 SVG 消费者具有相同版式。

## 后果

- 用户与 Agent 可以明确控制基础文本框的换行和溢出，不再被硬编码为单一行为。
- 旧 `.opendesign` 与 SVG Text metadata v1 可确定性迁移，保存重开和 undo/redo 不丢语义。
- `DesignLayoutQualityReport` 仍不能仅凭字符数确定文字是否截断；后续必须先建立 Text/Font service 和字体来源/替换语义，再加入真实 overflow 诊断。
- Auto Width、Auto Height、max-lines、富文本 runs、段落、列表、OpenType/variable font、字体 asset 与跨平台 shaping 仍明确未实现。
