# ADR-0099：确定性交互命中区重叠与完全遮挡门禁

- 状态：Accepted
- 日期：2026-08-19
- Design Plan：`1`
- Layout Quality：`DesignLayoutQualityReport 5`
- 文档协议：不变
- 关联：ADR-0034、ADR-0050、ADR-0096、ADR-0097、ADR-0098

## 背景

当前 Plan 已显式声明实际 `interactiveNodeIds`，Layout Quality Report v4 也能检查命中区尺寸、安全区、画板 containment 和文字裁剪，但两个按钮的实际命中区可以互相覆盖，或者一个按钮可以被后绘制的不透明图层完全盖住，最终仍通过交付。两种情况都不是审美判断：在同一坐标触发多个动作，或已声明交互目标完全不可见，都是可由权威文档、变换和层序重放的交付错误。

同时，通用遮挡依赖 mask、blend、effect、形状轮廓、跨容器 paint order 和像素 alpha compositing，不能只用世界 AABB 猜测。首个切片必须保持窄而可证明。

## 决策

### Layout Quality Report v5

v5 保留 v4 的全部报告字段与门禁，并只对 UI Plan 明确列入 `interactiveNodeIds` 的节点新增三种 error：

- `interactive-target-overlap`：把每个实际命中区的本地矩形通过完整 world transform 投影为凸四边形，使用多边形裁剪计算真实相交面积；相交面积大于 `1` world unit² 时报告面积、相对较小目标的比例和另一目标 ID。仅 AABB 重叠、边缘接触和低于容差的浮点噪声不报告。
- `interactive-target-fully-occluded`：只在目标与遮挡层拥有同一个 parent，且遮挡层位于目标之后时检查。遮挡层必须是完全覆盖目标多边形的 Rectangle/Frame、零圆角、节点与祖先全可见且 opacity 为 1、具有未绑定的全不透明 solid fill，并且没有 effect style、实时 effects、mask 或非普通混合证据。遮挡层本身不能是另一个已声明交互目标。
- `interaction-geometry-unavailable`：命中区存在有限 AABB，但 world transform 产生退化或非有限四边形时失败关闭，不退回 AABB 猜测。

报告仍最多包含 128 个 issue。UI quality profile 最多声明 64 个交互目标，因此 pairwise 检查有固定上界；非 UI `graphic` target 不运行这些规则。

### 可信边界与恢复

Renderer 在 exact-revision capture 的同一个不可变文档上生成 v5 报告。Main 继续验证 report 的 document/revision/Page/Frame/profile 完全匹配；缺失或旧版报告失败关闭。初稿 capture 可把问题交给 typed review，refinement 后任何新增 error 都阻止 ledger 进入 `verified`。

重叠恢复要求移动或缩小实际 hit-area layer，使一个 pointer location 只对应一个动作。完全遮挡恢复可以移动、缩放、重排、隐藏或删除遮挡层。不能只移动按钮内部 icon，也不能把交互目标从 Plan 删除来绕过已经落地的质量身份。

## 明确不做

- 不从名称、图标、颜色、组件类型或 prototype connection 猜哪些节点可交互；
- 不判断部分视觉遮挡、文字可读性、焦点样式或 WCAG spacing exception；
- 不跨不同 parent 推导完整 paint order，也不把祖先 Group AABB 当成遮挡形状；
- 不对圆角、Ellipse、Vector、Path、Image、渐变、图片填充、变量/样式绑定、mask、effect 或复杂 blend 做“完全不透明”猜测；
- 不把像素 critic、视觉层级或审美判断放进 deterministic error。

这些能力需要独立的渲染证据或更完整的 compositing contract，不能扩大本规则的适用范围来追求表面覆盖率。

## 验证

- 两个 48×48 命中区真实相交时返回确定面积和比例；
- 只贴边时不报告；
- 旋转后 AABB 重叠但真实四边形不相交时不报告；
- 同 parent 的后绘制不透明矩形完全覆盖目标时阻断；
- 半透明、圆角和位于目标之前的 sibling 不冒充完全遮挡；
- 退化 world transform 返回 `interaction-geometry-unavailable`；
- v5 measurement 的 ratio、ID、proof 和 exact keys 在不可信输入边界完整校验；
- Main/Renderer capture fixtures、Coordinator final gate、typecheck 与普通桌面 build 继续通过。

## 复审条件

引入跨容器统一 paint-order projection、像素级 alpha/coverage evidence、prototype interaction graph、pointer spacing exception、圆角/矢量精确覆盖或用户可配置质量策略时复审。扩展必须带正反样例与误报基线，并升级报告版本。
