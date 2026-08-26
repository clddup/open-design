# ADR-0169：SVG Appearance 与 Serialization Family 所有权

## 状态

已接受。

## 背景

Parse 与 import normalization 已从聚合 `svg.ts` 迁出。Paint/Gradient 的导入导出、Node opacity/visibility/blend/effect、Shape stroke，以及 XML-safe ID/number/matrix formatting 仍散落在聚合文件中。

这些逻辑同时被 Rectangle、Ellipse、Line、Path、Vector、Text、Frame 和 Boolean 分支调用。继续由各语义分支直接实现，会让 appearance fidelity、gradient definitions 和序列化标量规则随节点类型漂移。

## 决策

1. `svg-appearance.ts` 是 SVG appearance 的唯一 owner，负责：
   - Node opacity、visibility、blend、effect filter 与未配对 mask warning；
   - Shape fill/stroke、stroke cap/join/dash/alignment；
   - Solid、Linear/Radial/Angular/Image paint 的导出、降级和错误；
   - Gradient definition 收集、stop/geometry/rotation 导入和 `SvgShapeProperties` 组装。
2. 所有可绘制节点分支消费同一 appearance family；`svg.ts` 不保留第二份 paint、gradient、stroke 或 node appearance 实现。
3. `svg-serialize.ts` 是 serialize family 的起点，唯一拥有 XML-safe ID、有限精度 number 与 matrix attribute formatting。Appearance 与聚合 orchestration 均消费该实现，不复制标量序列化规则。
4. Appearance family 接受只含 DOM definitions/document、sequence 与 issue accumulator 的窄 context，不取得完整 Export/Import context，不选择节点 kind，也不遍历 DesignDocument。
5. 本切片不改变公共 SVG API、版本、gradient ID 顺序、颜色/opacity、stroke fidelity、effect/filter、mask warning 或失败语义，不增加兼容 facade。
6. Phase 9 继续开放。Root document/defs/title/XMLSerializer、fidelity 汇总和剩余节点/容器 orchestration 尚未迁入最终 owner。

## 结果

- 所有 shape 共享同一 paint/gradient/stroke 往返语义。
- Effect filter 和 mask-source fidelity 与普通 node appearance 一起管理。
- SVG-safe ID、number 和 matrix formatting 只有一个事实源，并可由后续完整 serialize family 直接扩展。
- `svg.ts` 收缩到约 2,200 行，但仍不是最终薄 orchestration。

## 验证

- Appearance 测试覆盖 Linear Gradient export/re-import、stop/rotation/opacity、Node visibility/blend 与未配对 mask warning。
- Serialize 测试覆盖精度、负零、非有限值、安全 XML ID 与 matrix attribute。
- 既有 SVG 回归覆盖所有已支持节点、Paint、Filter、Mask、Text、Vector 与 fidelity issue。
- Import/export package typecheck、定向 ESLint、Prettier 与 Desktop build 通过。
