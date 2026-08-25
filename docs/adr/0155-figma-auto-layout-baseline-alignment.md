# ADR-0155：Figma-compatible Auto Layout 文字基线对齐

- 状态：Accepted
- 日期：2026-08-25
- DesignDocument：`1.47.0`
- Text Layout Service：contract `5`
- Layout Service：contract `11`
- 扩展：ADR-0036、ADR-0053、ADR-0056、ADR-0079、ADR-0154

## 背景

OpenDesign 的 Horizontal Auto Layout 已支持 Fixed/Hug/Fill、Wrap、Min/Max、Auto gap 与 wrapped-row 分布，但交叉轴只能按 start/center/end 对齐。图标与不同字号文字因此只能对齐外框，无法形成专业 UI 中常见的共同文字基线。

Figma 公共 Plugin API 将该语义定义为 Frame 级 `counterAxisAlignItems: "BASELINE"`，且只允许 Horizontal Auto Layout。普通图层以底边参与，文字按实际 baseline 参与；Wrap 中每个 track 独立对齐。继续按 `fontSize * 常数` 猜测会与字体、line-height、富文本、垂直对齐和真实画布渲染漂移，因此不可接受。

## 决策

### 文档语义

`DesignDocument 1.47.0` 将 linear Auto Layout 的 `counterAlignment` 扩展为 `start | center | end | baseline`。`baseline` 只在 Horizontal flow/Wrap 有效；Vertical Auto Layout 在 planner 与 Layout Service 两层明确拒绝。`1.46.0` 迁移只提升 schema version，不重写布局或节点。

文档不持久化任何测量值。baseline 是当前文档 revision、Text 属性、字体 provider 与具体 Text bounds 的可丢弃派生结果。

### 权威文字度量

Text Layout Service contract 5 为单样式 Text provider 增加有界 `measureFirstBaseline`：请求包含完整文字样式、换行、固定 bounds 与垂直对齐，Leafer 2.2.9 provider 从与生产画布相同的内部行度量读取首行 baseline。结果按完整请求有界 LRU 缓存，preview/apply 与收敛 pass 不重复测量。

含 character/paragraph runs 的 Text 不走单样式近似，直接复用 Text Run Layout contract 4 的真实第一行 `y + baseline`。provider 未就绪、身份漂移、非法或不可支持结果在 revision 前失败，不回退到字号比例。

### Layout Service

Layout Service contract 11 的 child 输入可携带非持久 `baseline`：

1. Text child 使用 provider 首行 baseline；普通 layer 未携带度量时使用底边。
2. 一行的共同 baseline 是所有非 stretch child baseline 的最大值；行高度同时容纳 baseline 上方与下方 extent。
3. Horizontal Hug counter axis 使用该真实 baseline content extent，而不是简单最大 child height。
4. Wrap 每个 row 独立求 baseline，不跨 row 建立关系。
5. counter-axis Fill child 继续由 stretch 决定尺寸并固定在 row 起点，不参与共同 baseline；该行为与 Figma child `layoutAlign: "STRETCH"` 的覆盖语义一致。
6. baseline 可以位于较小固定 Text box 之外，以保留 visible overflow 的真实文字度量；Layout Service 仍限制为有限有界数值。

EditorRuntime deepest-first 收敛先处理嵌套布局和 Auto Height Text 宽度变化，再按当前具体 bounds 请求 baseline。Horizontal Fill 改变 Text width 时，下一 pass 使用新宽度重新取有缓存的准确度量；不建立第二份布局状态。

### 人工 UI、Agent 与 Figma

- Inspector 只在 Horizontal flow/Wrap 的交叉轴选项中展示“文字基线”，并支持 Figma 的 `B` 键；切换到 Vertical 时确定性回到 start。
- Agent `set-auto-layout` 继续使用同一权威 Auto Layout schema；模型只提交 `counterAlignment: baseline`，不提交 baseline 数值或 child 坐标。
- Figma interop 在 OpenDesign `baseline` 与 `counterAxisAlignItems: "BASELINE"` 之间双向映射。该 adapter 证明公共字段兼容，不宣称完整 Figma 文件导入导出。

## 后果

- 图标、不同字号文字、单样式与 rich Text 可以使用真实首行度量稳定对齐。
- 能力不增加模型请求、Critic、动画 delay 或文档字段之外的持久状态，不影响首个真实画面的 Provider 时延。
- provider 初始化或真实度量失败会阻止该笔事务；不会静默生成“看起来差不多”的坐标。
- Vertical Wrap 仍不属于 Figma 公共模型；画布 spacing/reflow handles、更多 Grid 自动轨道、SVG Grid metadata、breakpoint 与双平台 GUI 证据继续独立推进。

## 验证

- Layout Service 覆盖不同 Text baseline、普通 layer 底边、Hug extent、Wrap row-local baseline、stretch override、非法 Vertical 与非法 metrics。
- Text Service/Leafer 覆盖真实固定文字框首行 baseline、垂直对齐、结果校验和有界缓存。
- EditorRuntime 覆盖 provider 度量、单 revision、undo/redo、Vertical 零 revision 拒绝与 save/reopen 迁移。
- Inspector 覆盖 Horizontal 选项与 Vertical 隐藏；Agent schema/execution 覆盖 typed baseline；Figma interop 覆盖 `BASELINE` 往返。

## 参考

- [Figma Plugin API：counterAxisAlignItems](https://developers.figma.com/docs/plugins/api/properties/nodes-counteraxisalignitems/)
- [Figma Learn：Use horizontal and vertical flows in auto layout](https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout)
- [Figma Plugin API：layoutAlign](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutalign/)
