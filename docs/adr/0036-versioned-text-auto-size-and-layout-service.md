# ADR-0036：版本化文字自动尺寸与 Text Layout Service

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：`DesignDocument 1.10.0`
- Service contract：`Text Layout Service v1`
- 关联：ADR-0005、ADR-0009、ADR-0023、ADR-0034、ADR-0035

## 背景

`DesignDocument 1.9.0` 已有固定文字框的 `none/word/character` 换行与 `visible/clip/ellipsis` 溢出，但 Auto Width 和 Auto Height 仍缺失。只在 Leafer 投影中省略 `width/height` 会让渲染尺寸与 OpenDesign 的权威 `DesignNode.size` 分裂：命中、选区、布局质检、保存、undo/redo、Agent 后续定位和导出会各自看到不同边界。按字符数估算同样无法处理字体、字重、字距、行高、CJK、换行和 fallback。

Figma 把 Auto Width、Auto Height 与 Fixed Size 作为正式 Text resizing 模式。Leafer Text 2.2.9 已提供当前画布所需的实际排版度量，但它仍是可替换 provider，不能把 Leafer 私有对象写入公共文档或 Runtime 契约。

参考：

- [Figma：Text dimensions and resizing](https://help.figma.com/hc/en-us/articles/27378154668951-Adjust-text-dimensions-and-resizing)
- [Figma：Explore text properties](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties)
- [LeaferJS Text](https://www.leaferjs.com/ui/guide/display/Text.html)

## 决策

### `DesignDocument 1.10.0`

Text 增加必需的 discriminated resize 语义：

```ts
type TextResize = "auto-width" | "auto-height" | "fixed";
```

- `auto-width`：只按显式换行分段，固定为 `textWrap: "none"` 与 `textOverflow: "visible"`，宽高都由可信测量结果决定；
- `auto-height`：宽度由文档 `size.width` 固定，高度由内容重排决定，只允许 `word | character` 换行，并固定为 `textOverflow: "visible"`；
- `fixed`：宽高都由文档明确指定，继续支持全部换行和溢出组合。

`size` 在三种模式下始终保存具体、有限、可撤销的权威尺寸。Auto Size 不是 Renderer 的第二份临时状态。人工修改 Auto Size Text 的宽高会在同一事务中切换为 `fixed`；单击创建 Text 默认 Auto Width，拖拽创建默认 Fixed。读取 `1.0.0–1.9.0` 文档时，旧 Text 确定性迁移为 `fixed`，不改变已有尺寸、换行、溢出、transform 或内容。

### 独立 Text Layout Service v1

新增 `@opendesign/text-service`，公共 contract 只接受有界纯数据：内容、font family、font size/weight、line height、letter spacing、resize mode、wrap，以及 Auto Height 的固定 width。结果必须包含 provider identity/version、具体 size 和有界 fidelity warnings；失败必须区分无效输入、provider 不可用与测量失败，并声明是否可重试。

Service 不持有文档、不写 revision、不加载任意文件、不取得字体路径或凭据。精确请求使用有界 LRU memoization，使同一事务的 `preview()` 与 `apply()` 复用同一测量结果，避免一次用户动作因重复测量产生不同尺寸。

当前 provider 固定为 `leafer-editor@2.2.9` 的 Text layout：Auto Width 不传 width/height，Auto Height 只传 width，并读取真实 `boxBounds`。provider 未初始化时，EditorRuntime 返回带 `nodeId/path/recovery` 的可重试 `engine-failure`，不猜尺寸；浏览器字体不可用时保留 fallback 实测尺寸并返回 `text-layout.font-fallback` fidelity warning。

### 唯一 Runtime 与 Workspace 生命周期

EditorRuntime 是唯一应用入口。`insert_element`、`update_properties` 和 `replace_subtree` 在合并并校验 Text 语义后调用注入的 Text Layout provider，再把具体尺寸写入同一待提交文档。失败不增加 revision；成功继续使用普通 preview、history、undo/redo、保存和自动保存。

Canvas 初始化 Leafer adapter 后把 provider 注册到 WorkspaceRuntime；WorkspaceRuntime 同步更新当前、后台已打开和以后打开的 Design File runtime。因此后台 Agent 仍写入其绑定文件的唯一事实状态，不需要活动 viewport，也不为每个 Conversation 建立测量状态。

Leafer 投影遵循 resize mode：Auto Width 省略 width/height，Auto Height 只提供 width，Fixed 提供 width/height。直接移动 Auto Size Text 时读取实际 box bounds，只提交 transform；用户真实 resize 才提交具体 bounds 并由 Runtime 转为 Fixed。

### 人工、Agent 与 SVG

Inspector 提供 Auto Width、Auto Height、Fixed 三种模式，并按模式禁用无效的 wrapping/overflow 组合。Agent typed schema 使用同一 `textResize` 字段；工具说明明确尺寸由宿主测量，模型不得估算 glyph bounds。

受控 SVG Text metadata 升级为 v3，保存 `textResize` 与具体 size。v2 确定性迁移为 Fixed，v1 先迁移旧 wrap/overflow 再迁移为 Fixed。标准 SVG 没有等价的 OpenDesign 自动尺寸协议，仍输出标准 `<text>/<tspan>` 和具体布局，并报告 consumer-dependent text layout fidelity；metadata 可编辑往返不等于任意 SVG consumer 会自动重排。

## 当前限制

- 当前没有字体 asset、授权、嵌入或替换工作流；浏览器 fallback 会改变度量并返回 warning。
- 字体在后续加载成功后不会隐式重写历史 revision；需要后续显式 reflow 命令与用户可见 diff。
- max-lines、富文本 runs、段落、列表、OpenType/variable font、text-on-path 和确定性跨平台 shaping 仍未实现。
- 自动化覆盖 contract、Runtime、Leafer、Workspace、人工 Inspector、Agent 和 SVG；macOS/Windows 打包 GUI 的字体、IME、DPI 与像素样张仍是 native gate，不能把 capability 标为完整可用。

## 后果

- 人工与 Agent 可以使用同一正式 Auto Width/Auto Height 语义，保存、命中、选区、后续事务和导出读取同一具体尺寸。
- Renderer 不再用字符数猜测，也不把未持久化的 Leafer bounds 当成文档事实。
- provider 可替换；将来接入 HarfBuzz/Skia 或受控字体服务时，只需替换 Text Layout adapter，并通过同一 contract、兼容性与双平台基线门禁。
- 单样式文字能力仍为 `degraded`，直到字体资源、显式 reflow、精确 shaping 和双平台实机验收完成。
