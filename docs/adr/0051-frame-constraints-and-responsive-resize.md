# ADR-0051：普通 Frame constraints 与响应式 resize

- 状态：Accepted
- 日期：2026-08-13
- 文档协议：`DesignDocument 1.12.0`
- 关联：ADR-0011、ADR-0036、ADR-0050

## 背景

OpenDesign 已有精确排列、组件实例和 Frame 直接 resize，但尚无持久的响应式布局语义。人工、Agent 或 Leafer 若只修改父 Frame `size`，子层保持原位置；若直接接受 Leafer 对整个子树的临时缩放结果，又会把一次交互偶然产生的几何当成布局规则，无法供 Inspector、Agent、保存重开或后续 Auto Layout 共用。

专业平台通常把普通 Frame 子层的 constraints 与 Auto Layout 子层的 sizing 分开：constraints 在父 Frame resize 时保持边缘距离、居中或比例；Auto Layout 再负责 direction、gap、padding、wrap、hug/fill/fixed。OpenDesign 必须先建立自有、可替换的普通 Frame constraints 语义，不能把 Leafer Flow 私有状态写入文档或直接跨越到一个不完整的 Auto Layout 实现。

## 决策

### `DesignDocument 1.12.0`

节点新增可选公共字段 `constraints`：

- horizontal：`left / right / left-right / center / scale`；
- vertical：`top / bottom / top-bottom / center / scale`。

字段只允许出现在 Frame 直属子层。省略表示默认 `left + top`，避免旧文档和普通绝对定位节点产生冗余数据。`1.11.0` 确定性迁移到 `1.12.0`，不擅自写入显式默认值。受信任事务可用 `constraints:null` 清除关系字段；持久节点不接受 `null`。

Group 与 Boolean 的 bounds 由后代决定，首版不得携带 constraints。Instance 可以使用只改变位置的 constraints；会改变尺寸的 constraint 明确拒绝。Auto Width/Auto Height 文字也不能被 stretch/scale，直到 hug/fill sizing 存在。

### 独立 Layout Service

新增无文档状态的 `@opendesign/layout-service contract v1`。它只接收：

- 前后父容器 size；
- 子层本地 axis-aligned rect；
- 两轴 constraints。

输出确定性新 rect 或结构化失败。它不读取 Renderer、Leafer、selection、viewport、Agent 状态或文件路径，也不直接修改文档。

### EditorRuntime planner

`planSetNodeConstraints` 与 `planResizeFrameWithConstraints` 是人工 UI、画布和 Agent 的共同入口。Frame resize 从权威 revision 递归求解嵌套 Frame，并把父 Frame 与所有受影响后代编译为一个 previewable `DesignTransaction`、一个 revision 和一个 undo。

constraints v1 只接受 translation-only 直属子层。旋转、倾斜、局部缩放、零尺寸父轴、锁定、超事务预算及前述不保真节点类型会在写 revision 前失败。Reparent 到 Page root 或 Group 时 planner 自动清除旧 Frame-relative constraints；undo 恢复原关系。

### 人工与 Agent 路径

- Inspector 在合法 Frame 直属子层上显示横/纵 constraints；
- Inspector 修改含子层 Frame 的 W/H 时使用 responsive planner；
- Leafer 单选 populated Frame resize 只提供用户期望的 Frame 新 size，宿主丢弃引擎对子树临时推导的 update，改由同一 planner 求解；失败则恢复权威投影；
- Agent 复用 `opendesign_arrange_layers` 的 `set-constraints` 和 `resize-frame` typed actions；
- 通用 `opendesign_apply_transaction` 不得直接 resize 已有子层的 Frame，宿主返回稳定恢复提示。

多选整体缩放继续是自由变换，不解释为响应式 Frame resize。Auto Layout、wrap、padding/gap、hug/fill/fixed、min/max、absolute child、layout grid 与 breakpoint 仍是后续独立协议，不能从 constraints v1 推断支持。

## 后果

- 普通多尺寸 UI 第一次拥有可保存、可撤销、人工与 Agent 一致的响应式基础；
- 画布直接 resize 不再形成第二套隐式布局算法；
- 新 package 和文档迁移增加维护与测试成本；
- 旋转子层等高级场景暂时显式拒绝，优先保证确定性和视觉不失真；
- `OD-UI-01` 仍未完成，必须继续实现 Auto Layout、Variants 与 Token/Variable 并完成双平台产品验证。

## 验证

- Layout Service 覆盖五种水平与五种垂直模式、缩小 clamp、非法与零轴输入；
- schema/migration 覆盖 `1.11.0 → 1.12.0`、严格枚举和 nullable command 清除；
- Runtime 覆盖嵌套 Frame、保存重开、undo/redo、锁定、旋转、Auto Size、Group/Boolean/Instance、事务预算与 reparent 清除；
- Inspector、Leafer 单 Frame resize 与 Agent set/resize 产生同构事务；
- Agent 通用 Frame size update 旁路被拒绝；
- macOS/Windows 打包 GUI resize 仍需按 roadmap 单独验收。
