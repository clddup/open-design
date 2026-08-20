# ADR-0107：Figma-compatible selection 与组件派生目标

- 状态：已接受
- 日期：2026-08-20
- 文档协议：`DesignDocument 1.35.0`（无版本变化）
- Component Service：contract v5
- 关联：ADR-0009、ADR-0045、ADR-0063、ADR-0067、ADR-0106

## 背景

OpenDesign 已拥有唯一 `DesignDocument`、`EditorRuntime` 与 Leafer 当前 revision 投影，但普通图层、Layers 面板和 Component Instance 派生层曾使用不同的选择边界。Instance 内部节点只存在于可丢弃投影；若把 projection ID 写入文档、history 或持久 selection，就会在 Main 更新、Variant 切换、Slot override、undo/redo 或 reopen 后变成悬空身份。若所有命中又都折叠成外层 Instance，用户无法按 Figma 的常用方式检查和编辑内部 override。

Figma 的公开选择交互把 Canvas、Layers panel 与键盘视为同一选区的不同入口：Canvas 默认选择当前层级对象，双击或 `Enter` 逐级进入，`Shift+Enter` 返回父层，`Tab` / `Shift+Tab` 遍历同级，macOS `Command` / Windows `Control` 点击可直接选择深层对象，`Escape` 清空；Layers panel 可直接命中深层，并用 `Shift` 连续选择、`Command` / `Control` 离散切换。

参考：

- [Figma：Select layers and objects](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects)
- [Figma：Guide to components](https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma)
- [Figma：Use slots to build flexible components](https://help.figma.com/hc/en-us/articles/38231200344599-Use-slots-to-build-flexible-components-in-Figma)

## 决策

### 一个权威 SelectionState

Canvas、Layers panel、Inspector 与快捷键只读写 `EditorRuntime` 的同一个 `SelectionState`。普通图层继续使用持久 `nodeIds` 与 `anchorNodeId`。Layers panel 单击替换，`Shift` 按当前可见树范围连续选择，macOS `Command` / Windows `Control` 离散切换；Canvas 和键盘使用逐级进入、返回父层、同级遍历和清空语义。任何入口都不得另建 Renderer-local 可写选区。

### 派生 Component layer 使用稳定临时目标

`SelectionState.componentTarget` 只保存：

- 持久 `instanceId`；
- Component Service v5 解析出的稳定 `sourcePath`。

projection ID、Leafer object、派生 transform 和派生 node clone 都不得进入 `SelectionState`、`DesignDocument`、history 或保存文件。Leafer metadata 只负责把当前 revision 的命中回映到上述身份；Layers panel 也从同一 resolver 构造可展开的派生树。

Slot override 内存在持久 nested Instance 时，nested Instance 拥有其内部派生目标；外层 Instance 不得窃取 owner。Main 中普通 nested Instance 的派生后代仍由当前外层持久 Instance 承载 override。这一归属由 resolver 明确返回，不从节点名称、projection ID 或 Inspector 位置猜测。

### revision 校验与失败行为

每次 `setSelection`、事务提交、replace、undo 与 redo 后，Runtime 都在当前权威文档上重新解析 `instanceId + sourcePath`。目标仍存在时保留；Main/Variant/source 删除或重构使其失效时，确定性退回外层持久 Instance。重新打开文件时从空的 session selection 开始，不从文档猜回派生目标。

### 可写范围

派生层只允许 Inspector 通过既有 Component override planner 修改受支持字段，并继续产生正常 transaction、revision 与 undo。派生 transform、删除、复制、层级移动、Boolean、导入目标及直接导出保持禁用；这些操作必须先作用于持久 Instance、Main 或先 detach。Canvas 尝试移动派生层时恢复权威投影，不生成伪事务。

## 迁移与兼容

`componentTarget` 属于短生命周期 Editor session，不改变 `DesignDocument`，因此文档协议不升级，也不增加旧文档迁移。产品尚未正式发布，不保留旧的 projection-ID selection 或双路径 fallback。Component Service contract 从 v4 升为 v5；所有消费者必须使用显式 selection owner/path。

## 验证

自动化至少覆盖：

- Layers panel replace/range/toggle 与 Canvas/Runtime 共享 selection；
- 普通图层 `Enter`、`Shift+Enter`、`Tab` 与 `Shift+Tab`；
- Instance 派生树按稳定 source path 命中并在 Inspector 显示安全 override；
- Slot override 内 persistent nested Instance 拥有自己的派生 child；
- revision 后保留有效 target，source 删除后退回 Instance；
- undo/redo 重新校验，不恢复悬空 projection ID；
- 派生层直接 transform 和危险命令不会误操作外层 Instance；
- Canvas projection 多选去重时不会把多个派生层错误折叠成一个 component target。

## 后果

OpenDesign 的交互标准与 Figma 的公开选择心智模型对齐，但文档事实、事务、revision、history 和渲染后端边界仍由 OpenDesign 拥有。剩余工作包括真实 macOS/Windows 产品 smoke、图层 hover 到画布的完整轮廓反馈、跨文件 Library/publishing 和更大规模图层树性能；这些缺口不得通过持久化投影对象或建立第二份选区状态绕过。
