# ADR-0232：Vector Region Fill

- 状态：Accepted
- 日期：2026-08-31
- DesignDocument：`1.48.0`
- Agent 协议：`3.13.0`
- Geometry Service contract：`15`
- 关联：ADR-0026、ADR-0027、ADR-0044、ADR-0231

## 背景

OpenDesign 已用稳定 vertex、segment、path 与 region ID 保存可编辑 Vector Network，但外观仍只能挂在整个 Vector node。一个 Vector 内的多个闭合区域无法拥有不同填充，人工和 Agent 只能拆层或改写完整 network，不符合专业矢量编辑的基本语义。

Figma 的公开 Vector Network 把 Fill 放在 `VectorRegion.fills`，而 `VectorSegment` 只描述端点与 tangents；局部 stroke cap/join/corner 属于 vertex 语义。因此本切片按 region 建模 Fill，不给 segment 发明 Paint，也不建立 Leafer 私有的持久结构。

## 决策

`DesignDocument 1.48.0` 为 `VectorRegion` 增加可选 `fills: Paint[]`，并保留三态：

- `undefined`：继承 Vector node 的 `fills`；
- `[]`：该 region 显式无填充；
- 非空数组：使用 region-local Paint。

迁移只提升 `1.47.0` 的 schema version，不给历史 region 写默认字段。所有持久 Paint 的资产、Variable、Library、诊断和 invariant 遍历统一包含 Text runs 与 Vector regions；图片 Paint 必须参与缺失资产校验、删除保护、替换、inspection 和依赖解析。

Geometry Service contract 15 增加 region 序列化和 `setVectorRegionFills`。Cut 重建 region 时，保留侧继续使用源 region ID，提取侧获得稳定新 ID，两侧都复制源 region Fill；开放结果或被破坏的 region 不保留无效 Fill。EditorRuntime 的 `set-region-fills` 是人工、Agent 和后续互操作入口共同使用的唯一事务语义。

Leafer 将一个 editable Vector 投影为 disposable Group：每个 region 是一个 synthetic fill Path，另有一个 synthetic stroke Path。synthetic children 只用于渲染和命中，不进入 OpenDesign document、history、save 或 export。Paint 工具点击 region 设置当前颜色，Alt 点击写入空数组；只读、取消和 no-op 不产生 revision。

受控 SVG editable-vector metadata 升为 v3，并保存 node-level fallback fills。存在 region-local Fill 时导出标准 region `<path>` 与一个携带完整 network metadata 的 source path；导入同时验证 stable region ID、数量和标准 path geometry，再恢复为一个 editable Vector。v1/v2 metadata 继续读取；metadata 超限时移除受控 container/source 标记，保留可见的标准 SVG paths，不让普通降级输出被误判为损坏的受控文档。

## 后果

- 同一 Vector 可以拥有多个独立 Fill region，且人工、Agent、Runtime、资产系统、Variable、Leafer 和 SVG 共用一份文档事实。
- node Fill 继续作为兼容 fallback，不需要给每个历史 region 填充重复 Paint。
- 多 region 渲染需要 disposable children，但选择、命中和增量更新必须始终映射回稳定 Vector node/region ID。
- 当前 SVG vector slice 仍显式拒绝 Image Paint；内部 region 图片资产可编辑、可替换且受 invariant 保护，但不能宣称已完成 SVG 图片填充往返。
- 本切片不包含 `fillStyleId`、vertex-local stroke cap/join/corner、嵌套或重叠 region 的完整交互、branching network、Flatten、Outline Stroke 或 Figma 文件导入导出。

## 验证

- Contract：三态 Fill、非法 Paint 路径和 `1.47.0 → 1.48.0` 无字段发明迁移；
- Geometry/Runtime：设置/清除、缺失 region、Cut Fill 传承、单 revision、undo/redo；
- Asset/Variable：region 图片引用的校验、删除保护、替换、inspection 与变量解析；
- Leafer/Canvas：多 region 投影、命中、Paint/Alt-clear、只读和 disposable synthetic children；
- Agent：同一 Vector Contract schema、typed execution 和 undo；
- SVG：v3 标准 region paths、editable round-trip、v1/v2 读取和超限安全降级。

## 参考

- Figma Vector Network：<https://developers.figma.com/docs/plugins/api/VectorNetwork/>
- Figma Stroke Cap：<https://developers.figma.com/docs/plugins/api/properties/nodes-strokecap/>
- Figma Stroke Join：<https://developers.figma.com/docs/plugins/api/properties/nodes-strokejoin/>
