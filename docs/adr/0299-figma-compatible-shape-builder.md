# ADR-0299：Figma-compatible Shape Builder

- 状态：Accepted
- 日期：2026-09-03
- DesignDocument：不变
- 关联：ADR-0247、ADR-0258、ADR-0293、ADR-0298

## 背景

Figma 的 Vector Edit mode 提供 Shape Builder：点击提取一个由重叠轮廓形成的区域，`Option/Alt` 点击减去该区域，拖过多个区域则合并。该能力直接服务 Logo、Icon 与插画，不能退化成对整层执行普通 Boolean，也不应新增一个只供 Agent 使用的细碎工具。

OpenDesign 已拥有唯一 Vector Network、固定 PathKit provider、多层 Vector edit session、EditorRuntime 事务和宿主生成的稳定结果 ID，可在不修改文档协议的前提下完成这一垂直切片。

## 决策

- Vector Edit 工具条新增 `shape-builder`。点击为 Extract，`Option/Alt` 点击为 Subtract，拖拽为 Merge；不发明快捷键或额外 Inspector 设置。
- Geometry Service 先把同父级 Vector 的当前 painted geometry 投影到 document space，再通过 PathKit 分割为可独立命中的连通原子区域。一次点击只命中一个连通区域，拖拽按轨迹收集区域。
- Extract 创建一个宿主命名的 editable Vector sibling；Subtract 只移除命中区域；Merge 只接受外观一致的多个区域，避免宿主猜测 Paint 归属。源层更新、删除和结果插入组成一个事务、一个 revision 和一个 undo entry。
- overlay、gesture 与 pending 状态只属于 Leafer session，不进入 DesignDocument、history、save、capture 或 export。取消、工具切换、只读、scope/revision 变化和 callback 拒绝均零写入并恢复权威投影。
- Agent 不新增工具，只扩展 `opendesign_edit_vector` 的 `shape-builder` action；人工和 Agent 共用同一 Geometry/EditorRuntime planner。

## 边界

当前只处理显式 editable Path/Vector 的 painted regions，并要求目标同父级。需要外部 backdrop、无法无损物化的效果、混合 Paint 合并、锁定目标和不可逆变换均在事务前失败。真实 macOS/Windows 的 HiDPI 命中、复杂长路径性能与打包产品交互仍需实机验证。

## 验证

- Geometry 覆盖 Extract/Subtract/Merge、重叠原子区域、断开 component 独立命中、Paint 保留、混合 Paint 拒绝、miss 与歧义失败。
- EditorRuntime 覆盖 document-space 变换、同父级顺序、源层更新/删除、结果插入、stale/锁定/错误 Page/跨父级/不可逆变换原子拒绝及 undo。
- Leafer 覆盖 click、`Option/Alt` click、drag、pending 防重、Escape、只读与 callback rejection。
- Desktop 覆盖统一 Vector Contract、准确 `/points` 错误路径、Canvas 提交和 Agent 原子执行。
