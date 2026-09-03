# ADR-0298：Figma-compatible 可编辑 Vector Eraser

- 状态：Accepted
- 日期：2026-09-03
- DesignDocument：不变
- 关联：ADR-0247、ADR-0258、ADR-0276、ADR-0293

## 背景

Figma 的 Vector edit mode 提供 Eraser，使用 `Shift+E`，并在 Inspector 配置 weight 与 shape。擦除会产生真实可编辑 vector points；一次横向擦断不会自动拆成多个 layer，拆层仍由独立 Split Vector 命令负责。

OpenDesign 已拥有唯一 Vector Network、PathKit 几何服务、Flatten 外观物化、多层原子事务和 Leafer Vector edit session。复用图片 AI Erase 会栅格化设计并引入远程等待；为 Eraser 新增独立 Agent tool 又会扩大工具面，均不符合现有架构。

## 决策

- Vector edit mode 新增 `eraser` 工具，快捷键为 `Shift+E`；Inspector 只暴露 brush weight 与 round/square shape。
- pointer gesture 使用 document-space points。提交前把目标当前 Fill、Stroke、dash 与 variable-width 外观物化为 painted Vector Network，再用 PathKit subtract brush footprint。
- 擦断产生的多个 contour 保留在原 layer 和同一 Network；完全擦空才删除原 layer。多层目标形成一笔 transaction、一个 revision 和一个 undo entry。
- overlay、gesture 和 pending 状态只属于 Leafer session，不进入 DesignDocument、history、capture 或 export。取消、工具切换、只读、revision/scope 变化和 callback 拒绝均清理预览并恢复权威投影。
- Agent 不增加工具，只扩展 `opendesign_edit_vector` 的 `erase` action；人工与 Agent 共用 `planVectorLayersErase()`。

## 边界

当前只擦除显式 editable Path/Vector。需要像素语义的 Image Erase 仍走独立图片编辑链；Eraser 不隐式 Split Vector，不处理依赖外部 backdrop 的合成语义。真实 macOS/Windows 打包产品的笔压、HiDPI 与长路径性能仍需实机验证。

## 验证

- Geometry 覆盖 round/square、click dab、连续 stroke、miss、擦断保持单 Network、Paint 保留和完全擦空。
- EditorRuntime 覆盖 Fill/Stroke 外观物化、多目标、锁定/不可逆/错误 Page 原子拒绝、删除、undo 与单 revision。
- Leafer 覆盖 pointer lifecycle、预览、单 callback、Escape/tool switch/read-only/rejection 清理。
- Desktop 覆盖 `Shift+E`、Inspector weight/shape、Agent Contract 精确字段路径和统一 Vector execution。
