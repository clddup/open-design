# ADR-0077：Figma-compatible 字体 face 身份

- 状态：Accepted
- 日期：2026-08-15
- 文档协议：`DesignDocument 1.30.0`
- Text Service：contract v4
- SVG Text metadata：v5
- 关联：ADR-0036、ADR-0070、ADR-0074、ADR-0076
- 基线：`@figma/plugin-typings 1.133.0` 的 `FontName { family, style }`

## 背景

ADR-0076 已把字体请求与当前 provider 可用性分开，并提供显式、可撤销的文件级替换与 Auto Size 回流。但 `DesignDocument 1.29.0` 只保存 `fontFamily + fontWeight`，Figma `FontName.style` 没有可靠来源。根据数字 weight 猜测 `Regular`、`Semi Bold` 或 `Bold` 会把不同字体家族自己的 face 命名规则伪造成精确身份，也无法区分同 weight 的 normal/italic face。

Figma 的公共 `FontName` 边界只承诺 family 与 exact style string；CSS/Leafer 渲染仍需要 numeric weight 与 slant。OpenDesign 因此同时保存互操作身份和当前渲染参数，不引入第二个嵌套 `fontName` 对象，也不把运行时 availability 写入文档。

## 决策

### 一个正式字体 face 描述符

Text、Text Style、Text Service、Inspector、Agent 与互操作统一使用：

```ts
interface FontFaceIdentity {
  fontFamily: string;
  fontStyleName: string | null;
  fontWeight: number;
  fontSlant: "normal" | "italic";
}
```

- `fontFamily + fontStyleName` 是面向 Figma 与外部格式的精确 face 身份。
- `fontWeight + fontSlant` 是当前 Leafer/CSS provider 的确定性渲染参数。
- `fontStyleName: null` 表示旧文档、普通 SVG 或其他来源无法证明 exact face 名称；它不是 `Regular` 的别名。
- 不允许从 numeric weight 或 slant 猜造 style name。用户或受信任 importer 必须明确提供 exact style。
- availability、已加载状态、fallback、字体路径和许可结果继续属于当前 provider，不持久化、不进入 revision/history。

### 迁移与严格边界

`1.29.0 → 1.30.0` 迁移只为 Text 与 Text Style 补：

```ts
fontStyleName: null;
fontSlant: "normal";
```

迁移不根据 `fontWeight` 猜测 style。已经声明为 `1.30.0` 的输入若缺少任一 face 字段则严格拒绝，避免新文档继续制造不完整身份。Welcome 文档和新建样张使用明确的 `Inter / Semi Bold / 600 / normal` 等完整默认值。

### 测量、渲染、替换与并发

Text Service v4 的 layout、availability、cache key 与 `reflow_text` expected/replacement descriptor 都包含四个字段。文件级替换只匹配完整 face；任一节点在提交前改变 family、style name、weight 或 slant 都触发 stale failure，不能覆盖用户并发修改。

Leafer adapter 使用 `fontFamily/fontWeight/fontSlant` 进行当前渲染与测量。`fontStyleName` 保留为精确持久身份和互操作依据，不假设浏览器能按任意外部 style string 直接选择 face。Auto Size、Fixed 尺寸、显式 reflow、provider availability 和 undo/revision 语义延续 ADR-0076。

### Inspector 与 Agent

Inspector 在单样式 Text 上独立显示并编辑 face style 与 slant；文件级替换提交完整 expected/replacement face，并继续显示可信 availability 与精确匹配数量。所有更新通过现有 EditorRuntime transaction，不建立 UI 私有字体状态。

Agent inspection、完整 apply、Bootstrap apply 和专用 `opendesign_manage_fonts` 使用同一四字段 schema。模型不得把 `null` 解释为 `Regular`，也不得仅修改 weight 却声称已经选择了 exact Figma face。

### Figma 与 SVG 互操作

- Figma interop 仅在 `fontStyleName` 非 null 时生成官方 `FontName { family, style }`；未解析 face 返回显式 fidelity failure，不再按 weight 猜 style。
- Shared Text Style 使用同一规则；availability 不进入 Figma payload，目标 Figma host 仍负责 `loadFontAsync()`。
- SVG Text metadata 升为 v5，完整保存四字段并继续读取 v4/v3/v2/v1；标准 SVG 同时输出 `font-family`、`font-weight` 与 `font-style`。
- 普通 SVG 无法证明供应商 exact style name 时保持 unresolved，不伪造身份。metadata 与标准属性冲突时按既有 tamper 边界拒绝。

## 后果与限制

- OpenDesign 现在可以无猜测地保存、替换和导出单样式文字的 exact face identity，并保持 Leafer 当前渲染所需的 weight/slant。
- 这不代表字体二进制已经导入、授权或跨平台加载，也不代表同名字体在 macOS、Windows 和 Figma 中具有相同字形或 metrics。
- Variable font axes、OpenType features、rich text runs/range font、列表、text-on-path、字体 asset/发布和确定性跨平台 shaping 仍未实现。
- Figma `.fig` 完整文件往返、Plugin/REST 写入和 macOS/Windows 原生视觉验收仍是后续门禁；当前互操作只证明公共类型映射和显式失败行为。

## 验证

- Contract：`1.29 → 1.30` Text/Text Style 迁移、`1.30` 严格字段、Welcome 默认 face 和序列化往返。
- Text Service/EditorRuntime：四字段校验、cache identity、availability、精确匹配、replacement、stale conflict、Auto Size reflow、Fixed 保持尺寸与 undo/redo。
- Leafer：weight/slant 映射、layout request 与 face descriptor 透传、不同 slant 的 cache/measurement 边界。
- Inspector/Agent：face style/slant 编辑、完整 replacement payload、Bootstrap/完整 schema、inspection 与 Coordinator scope/revision。
- Figma interop：exact style 映射、unresolved Text/Text Style 明确失败，不存在 weight-to-style 猜测。
- SVG：metadata v5 往返、v4/v3/v2/v1 迁移、标准 `font-style` 与 tamper detection。
