# ADR-0074：Typography Core v2 与 Figma Text/TextStyle 基础语义

- 状态：Accepted
- 日期：2026-08-15
- 文档协议：`DesignDocument 1.29.0`
- Text Layout contract：v2
- SVG Text metadata：v4
- 关联：ADR-0035、ADR-0036、ADR-0070、ADR-0071

## 背景

`DesignDocument 1.10.0` 已有 Fixed、Auto Width、Auto Height、换行、固定框溢出和可信文字测量，但旧 `textOverflow: ellipsis` 同时承担“框如何裁剪”和“是否显示结束省略号”两种职责，也无法表达 Figma 的 `textTruncation/maxLines`。段落缩进、段落间距、大小写和文字装饰只存在于目标能力描述，没有贯通文档、人工编辑、Agent、渲染、Text Style 与 SVG。

Figma 的 Text Style 包含字体、字号、字重、行高、字距、段落缩进/间距、大小写和装饰；alignment、fill、resize、truncation 与 max-lines 属于 Text 节点，不属于 Text Style。OpenDesign 按这一公共边界扩展自有协议，不导入 Figma 私有对象或建立第二份文档事实。

## 决策

### 文档语义

Text properties 新增：

```ts
paragraphIndent: number;
paragraphSpacing: number;
textCase: "original" | "uppercase" | "lowercase" | "title-case" | "small-caps";
textDecoration: "none" | "underline" | "strikethrough";
textTruncation: "disabled" | "ending";
maxLines: number | null;
```

不变量如下：

- `disabled` 必须使用 `maxLines: null`。
- Fixed + `ending` 必须使用 `textOverflow: clip`；`maxLines: null` 表示按权威文字框高度截断，正整数表示额外行数上限。
- Auto Width/Auto Height + `ending` 必须使用正整数 `maxLines`；Auto Width 仍为 no-wrap/visible，Auto Height 仍为 word/character-wrap/visible。
- Fixed 节点的 `size` 不因 max-lines 改写；Auto Size 仍由 Text Layout provider 返回具体权威 size。
- 文档永远保存完整 `content`，省略号只是当前 revision 的派生显示文本。

Text Style 增加 paragraph indent/spacing、case 和 decoration。Alignment、paint、resize、truncation 与 max-lines 不进入 Text Style。

### 渲染、测量和直接编辑

Leafer 2.2.9 原生映射 `paraIndent`、`paraSpacing`、`textCase`、`textDecoration` 和 ending ellipsis。Leafer 没有公开的 max-lines 排版结果接口，因此固定 adapter 在创建短生命周期 Text 测量对象后，只在 `@opendesign/leafer-engine` 内读取固定版本的 `__textDrawData.rows`，通过二分收缩完整前缀生成派生结束省略号。该私有形状不得进入公共 contract、持久化、Agent 参数或其他包。

画布与 Auto Size 使用同一派生函数。进入 Leafer TextEditor 前恢复完整 `content`；无修改关闭、取消或拒绝写回时重新投影截断文本；修改成功时提交完整编辑文本，不把派生省略号写入文档。

### 迁移与互操作

- `1.28.0` 及更早可迁移文档补 Core v2 默认值。
- 旧 `textOverflow: ellipsis` 迁移为 `textOverflow: clip + textTruncation: ending + maxLines: null`。
- 旧 Text Style 补 paragraph `0/0`、case `original`、decoration `none`。
- SVG Text metadata 升为 v4，继续读取 v3/v2/v1；标准 SVG 同时输出 decoration、case/font-variant 和段落 tspan 几何。SVG 无法完整表达截断、max-lines 和可编辑文字框时返回 fidelity warning。
- Figma interop 只转换官方 TextStyle 公共字段；Text 节点截断仍由 OpenDesign 文档与后续专用 Figma node adapter 负责。

### Agent 与人工 UI

Inspector 提供段落缩进/间距、大小写、装饰、截断和最大行数，并在切换 Fixed/Auto Size 时提交满足上述不变量的原子属性 patch。完整 apply schema 与 bootstrap apply schema 同步暴露 Core v2；模型不得用字面 `...` 改写完整 content。

## 后果与限制

- `text.rich-typography` 从 unavailable 调整为 degraded：单样式 Typography Core 与共享 Text Style 已贯通，但不是 rich text 完成。
- Rich runs、列表、OpenType feature、variable-font axis、字体 asset/授权/替换、字体加载后的显式 reflow、text-on-path 和确定性跨平台 shaping 仍未实现。
- 固定 Leafer 私有 rows 读取是 adapter 内的受控版本风险；升级 Leafer 前必须以截断 corpus、直接编辑恢复和 Auto Size 测量测试重新验收。
- macOS/Windows 的真实字体、输入法、字体 fallback 和像素基线仍阻塞该能力升级为 available。

## 验证

- Contract 覆盖 1.28→1.29、旧 ellipsis、Text Style 默认迁移和所有 resize/truncation 组合。
- Text Service/EditorRuntime 覆盖 v2 请求校验、重测和 Auto Size max-lines。
- Leafer 覆盖 Core 字段映射、私有 rows 截断、固定框尺寸不变、完整文字编辑恢复与关闭后重新截断。
- SVG 覆盖 metadata v4 往返以及 v3/v2/v1 迁移；Figma interop 覆盖非默认 paragraph/case/decoration。
- Inspector 与 Agent 的完整/Bootstrap schema 覆盖新字段和不变量；完整 apply schema继续保持在既有 64 KB 边界内。
