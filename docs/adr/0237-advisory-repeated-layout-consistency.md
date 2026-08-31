# ADR-0237：重复 UI 图层的建议性对齐与间距诊断

- 状态：Accepted
- 日期：2026-08-31
- DesignDocument：不变
- Layout Quality Report：`7`
- 关联：ADR-0034、ADR-0096、ADR-0099、ADR-0116、ADR-0200

## 背景

重复卡片、列表项和工具按钮出现单个对齐或间距异常时，画面会显得松散且不专业。Figma 的 [Tidy up](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions) 与 [Smart selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection) 只在用户已表达选择意图后整理图层；它们不会把任意自由构图推断为唯一正确布局。Figma 也允许像素网格带来的 `1px` 舍入差异。OpenDesign 的离屏质量报告没有用户选择上下文，因此不能把这类推断升级成阻塞交付的确定性错误。

已有 Auto Layout 与 Grid 由 [明确布局语义](https://help.figma.com/hc/en-us/articles/360040451373-Explore-auto-layout-properties) 驱动，应该由 Layout Service 求解，不能再从最终坐标反推一次。Logo、海报等 Graphic 交付也可能有意采用不规则节奏。

## 决策

`DesignLayoutQualityReport` 当前唯一技术契约版本更新为 `7`。版本号只用于跨边界协议校验，不进入产品 UI，也不保留并行兼容路径。

exact-revision Frame capture 增加窄范围、只读的重复布局一致性诊断：

- 只扫描显式 `ui` quality profile；Graphic 不参与。
- 只比较同父级、同节点类型、世界尺寸按像素取整后一致的至少四个可见兄弟节点。
- 只接受无旋转、无倾斜、正向缩放的一维序列；相邻项不得重叠，另一轴必须真实相交。
- 父容器启用 linear、Wrap 或 Grid Auto Layout 时不扫描，继续以权威 Layout Service 为准。
- 使用 `1px` tolerance。只有其余值形成唯一众数且恰好一个值异常时，才报告 `repeated-layer-spacing-outlier` 或 `repeated-layer-alignment-outlier`。
- 报告包含 actual、expected、delta、axis、tolerance、peer node IDs 与 confidence，便于模型确认例外或使用既有 align、distribute、spacing、Tidy planner 修正。
- 两类结果在 Contract 层强制为 `warning`；不得阻止 capture、review、verified 或用户普通编辑。

本切片不自动移动节点，不增加 Agent 工具，不产生 revision，也不根据单个截图推断任意二维网格或审美意图。

## 后果

- 高置信的重复 UI 节奏错误能随现有 capture 进入同一结构化证据链，无需新增 Provider 往返。
- 用户仍可保留有意的不规则构图；推断结果不会成为新的流程门禁。
- Auto Layout、Grid、旋转对象、Graphic 和多异常自由构图保持不猜测。
- 该能力只能改善局部一致性，不能替代独立视觉评审、固定样张盲评或真实审美判断。

## 验证

- 正例：水平/垂直重复项中的唯一 spacing 或 start-alignment 异常，包含准确 measurement、peer IDs 与 confidence。
- 反例：`1px` 舍入、少于四项、多异常、二维/重叠构图、Graphic、Auto Layout、Grid 与旋转对象不报告。
- Contract：两类推断伪造成 `error` 或使用错误 measurement 时稳定拒绝。
- Main/Renderer：advisory warning 穿过 exact Frame capture，不改变 revision，也不阻止后续 review。
