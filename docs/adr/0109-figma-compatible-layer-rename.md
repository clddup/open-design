# ADR-0109：Figma-compatible Layer Rename v1

状态：已接受

## 背景

OpenDesign 已让 Canvas、Layers panel 与快捷键共享唯一 Runtime selection，也已有普通节点 `update_properties.name` 和 Instance 派生节点 `ComponentOverridePatch.name`，但人工图层重命名仍缺少完整工作流。只在 Inspector 暴露通用 name 字段无法覆盖高频的 Layers 就地命名、多选编号、查找替换、预览与一次撤销，也容易让 Renderer 另建临时写入路径。

Figma 的公开 Rename Layers 行为提供产品参照：单层名称可直接编辑；macOS `Command+R`、Windows `Ctrl+R` 对当前选区打开 Rename Layers；多层操作支持 current-name、升序/降序编号、Match/Replace、Regular Expression 和提交前 preview。该参照不改变 OpenDesign 对文档、事务、revision 与 UI 边界的所有权。

## 决策

- Layers 中的普通层和单个 Instance 派生层支持双击名称或 `F2` 就地编辑，`Enter`/blur 提交、`Escape` 取消，composition 期间不提交。普通层经 Layer controller 规划 `update_properties.name`；派生层只以稳定 `instanceId + sourcePath` 写 name override，projection ID 不进入文档或 history。
- `Command/Ctrl+R` 在 Editor 内拦截浏览器 reload，并在存在有效选区时打开批量重命名窗口。普通多选保留 Runtime selection 的稳定顺序；当前 SelectionState 只能表达一个组件派生目标，因此 v1 只支持单个派生层，不伪造多个 projection target。
- `@opendesign/editor-runtime` 提供纯 `previewLayerRenames` 与 `planRenameLayers`。Rename 输入包含可选 Match、literal/regular-expression 模式和 Rename To template；`{name}`、`{n}`、`{N}` 分别表示当前名称、升序编号与降序编号，正则替换保留标准 `$&`/capture group 语义。空名称、超过 256 字符、非法表达式、缺失节点、错误 Page 与 no-op 明确失败。
- 普通多选的所有名称通过一个 `DesignTransaction` 应用，形成一个 revision 与一个 undo entry。窗口冻结打开时的 document revision；期间任何文档事务都会使提交失败并要求基于当前 revision 重新打开，不能把旧 preview 静默套到新文档。
- 通用 Modal shell 在 `@opendesign/ui` 内包装仓库既有 Base UI Dialog，统一 Portal、Backdrop、Escape、pointer dismissal、focus lifecycle 与 ARIA；Renderer 只组合 OpenDesign UI API 和业务 `Component.module.scss`，不得直接依赖 `@base-ui/react` 或重写弹窗基础设施。既有 `ConfirmDialog` 复用同一 shell。

本切片不升级 `DesignDocument`，不增加兼容分支。右键 Layers context menu、AI Rename Layers、跨多个 Instance 派生目标批量命名和远程 Library 名称同步仍是后续能力；在具备完整菜单信息架构或多派生目标 Selection contract 前，不以孤立菜单项或 Renderer-local projection 数组绕过。Canvas Frame label 双击已由 [ADR-0203](0203-top-level-canvas-frame-labels.md) 后续实现，并直接复用本 ADR 的单目标 rename workflow。

## 验证

自动化覆盖 token 顺序、literal/regex replacement、非法表达式、空名称、no-op、Page ownership、普通多选单 revision/undo、Layers inline Enter、Modal preview/validation/Escape，以及 Editor `Command+R` 端到端提交。macOS/Windows 的原生键盘布局、IME、焦点恢复和打包产品视觉仍需分别 smoke，不能由 DOM 自动化替代。

## 参考

- [Figma：Rename Layers](https://help.figma.com/hc/en-us/articles/360039958934-Rename-Layers)
- [Figma：View layers and assets in the Layers Panel](https://help.figma.com/hc/en-us/articles/360039831974-View-layers-and-assets-in-the-Layers-Panel)
- [Figma：Rename layers with AI](https://help.figma.com/hc/en-us/articles/24004711129879-Rename-layers-with-AI)
