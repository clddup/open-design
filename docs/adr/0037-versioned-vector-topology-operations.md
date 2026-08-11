# ADR-0037：版本化单轮廓路径拓扑操作

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：不变（`DesignDocument 1.10.0`）
- Service contract：`Geometry Service v5`
- 关联：ADR-0005、ADR-0009、ADR-0012、ADR-0021、ADR-0023、ADR-0026、ADR-0027

## 背景

`DesignDocument 1.10.0` 已能表达稳定 vertex/segment/path/region ID、开放或闭合 path run 与 closed fill region。Pen 可以在创建时完成开放或闭合轮廓，已有 Vector 也能编辑节点、手柄、point mode 与删除，但用户和 Agent 仍不能在创建后切换开放/闭合或反转路径方向。让模型或 React UI 直接重写整个 network 会破坏稳定 ID、手柄、region winding、bounds、revision 和撤销语义，也容易把开放路径交给 Canvas/SVG 隐式闭合填充。

Figma 把 Vector Network 的路径拓扑和节点操作视为正式编辑能力；OpenDesign 需要先建立可复用的宿主几何语义，再继续 Cut、多轮廓和连接操作。

参考：

- [Figma：Vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- [Figma：Edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- [Figma：Convert text to vector paths](https://help.figma.com/hc/en-us/articles/360047239073-Convert-text-to-vector-paths)

## 决策

### Geometry Service v5 拥有纯拓扑语义

`@opendesign/geometry-service/vector-edit` 增加不持有文档状态的 `setVectorPathClosed(network, closed)` 与 `reverseVectorPath(network)`：

- 当前只接受一条非分叉 contour；分支、多轮廓和不连续 path 明确失败；
- Close 至少需要三个顶点，使用确定性的 `segment_edit_N` 增加末点到首点的 closing segment，并使用 `region_edit_N` 建立 `nonzero` closed region；
- smooth/mirrored 端点已有单侧 handle 时，closing segment 的对应 handle 由宿主镜像推导；
- Open 删除 path 最后一条 closing reference/segment，并删除依赖该 path 的 region；
- Reverse 反转 path references 并切换每条 reference 的 `reversed`，同时反转 region loop 并切换其 `reversed`，保持有效 winding；
- 被保留的 vertex/segment/path ID 不重写，两次 Reverse 必须完全恢复；
- 已满足目标状态返回稳定 `no-op`，不制造 revision。

这些操作不要求升级 `DesignDocument`：现有 `1.10.0` schema 已完整表达输入和输出，虚增迁移版本不会提供兼容价值。

### 开放 contour 的 Fill 只来自显式 region

Vector Network 的 Fill 只作用于 `regions`。开放 path 没有 closed region 时：

- Leafer projection 使用 `fill: null`；
- Boolean resolver 不把该 contour 作为 fill geometry；
- 标准 SVG 输出 `fill="none"`；
- 节点自身的 Fill 配置继续保留，重新 Close 后可恢复显示。

不得依赖 Canvas 或 SVG 对开放 path 的隐式直线闭合。stroke 仍沿开放 path 正常绘制。

### 人工与 Agent 复用唯一 EditorRuntime planner

`planVectorSemanticEdit(document, pageId, nodeId, edit)` 负责：

- 验证 Page、稳定节点 ID、Vector Network、继承锁定与受支持拓扑；
- 调用 Geometry Service v5；
- 重新计算 tight bounds，并把局部 offset 合并到原 transform；
- 生成一条可 preview、原子 apply、单 revision、单 undo 的 `DesignTransaction`；
- 保持保存重开、undo/redo 和自动保存读取同一权威文档。

Canvas Vector Edit 工具条提供 Open/Close 与 Reverse；完成后保持路径编辑模式、选区和画布焦点。锁定或不支持的 topology 显式禁用，不在组件内复制几何算法。

公共 Agent tool `opendesign_edit_vector` 只接受 inspect 所得稳定 `pageId/nodeId`、`set-closed | reverse-path` 和用户可读 label。模型不能提交完整 network、closing segment/region ID、实时选区或自行换算的 bounds。Renderer 使用同一 planner preview 后一次提交；stale、scope、lock、no-op 和 topology 失败返回结构化可恢复结果。

### 投影、Boolean 与 SVG 共用同一 region 事实

Leafer、PathKit Boolean 和 SVG 导出都从同一个经过 schema/topology 校验的 network 派生 path。Open/Close/Reverse 不建立第二份 path 字符串事实；受控 SVG editable-network metadata v2 继续往返 network，标准 `d` 与 metadata 必须匹配。

## 验证

自动化覆盖：

- Close/Open/Reverse、稳定 ID、handle 推导、region winding、两次 Reverse 恢复与 no-op；
- Page/锁定/不支持 topology、tight bounds、transform offset、preview/apply、单 revision、undo/redo 和保存重开；
- 人工工具条键盘/焦点/禁用状态，以及 Agent schema、执行、stale 和 scope；
- 开放 contour 在 Leafer Fill、Boolean fill geometry 和标准 SVG 中不被隐式闭合；
- 受控 SVG metadata 往返。

## 当前限制

- 仅支持一条非分叉 contour；Cut、connect/disconnect、分支、多轮廓、lasso 和多节点变换框尚未实现。
- flatten、outline stroke 与 Slice 仍是后续产品命令，PathKit 的底层计算能力不等于人工或 Agent 工作流已完成。
- 真实像素基线、macOS/Windows 打包程序的指针、键盘、DPI 与 SVG 外部 consumer 对照仍未完成，因此矢量编辑 capability 保持 `degraded`。

## 后果

- 人工和 Agent 以同一版本化语义修改路径拓扑，不再重建完整 network 或依赖当前选区。
- 开放路径不会因为渲染后端默认行为意外出现填充，Close 后仍能恢复原有外观配置。
- 稳定几何 ID、文档 revision、history、保存和 SVG 往返保持一致。
- 下一步可以在相同边界内依次增加 Cut、connect/disconnect、多轮廓/分支、flatten 与 outline stroke，而不用推翻当前文档或 Runtime。
