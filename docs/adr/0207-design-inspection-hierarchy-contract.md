# ADR-0207：Design Inspection Hierarchy 单一契约

## 状态

已接受。

## 背景

每次 Plan、existing-artboard 修改和恢复都先把 Renderer inspection 解析为 Main 的 `InspectedHierarchy`。该 parser 此前同时手写对象识别、Page/Node/Component 字段、ID、size、transform、父子一致性、环检测、component catalog 和错误文案；同一结构既没有 executable Schema，也只能用泛化的“hierarchy invalid”反馈。

## 决策

1. `DesignInspectionHierarchySchema/Contract` 唯一拥有 Main 计划注册实际消费的 inspection hierarchy projection：observed revision、Run ID allocation、document identity、Page roots、Node hierarchy/geometry、Component definitions 与 reusable catalog。
2. Schema 负责字段类型、ID/数量预算、tuple transform、非负 size、closed allocation/catalog 和 collection item 结构。Document/Page/Node projection 保留 `additionalProperties:true`，因为变量、样式、字体、图片与诊断由各自 owner 管理，本契约不得抢占或丢弃它们。
3. Domain refinement 只负责 document/revision/Run correlation、map key identity、父子双向关系、Page root、parent cycle，以及组合 ID allocation/component catalog 的既有 domain Contract。
4. Parent cycle 使用一次线性遍历并把 issue 总量限制为 64，避免大文档错误路径本身形成二次方工作或无界结果。
5. `design-inspection-parser.ts` 只消费成功 Contract 并投影 Map/Set；旧 `recordValue/safeHierarchyId/validInspectedSize/validInspectedTransform` 和逐字段错误分支全部删除。
6. Contract 首错通过 `design_workflow.inspection_invalid` 保留准确 path/recovery。失败不注册 Plan、不写画布，重新 inspection 后可恢复。

## 结果

- Provider 看见的 inspection 与 Main 实际接受的 hierarchy 不再依赖隐藏手写结构规则。
- malformed transform、节点 identity、parent、cycle、Page root、catalog 与 Run allocation 都能指向真实嵌套字段。
- 其他 inspection 能力继续由各自 Contract 演进，不形成一个吞并全部领域的巨型 schema。

## 验证

- Renderer 真实 inspection 结果通过 Contract 并进入 Coordinator。
- tuple transform 结构错误定位到具体 Node transform。
- Node/map identity、missing parent、cycle 与跨 Run allocation 返回稳定 code/path。
- reusable component catalog 错误保留完整 `/content/document/componentCatalog/...` 路径。
- Coordinator、Renderer design-tool execution、Plan 注册和 existing hierarchy 回归通过。
