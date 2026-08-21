# ADR-0116：Component 派生布局质量与确定性越界修复

- 状态：Accepted
- 日期：2026-08-21
- DesignDocument：不变（`1.36.0`）
- Component Service：`6`（公共投影能力扩展，不改变持久协议）
- Layout Quality Report：`6`
- 关联：ADR-0034、ADR-0075、ADR-0097、ADR-0107、ADR-0108

## 背景

Frame capture 的确定性布局门禁过去只遍历 `DesignDocument.nodesById` 的持久子树。Component Instance 的 Main 子层由 Component Service 在当前 revision 临时解析并交给 Leafer 渲染，不进入文档；因此截图可以已经把 Instance 内容裁掉，而 Layout Quality Report 仍只看见持久 Instance shell 并允许交付。生产日志中的 Logo/App Icon 样张同时证明，单纯向模型报告 artboard overflow 会增加恢复往返，却不保证模型执行有效修复。

修复不能把派生 projection ID 写回文档，也不能让 capture 隐式修改画布。越界恢复必须继续通过显式、可撤销的 EditorRuntime 事务，并区分可确定扩容与会改变布局语义的结构修复。

## 决策

Component Service v6 增加只读 `projectComponentInstances`：它在当前 revision 物化 Component Main properties 与全部可解析 Instance subtree，并为派生节点返回稳定的 `instanceId + sourcePath + sourceNodeId` provenance。投影文档和映射都是可丢弃结果；原始 Instance、Main、override、selection、history 与保存协议不变。既有严格导出物化继续在任何 resolution issue 上失败封闭。

`DesignLayoutQualityReport v6` 在 exact-revision Frame capture 中使用同一 Component 投影：

- artboard containment、可见 Text 枚举与 production-provider 文字证据都遍历真实渲染子树；
- 每个派生可见节点沿父链收集 artboard 以内所有 `clipsContent` Frame/Slot，并以完整裁切链的有效交集检查实际 world bounds；
- 被内部裁切的派生内容产生 blocking `component-node-clipped-by-ancestor`，报告 capture-only projection node ID、完整相关 ancestor IDs、几何证据，以及可用于重新 inspect/override 的稳定 `componentTarget`；
- Component resolution 失败产生 blocking `component-instance-resolution-failed`，不能因派生层缺席而获得“干净”报告；
- Agent 不得把 projection node/parent ID 当成持久事务目标。

`opendesign_arrange_layers repair-overflow` 是显式恢复事务。宿主重新诊断当前 Page/Frame，只对 translation-only、未锁定、非 Auto Layout 的持久 Frame/Slot 扩展右/下 trailing edge，保持现有内容 world position，并把全部安全扩容合并为一次 revision/undo。交付 artboard 使用同一规则。以下情况失败封闭并要求 inspect 后结构修复：左/上 leading-edge overflow、rotate/skew/scale、Auto Layout、locked、超出尺寸预算，以及只能通过修改投影 Component Main 才能解决的裁切。

存在确定性 error 的 capture 不再进入 Visual Review，也不把 refined target 立即抛成终止式布局错误。Coordinator 返回 `reviewWorkflow.nextAction = repair-layout-overflow` 与精确工具/Page/Frame；成功修复后必须重新 capture，只有 error count 为零才允许 review/verified。

## 后果

- 用户不会再看到 Instance 内容已被裁掉、交付状态却声称完成。
- 可安全扩容的常见右/下越界无需模型猜坐标，也不浪费一次无效视觉自评；修复在 history 中可见并可一次撤销。
- capture 保持只读，Runtime 仍是唯一写入口；Component projection、provenance 和文字测量不进入文档或保存。
- 本切片不自动改变 Component Main 的全局尺寸，不处理 leading-edge 重定位，也不把审美质量伪装成几何门禁。独立视觉 critic、生成 rubric 与 Pattern/Style Reference 继续作为后续质量切片。

## 验证

- Component 投影：稳定 projection ID、`instanceId + sourcePath` provenance、resolution issue 与既有严格 materialization 回归；
- Layout Quality：Instance root/child 越过持久 clipping Frame、完整 ancestor chain、严格报告 schema 与 exact revision；
- Text：Instance 派生 Text 使用 production provider 产生 projection-ID measurement；
- Repair：普通 artboard trailing overflow、持久内部 clipping Frame 一次扩容、单 transaction/revision/undo，以及 unsafe/no-op 失败；
- Coordinator：error capture 返回 repair action，不进入 Visual Review；清洁 recapture 才恢复既有 verified 流程。
