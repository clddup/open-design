# ADR-0269：单层相对父容器对齐

## 状态

已接受。

## 背景

既有 Arrange 只允许至少两个图层，并按 selection 的 document-space bounds 对齐。单选图层只能手工填写坐标，无法使用 Figma 类编辑器常见的六向父容器对齐；直接复用父级 world AABB 又会在旋转或倾斜 Frame 下产生错误结果。

## 决策

1. Geometry Service contract 27 允许 `alignItems` 接收显式 target bounds；无 target 时保持既有多选语义。
2. 单选 Align 只接受直属 `Frame` 或 `Slot`，以 child 的 parent-local AABB 对齐到父级 `{ x: 0, y: 0, width, height }`，不把 local delta 再转换一次。
3. Page root、动态 Group/Boolean 父级、锁定层和非法几何失败关闭。Auto Layout flow child 继续由布局算法定位；`layoutPositioning: absolute` 的直属 child 可使用该能力。
4. 人工 Inspector 与 Agent 继续复用现有六个 Align action、同一 EditorRuntime planner、单 revision/undo 和 capability 判断，不增加专用工具或第二份文档状态。

## 影响

- 旋转、倾斜或缩放父级不会改变单层对齐的本地语义。
- 多选对齐、分布、间距与 Tidy up 的行为不变。
- Provider Schema 对 Align 的 `nodeIds` 最小数量改为 1；其他 action 的最小数量保持不变。
