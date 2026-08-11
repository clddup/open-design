# ADR-0039：版本化矢量拖拽 Cut 与独立结果图层

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：不变（`DesignDocument 1.10.0`）
- Service contract：`Geometry Service v7`
- 关联：ADR-0009、ADR-0012、ADR-0023、ADR-0026、ADR-0027、ADR-0037、ADR-0038

## 背景

ADR-0038 已完成点击 point/path 的 Cut，但专业矢量编辑器还允许用户拖一条切线穿过对象，把被分割的部分移动到独立图层。Figma 当前文档明确区分两种行为：点击创建 break；拖拽穿过一条或多条路径时，分割部分进入自己的 layer。官方演示进一步表明切线成为上下两块各自的真实边界，而不是留下两条开放弧线。

如果只把拖拽手势翻译成两次点击 Cut，会得到同一个 Vector node 内的开放 path runs，既没有独立图层，也会丢失被切面应有的闭合边；如果在 pointer move 中持续写文档，则会制造大量 revision、undo 和半成品状态；如果让模型直接提交新 network 或结果 node ID，又会绕过宿主稳定 ID、bounds、层级与权限边界。

参考：

- [Figma：Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- [Figma：Vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)

## 决策

### Geometry Service v7 拥有有限线切割语义

`cutVectorNetworkByLine(network, start, end)` 接收节点局部坐标中的有限切线，返回一份 retained network 和一份 extracted network。它不读取 viewport、selection、Leafer 对象、文档层级或历史。

当前受支持拓扑为同一个 Vector node 内一个或多个互不连接、非分支的闭合 contour：

- 直线段使用解析线线求交；三次曲线把相对切线的有符号距离展开为三次多项式并求所有有限实根；
- 只接受落在切线 segment 与 path segment 范围内的交点；共享 vertex 去重；
- 通过交点前后邻域的符号变化区分真实 crossing 与 tangency；路径与切线重叠明确拒绝；
- 每条被命中的闭合 contour 当前必须恰好有两个真实 crossing；零交点 contour 保持在 retained network；
- 两个交点落在同一 cubic 时先切 path 遍历方向上较后的交点，再把较前参数映射到已拆分的 segment，避免复用过期 `t`；
- 两个开放 piece 分别通过真实 connector 重新闭合。包含源 contour 第一个有向 vertex 的 piece 保留源 path/region ID，另一个使用宿主生成的稳定 path/region/segment/vertex ID；
- 源 contour 没有 region 时，两块都保持无 region，不能因为复用 Close helper 而发明 Fill；已有单 loop region 的 winding rule 与 reversed 语义同时复制给两块；
- 多条独立 contour 可在一次切割中处理，所有 extracted pieces 合并为一份独立 network。

当前明确拒绝 open contour、compound hole redistribution、连接或分支 network、切线重叠、无法稳定判断的 tangency，以及单 contour 多于或少于两个 crossing。失败不返回部分 network。

### EditorRuntime 一次提交两个 sibling layer

`planVectorSemanticEdit({ action: "cut-with-line" })` 是唯一文档写入口：

- 输入包含稳定 Page/node ID、节点局部 `start/end` 和由可信宿主提供的 `resultNodeId`；
- retained/extracted network 分别经过标准 normalize，计算 tight bounds 和节点局部 offset；offset 与原 transform 组合，旋转、缩放和镜像父级不靠模型手算；
- 原 Vector node 就地更新 retained piece，保持 node ID；新 Vector 复制原 kind、appearance、effects、opacity 与可见性，并紧邻原节点后插入；
- Boolean operand、锁定、缺失 parent、重复 result ID、Page scope、stale revision、无交点和不支持拓扑全部在写入前失败；
- preview 与 apply 使用同一条包含 update + insert 的事务，因此只有一个 revision、一个 undo，保存重开不会依赖 transient overlay。

文档 schema 不升级：`DesignDocument 1.10.0` 已能表达两个独立 Vector nodes 及其闭合 network。

### Canvas 把 click 与 drag 放在同一个 Cut 工具状态机

Cut（`X`）的 pointer flow 为：

- pointer down 只记录节点局部起点，不写文档；
- 屏幕距离小于 4 px 的 pointer up 沿用 ADR-0038 的点击 Cut；超过阈值后，pointer move 只更新短生命周期切线 overlay；
- overlay 存储 node-local start/end，并随权威 document tree、viewport、pan/zoom 与 DPI 投影，不把 screen/viewport/object 坐标混为一套；
- pointer up 才请求 Runtime 规划并原子提交；成功后退出单节点 Vector Edit，选择原层与新层，以新层为 anchor；
- 拖拽中按 Escape 只取消切线且产生零 revision，第二次 Escape 才退出 Vector Edit；pointer cancel、工具切换、Page 切换、read-only/lock 和 dispose 都必须清理 overlay；
- 用户平移或缩放画布不改变 document revision，也不改变已记录的节点局部切线；高频 pointer move 不重建正式场景。

### Agent 只提供检查所得目标和节点局部切线

`opendesign_edit_vector` 增加 `cut-with-line`。模型必须提供 inspect 所得稳定 `pageId/nodeId` 与节点局部 `start/end`；不得提交完整 network、result node ID、bounds、transform 或 selection。

Renderer host 从 `toolCallId + base revision` 生成有界、可重放的结果 node ID，调用与人工 Canvas 相同的 Geometry/EditorRuntime planner，先 preview 再原子 apply。结果只返回可信 `resultNodeIds/intersectionCount/retainedPathIds/extractedPathIds/revision/changes/warnings`。实时用户 selection 不参与目标解析，也不会被 Agent 工具修改。

### Render、保存与 SVG 继续消费标准 network

本切片不增加 Leafer 或 SVG fallback。两个结果节点都是普通闭合 Vector Network：

- Leafer 与 Boolean resolver 从各自 network/region 派生标准 path；
- 保存重开直接恢复两个 node，不保存切线 overlay；
- SVG 导出为两个标准闭合 `<path d="... Z">`，同时分别携带受控 editable-network metadata v2；
- SVG 再导入后仍是两个独立、可编辑且闭合的 Vector nodes。metadata 必须继续与标准 `d` 精确匹配。

## 验证

自动化覆盖：

- line/cubic crossing、同一 cubic 两交点、有限切线范围、vertex 去重、tangency、overlap、no-op 与退化切线；
- 单 contour、多独立 closed contours、真实 connector、源 path/region ID、winding/reversed、无 region 的纯描边语义和 compound hole 明确拒绝；
- Runtime tight bounds、旋转 transform offset、sibling 顺序、appearance 继承、锁定、Boolean operand、重复 ID、preview/apply、单 revision/undo/redo 与保存重开；
- Canvas click/drag 阈值、node-local guide、pointer-up commit、Escape 零提交、read-only、工具/Page 切换与 dispose；
- Agent schema、宿主结果 ID、Page mutation target、实时 selection 隔离和结构化结果；
- Leafer 闭合 path 投影，以及两个节点的标准 SVG `Z`、metadata v2 与再导入拓扑。

## 当前限制

- 当前一次手势只编辑一个 Vector node；Figma 式同时穿过多个独立 Vector layers 尚未实现。
- open stroke division、compound hole redistribution、单 contour 四次及以上 crossing 的凹形切割、self-intersection、连接/分支 network 尚未实现。
- Connect/Disconnect、Lasso、多节点变换框、Flatten、Outline Stroke 与 Slice 尚未实现。
- 真实像素 baseline 与 macOS/Windows 打包程序的指针、触控板、DPI 和性能交互仍待验收，因此 capability 保持 `degraded`。

## 后果

- 用户现在可以看到 Cut 拖拽 guide，并在松手后得到两个真正独立、可继续编辑的闭合图层；不是把两条开放弧线或截图冒充分割结果。
- 人工与 Agent 共用同一纯 Geometry 和单事务 Runtime 路径，selection、viewport 与第三方渲染对象不会成为写入事实。
- 后续可在同一 contract 上扩展多 Vector layer、open stroke、compound hole 与 concave 多交点，而无需升级当前文档 schema 或建立第二份场景状态。
