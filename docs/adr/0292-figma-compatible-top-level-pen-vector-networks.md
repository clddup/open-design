# ADR-0292：Figma-compatible 顶层 Pen Vector Network

- 状态：Accepted
- 日期：2026-09-03

## 背景

OpenDesign 的顶层 Pen 原先把草稿建模为一串顺序节点，闭合或结束第一条 path 后便立即提交。这能创建单条开放或闭合 contour，却不能在一次创作中形成 Figma 式 Vector Network：用户无法从既有节点继续分支，也无法在同一 Vector 中加入独立 contour。

Vector Edit Pen 已通过 Geometry Service 的 `appendVectorContour`、`appendVectorPoint` 与 `connectVectorEndpoints` 支持这些拓扑语义。顶层 Pen 应复用同一事实，而不是再维护一套单轮廓转换器。

公开参考：

- <https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks>
- <https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>

## 决策

1. 顶层 Pen 草稿直接持有完整 `VectorNetwork`，不再保存平行的临时 vertex 数组并在结束时转换。
2. 当前 path 结束后仍保留同一草稿：
   - 点击空白处开始独立 contour；
   - 点击既有 vertex 从该稳定节点续画或创建 branch；
   - 当前 path 点击既有 vertex 时复用 Connect 语义完成关闭、合并或 shared junction。
3. 第一次 `Escape` 结束当前开放 path；没有 active path 时再次 `Escape` 提交整个 Network。`Enter` 直接提交，工具切换沿既有同步生命周期提交。
4. 整个草稿只生成一个 Vector node、一次 Renderer callback、一次 EditorRuntime revision 和一次 undo。Backspace 通过草稿快照逐步撤回，不创建中间文档 revision。
5. 闭合 region 与开放 branch 可以共存；Renderer 根据 Network 中的 region 和开放 path 分别决定 Fill 与 Stroke，不能用单个 `closed` 布尔值丢失混合拓扑外观。
6. 复用现有 Geometry Service 与 Vector Pen primitive，不新增 Agent tool、DesignDocument 字段、公共 Geometry 契约或第二套可写状态。

## 失败与生命周期

- Page、document、parent、revision 或投影连续性失效时丢弃 session 草稿，零写入。
- 非法拓扑与退化点击返回既有结构化失败；不会用新 path 或新节点绕过 Network invariant。
- Renderer callback 拒绝时恢复权威 Leafer 投影；草稿 overlay、anchor、handle 与历史快照不进入文档、history、capture 或 export。

## 验证

- 纯状态覆盖开放/闭合 contour、click-drag handles、独立 contour、既有节点 branch 与 pending start 连接。
- Leafer 集成覆盖闭合后继续独立 path、从内部节点分支、两段 `Escape`、Backspace、工具切换、callback 拒绝、Page/document/parent/revision 失效和 zoom 下固定屏幕 chrome。
- 混合 closed region 与 open branch 以一次 normalized Vector request 提交，保留 Fill 与 Stroke。

## 后续

- path-nearest-point 与 Bézier handle 吸附、测量。
- 顶层 Pen 对现有文档 Vector 的直接继续绘制仍由 Vector Edit mode 承担，不隐式合并不同节点。
- macOS 与 Windows 打包产品中的真实指针、键盘组合和像素证据。
