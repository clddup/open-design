# ADR-0044：穿孔与凹形多交点 Cut 的版本化边界缝合

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：不变（`DesignDocument 1.10.0`）
- Service contract：`Geometry Service v10`
- 关联：ADR-0026、ADR-0039、ADR-0040、ADR-0041、ADR-0042

## 背景

Geometry Service v9 已能切割闭合/开放 contour，并把未被切线碰到的 compound hole 分配给实际包含它的 sibling，但仍拒绝两类常见专业矢量操作：切线同时穿过 outer 与 hole 的穿孔 Cut，以及一个闭合凹形轮廓产生四次或更多真实横穿的 Cut。前者不能把原 hole 原样保留，因为分割后它已与 outer boundary 相连；后者也不能只按第一个和最后一个交点补一条边，否则会生成跨越空白区的错误轮廓。

Figma 的 Cut 可以拖过一个或多个 path，并把分出的部分移入独立 layer；Figma Vector Network 的 region 可以包含多个连续闭合 loops，segment 本身无固定方向，loop traversal 可以反向。OpenDesign 据此需要从真实边界图分解闭合结果，而不是根据数组顺序或“一条轮廓恰好两个交点”的假设拼接。

参考：

- [Figma：Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- [Figma Plugin API：VectorNetwork](https://developers.figma.com/docs/plugins/api/VectorNetwork/)

## 决策

### Geometry Service v10 使用无向边界图

`cutVectorNetworkByLine` 保持同一纯数据入口。对每个唯一 outer region 或独立 closed contour：

1. 先在源精确 line/cubic 上求全部有限、横穿且去重的 intersections；重叠、tangent 与奇数交点继续失败。
2. 在修改 network 前记录 outer 第一个有向 vertex，作为稳定保留 component 的锚点。
3. 在每个 intersection 精确切开相关 contour，形成开放 boundary arcs；三次曲线继续使用 de Casteljau，原有未切 vertex/segment ID 不重写。
4. 每个 intersection 会产生两个重合但拓扑独立的 endpoint。通过 endpoint 所属 boundary arc 在切线哪一侧，给 endpoint 分类为 `-1/+1`。
5. 按切线顺序把相邻 crossing pair 的同侧 endpoint 连接，生成真实 connector。
6. boundary arc 与 connector 都作为可双向遍历的无向边进入临时 graph；cycle decomposition 生成全部连续 closed components，最终 path reference 的方向在 traversal 时确定。

包含稳定 outer 起点的 component 保留 source path/region ID。其余 components 获得宿主生成的稳定 path/region ID，并全部进入同一个 extracted Vector sibling；这让一个凹形四交点 Cut 可以产生一个 retained region 与两个 extracted regions，同时仍符合“分出部分进入独立 layer”的交互语义。

### 穿孔不再保留失效 hole

当切线同时穿过唯一 outer loop 和一个或多个 hole loops 时，outer arcs、hole arcs 与 cut connectors 进入同一个边界图。上下结果各自形成一个连续 single-loop region；原 hole path 不再作为 hole 附着在任一 sibling。未被切线碰到的 loops 继续按真实 point-in-closed-path 包含关系分配给完成后的 component，保持源 path ID、`reversed` 与 winding。

以下情况继续结构化拒绝且不写入 revision：

- 只切 hole、没有穿过 outer boundary；
- 无法确定唯一 outer loop、同一 loop 被多个 region 共享；
- tangent、overlap、奇数 crossings、self-intersection；
- connected/branching network。

### Runtime、Canvas、Agent 与 SVG 使用同一结果

EditorRuntime 继续负责 tight bounds、transform offset、sibling insertion、preview/apply、revision 和 undo；多层 document-space planner 继续逐层求 world transform inverse。Canvas Cut drag 只提交稳定 node IDs 与 document-space line，pan/zoom 只改变投影，不改变几何切线。人工完成后选择 retained + extracted sibling，并退出短生命周期 point-edit overlay。

`opendesign_edit_vector` 的输入 schema 不变。模型仍不能提交 network、结果 IDs、bounds 或 transform；可信宿主返回真实 intersection count、retained/extracted path IDs 和 result node IDs。direct-hole-only 等失败作为可恢复 tool result 返回，不允许模型用完整 network 重写来绕过。

每个结果仍是普通 Vector node，文档 schema 不变。SVG metadata v2 已能表达一个 node 内多个 paths/regions：穿孔结果导出两个各含一个标准 `Z` subpath 的节点；凹形结果的 extracted node 导出两个标准 `Z` subpaths。再导入必须恢复相同 editable networks，并可继续节点编辑。

## 验证

自动化覆盖：

- outer + hole 四交点重建为两个 single-loop editable regions；
- U 形凹轮廓四交点生成一个 retained component 与同一 sibling 中两个 extracted components；
- stable source path/region ID、connector、direction、winding 与未切 hole containment；
- direct-hole-only、歧义 outer、shared loop、tangent/overlap 的原子失败；
- Runtime preview/apply、tight bounds、单 revision、undo/redo、保存重开；
- Canvas selection/overlay 生命周期和 viewport pan/zoom 下 document-space line 稳定；
- Agent host 结果 IDs、实时 selection 隔离与结构化返回；
- 标准 SVG `Z` subpaths、metadata v2 与可编辑再导入。

## 当前限制

能力保持 `degraded`，因为 connected/branching network、connect/disconnect、套索、多节点变换框、flatten、outline stroke、正式 Slice、真实像素 baseline 和 macOS/Windows 打包产品 smoke 尚未完成。更复杂的嵌套 island/hole、重叠 regions 与 self-intersection 仍明确拒绝。

## 后果

- Cut 不再被“闭合轮廓只能有两个交点”限制，常见穿孔徽标、字形与凹形 Logo 可在同一人工/Agent 工具中完成。
- 正式文档中不会出现半截 boundary、被错误保留的 hole 或跨空白区 connector。
- OpenDesign 继续拥有 topology、revision 与失败语义；Canvas2D/Leafer 和 SVG 只是同一 network 的投影与交换格式。
