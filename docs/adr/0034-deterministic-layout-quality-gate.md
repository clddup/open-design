# ADR-0034：确定性布局质量报告与交付门禁

- 状态：Accepted
- 日期：2026-08-12
- 文档协议：不变（`DesignDocument 1.8.0`）
- 关联：ADR-0018、ADR-0028、ADR-0030

## 背景

模型对截图的主观 review 可能遗漏明确的几何错误，例如底部导航、文字或装饰层大面积越出交付画板，随后仍把 target 描述为“已完成”。这类问题不能继续依赖提示词、自评或用户是否刚好把活动 viewport 移到错误位置；同时，启发式审美评分也不能伪装成确定性的文档 invariant。

OpenDesign 已拥有权威 `DesignDocument`、世界坐标几何、Run 绑定的 Page/Frame capture target、精确 revision 和持久交付账本，因此应在截图审查链路中增加独立的只读布局质量报告。该报告不修改文档、不创建第二份布局状态，也不依赖 Renderer 的活动 pan、zoom、选区或窗口尺寸。

## 决策

### 三层质量边界保持分离

设计质量按不同可信度分层处理：

1. 文档结构与渲染输入诊断：检查空 Path/文字、缺失 asset、非有限 bounds、无可见外观、根层碎片等事实；
2. 确定性布局质量：从权威文档与明确交付 Frame 计算可复现几何规则，确定性 error 可以阻止 `verified`；
3. 像素、语义与审美 critic：评价可读性、层级、构图张力、独特性和素材融合，必须标注其启发式或模型来源，不能冒充确定性 error。

当前切片只完成第二层的首批规则，不把它描述为审美已经解决。

### `DesignLayoutQualityReport v1`

`@opendesign/editor-runtime` 提供纯函数 `diagnoseDesignTargetLayout(document, pageId, artboardFrameId)`。报告绑定：

- `documentId + revision`；
- 明确 `pageId + artboardFrameId`；
- 已检查节点数、error/warning 数和有界 node-specific issues；
- 稳定 code、严重级别、node ID、相关 Frame、消息和可选越界面积比例。

首批规则为：

- 目标缺失、不是 Frame、错 Page、不可见或画板几何无效：error；
- 可见正面积节点完全越出画板：error；
- 节点至少 25% 面积越出画板：error；
- 节点有 1%–25% 面积越出画板：warning；
- `clipsContent=false`：warning；
- 0.5 文档单位容差与低于 1% 的溢出不报告，避免浮点边缘噪声；
- 继承隐藏或零 opacity 的节点不参与；Group 本身不作为绘制面积重复计数，其可见后代仍检查；
- issue 列表最多 128 项，超过预算时以 `quality-scan-truncated` error 失败关闭，不能因为截断漏掉后续 error 而通过。

warning 只表达需要模型 review 的风险，不阻塞首版交付。确定性规则只使用文档世界坐标与节点几何；它不读取截图像素，也不把 viewport 当作设计内容。

### Capture 与 Main 信任边界

Main 继续选择 Run 的可信 capture target。Renderer 从用于离屏 capture 的同一个不可变文档快照计算 Frame 报告，并与图片 attachment 一起返回。Page baseline capture 当前不生成 Frame 布局报告。

Renderer 返回值仍是不可信跨进程数据。Main 必须运行时验证完整报告，并要求其 `documentId/revision/pageId/artboardFrameId` 与实际 capture 完全一致；缺失、畸形或身份不匹配返回稳定的 `design_workflow.layout_quality_unavailable`，不得降级为“没有发现问题”。

初次 material capture 即使包含 error 仍推进到 `captured`，让模型基于真实图片和 node-specific 报告记录 review 并修正。refinement 后的最终 capture 在完成现有 exact-revision inspection 与结构验收后检查报告：只要 `errorCount > 0`，返回 `design_workflow.layout_quality_failed`，账本保持 `refined`，模型必须修正、重新 inspect 并 capture；warning-only 报告允许进入 `verified`。相同失败不得原样盲重试。

### 后续扩展

安全区、导航语义、文字真实 shaping/截断、触控区、异常遮挡、对齐、间距和可证明的 overlap 规则需要各自的明确语义与误报基线，再扩展相同版本化报告或升级版本。像素对比、视觉 critic、专业固定样张和人工盲评保持独立门禁。

## 后果

- 明确的画板越界不再能仅靠模型口头 review 通过最终交付。
- 用户在生成期间 pan、zoom、切换文件或改变选区不会改变布局报告与 capture target。
- 报告只读并复用唯一文档事实、现有几何与交付账本，没有第二份可写布局状态。
- 当前仍不能确定性判断所有重叠、文字可读性、视觉层级或审美质量；这些限制继续在路线图中明确保留。
