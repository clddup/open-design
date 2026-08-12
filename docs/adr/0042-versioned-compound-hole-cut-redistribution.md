# ADR-0042：复合孔洞 Cut 的版本化重分配

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：不变（`DesignDocument 1.10.0`）
- Service contract：`Geometry Service v9`
- 关联：ADR-0026、ADR-0038、ADR-0039、ADR-0040、ADR-0041

## 背景

Geometry Service v8 已支持开放描边和闭合轮廓的有限线 Cut，但同一 fill region 包含多个 closed loops 时仍整体拒绝。字母 “O”、徽标镂空与环形图形都依赖复合 region；如果切线只穿过外轮廓而完全不触碰内孔，专业编辑器应让该孔洞跟随实际包含它的分片，而不是丢失、复制到两边或阻止整个 Cut。

Figma 的 Vector Network 把 region 定义为一个或多个 loops，并明确用字母 “o” 说明外轮廓与内孔属于同一 region。Figma 的 Cut 则把分割出的部分移动到独立 layer。OpenDesign 因此需要在 retained/extracted sibling 之间重新分配未被切到的 hole loops，并保持标准 path、Leafer Fill、保存与导出都使用相同有效方向。

参考：

- [Figma：Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- [Figma Plugin API：VectorNetwork](https://developers.figma.com/docs/plugins/api/VectorNetwork/)

## 决策

### Geometry Service v9 支持未穿孔洞的重分配

当一个 region 具有一个可无歧义识别的 outer loop 与一个或多个 inner loops，且有限切线只横穿 outer loop 两次时：

- outer loop 继续使用 v7 的两交点闭合分割，生成 retained/extracted closed contours 与真实 connector；
- 每个 inner loop 必须严格位于切线一侧；宿主检查其所有 line/cubic 控制包络点，不接受 touching、crossing 或 straddling；
- 每个 hole loop 原样进入对应侧的 region，保留 path、segment、vertex ID、`reversed` 与源 region winding rule；
- 跟随 extracted side 的 hole path ID 被加入 `extractedPathIds`，随 sibling 一起归一化、插入、保存和导出；
- 含 source outer 起点的一侧继续保留 source path/region ID，hole loop 顺序不依赖其在源 region 数组中的位置。

outer loop 当前以唯一包含其他 loop bounds 的闭合 path 判定。无法找到唯一 outer、同一 path 被多个 region 以冲突方向引用、切线接触或穿过 hole，以及直接以 hole path 为 Cut 目标时，都返回明确 `unsupported-topology`，不写入部分结果。

### `loop.reversed` 进入标准渲染方向

此前 `VectorRegion.loops[].reversed` 能保存并随 Reverse 更新，但 `serializeVectorNetwork` 总按 path run 的原始 traversal 输出标准 path，导致 `nonzero` compound hole 可能被填实。

v9 规定：

- 被 region 引用的 closed path 按 `path.segments` 与有效 `loop.reversed` 的组合序列化；
- `reversed:true` 时以相反 reference 顺序并翻转每段 direction 输出；
- 同一 path 若被多个 region 以相互冲突的有效方向引用，序列化明确失败；
- 无 region 的 closed stroke、开放 path 与纯描边仍按其 path run traversal 输出，不制造 fill 语义。

Leafer、Boolean、SVG metadata 一致性检查和标准 SVG `d` 全部继续消费这一唯一序列化结果。

### Runtime、Canvas 与 Agent 复用现有边界

本切片不增加第二种操作或 UI 模式。人工 Cut 手势、单层 `cut-with-line`、多层 `cut-layers-with-line`、EditorRuntime planner 与 Geometry Service 使用同一输入和结果：

- 一次 pointer-up/tool call 仍只产生一次 preview/apply、revision 和 undo；
- bounds、transform、result node ID 与 sibling insertion 仍由可信宿主生成；
- 选区、pan/zoom、平台 modifier 和 Agent 实时 selection 不参与 hole ownership；
- crossed/touching hole 的结构化失败返回 Agent，要求保留当前文档并重新选择切线，而不是模型重写 network。

### SVG 与持久化

每个 Cut 结果仍是一个普通 Vector node。只有 outer loop 的 sibling 导出一个标准闭合 subpath；包含未切 hole 的 sibling 导出 outer 与反向 hole 两个标准闭合 subpaths，并附带各自的 editable-network metadata v2。再导入时必须恢复相同 paths、regions、stable IDs 与 loop directions。

文档 schema 已能表达多 loop region，因此不升级 `DesignDocument`。

## 验证

自动化覆盖：

- hole 位于 retained 或 extracted 两侧、源 loop 数组顺序变化、稳定 ID 与 region/winding 保留；
- crossed/touching hole、以 hole 为直接 Cut path、歧义 outer 与多 region ownership 的原子失败；
- Runtime preview/apply、tight bounds、save/reopen、undo/redo；
- 人工 Canvas 与 Agent 单事务结果、selection 行为、structured failure 和宿主结果 ID；
- Leafer 对 `loop.reversed` 的有效标准 path 投影；
- 标准 SVG 多 subpath、metadata v2 与 compound sibling 可编辑再导入。

## 当前限制

- 切线直接穿过 hole 时需要把 outer/hole arcs 与 cut connectors 重建为新的连续边界；这与闭合凹形四次及以上 crossing 共同进入下一 contract，当前明确拒绝。
- 多层嵌套 island/hole、重叠 loops、self-intersection 与 connected/branching network 仍未完成。
- connect/disconnect、lasso、多点变换框、flatten、outline stroke、正式 Slice、真实像素 baseline 和 macOS/Windows 打包产品 smoke 仍待后续。

## 后果

- 常见带孔徽标、字形轮廓与环形图形可在不穿孔洞时直接使用 Cut，孔洞不会丢失或被填实。
- Region 的有效 winding 从持久数据贯通到 Leafer 与 SVG，不再只是“保存了但没渲染”的字段。
- crossed-hole 与凹形多交点仍有清晰的后续几何边界，不用退化边或重叠 connector 冒充支持。
