# ADR-0270：Figma-compatible 普通图层翻转

## 状态

已接受。

## 背景

OpenDesign 已支持 move、resize、rotate、skew 与多种排列命令，但普通图层缺少 Figma 常用的水平/垂直翻转。若把翻转建模为节点布尔属性，会产生第二套几何事实，并让嵌套变换、SVG 导出、Auto Layout 回流与 Leafer 直接操作出现分支逻辑。

## 决策

1. 翻转继续使用节点现有 2D affine `transform` 表达，不增加文档字段或迁移。Geometry Service contract 29 只提供纯 reflection matrix；EditorRuntime 负责选择分析、world/parent-local 转换、Group/Boolean ancestor normalization 与单事务命令。
2. 单选围绕自身 local transform box 中心翻转；普通多选围绕统一 document-space selection AABB 中心翻转。不同父级通过各自 parent world inverse 转回本地矩阵；ancestor 与 descendant 同时选中时只处理顶层目标。
3. Auto Layout flow child 保留布局 slot，只反转自身 orientation；布局求解继续拥有位置和尺寸，并在后续回流中保留轴对齐 `±1` orientation。absolute child 同样保留翻转；旋转、skew、非单位绝对 scale 仍失败关闭。
4. 人工入口为 `Shift+H`、`Shift+V`、Toolbar 菜单以及 Canvas/Layers 共用的右键菜单。普通 Instance 根节点可翻转；Component 派生层继续遵守既有 override 边界。
5. Agent 复用现有 Arrange tool 的 `flip-horizontal` / `flip-vertical` action 和同一 Runtime planner，不增加细碎专用工具、第二份文档状态或 Run 所有权限制。

## 影响

- 两次同轴翻转恢复原 transform；每次操作只有一个 revision/undo，节点尺寸、层级顺序和组件引用不变。
- Leafer 投影与普通直接变换继续消费同一矩阵；SVG 保留负 determinant matrix，不把翻转栅格化或展平。
- 锁定、错误 Page、缺失节点、不可逆 parent transform、事务预算和 stale revision 继续结构化失败关闭。
- 本 ADR 不声称已完成 transform origin、智能吸附、参考线、标尺、像素对齐或双平台打包产品人工交互验收。
