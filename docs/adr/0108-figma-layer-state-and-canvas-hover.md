# ADR-0108：Figma-compatible Layer State 与画布 hover 投影

- 状态：已接受
- 日期：2026-08-20
- 文档协议：`DesignDocument 1.36.0`
- Component Service：contract v6
- 关联：ADR-0009、ADR-0045、ADR-0090、ADR-0107

## 背景

ADR-0107 已统一 Canvas、Layers、Inspector 与键盘的选择身份，但 Layers 行仍把删除与 lock/visibility 并列为常驻动作，行 hover 也没有在 Canvas 上给出与当前 revision 对应的完整轮廓。历史 Leafer native hover chrome 曾产生不完整的“半个方框”，而 Component Instance 派生层又不能把 projection ID 当成持久目标。结果是图层状态、当前选择和画布反馈仍与 Figma 的公开心智模型不一致。

Figma 的公开帮助将 Layers 行 hover 映射为 Canvas 蓝色轮廓，并把 `visible`、`locked` 作为正式 SceneNode 状态；隐藏或锁定时对应图标持续可见。`Command/Ctrl+Shift+H` 与 `Command/Ctrl+Shift+L` 分别切换可见性和锁定。Figma Plugin API 的 `NodeChangeProperty` 也把 `visible` 与 `locked` 纳入 Instance override 的字段集合。

参考：

- [Figma：Select layers and objects](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects)
- [Figma：Lock and unlock layers](https://help.figma.com/hc/en-us/articles/360041596573-Lock-and-unlock-layers)
- [Figma：Toggle visibility to hide layers](https://help.figma.com/hc/en-us/articles/360041112614-Toggle-visibility-to-hide-layers)
- 固定 `@figma/plugin-typings 1.133.0` 的 `SceneNodeMixin`、`InstanceNode.overrides` 与 `NodeChangeProperty`

## 决策

### Figma 是默认设计交互标准

OpenDesign 对成熟的设计器基础交互默认采用 Figma 的公开心智模型，不为差异化另造 Layers、selection、lock、visibility 或快捷键语义。OpenDesign 的产品差异化集中在 AI 需求理解、真实设计步骤、组件判断、自动审查修正和持续编辑。文档事实、事务、revision、history 与渲染后端仍由 OpenDesign 拥有，不复制 Figma 私有实现或文件格式。

### lock 与 visibility 是正式状态

普通持久图层继续通过一个 `DesignTransaction` 更新 `locked` 或 `visible`；多选快捷键每次只产生一个 revision 和一个 undo。Instance 派生层通过 `instanceId + sourcePath` 写 Component override，不直接修改 Main clone 或 Leafer projection。`ComponentOverridePatch` 增加可选 `locked`，Component Service v6 在当前 revision 解析并应用它；`visible` 沿用同一 override 链。

`DesignDocument 1.36.0` 接受上述 optional override 字段。`1.35.0` 文档确定迁移到当前版本，不猜测或补写 override。产品尚未正式发布，不保留旧 Component Service 双路径。

### Layers 行内动作

Layers 行内只保留 lock 与 visibility；删除继续由 Delete/Backspace、工具栏、画布就地操作及对象菜单承载，不常驻挤占行宽。未锁定且可见时图标可在 hover/focus/selection 出现；已锁定或已隐藏状态必须持续可见，隐藏行同时降低文字权重。状态不能只靠颜色表达。

### hover 是 session-only 投影

Layers pointer hover 只产生短生命周期 `nodeId`，或派生层的 `instanceId + sourcePath`。它不进入 `DesignDocument`、selection、revision、history、save、capture 或 export。Leafer adapter 每次 sync 在当前 Page/revision 重新解析目标，并用独立不可命中的 `render-path` stroker 绘制完整轮廓。

以下情况立即清除 hover：目标缺失或不可见、目标已选中、工具不是 Select、进入 Vector/Image Crop 编辑、Page/Document 身份变化或 adapter dispose。该 stroker 不复用 Leafer native hover chrome，也不参与 Agent cursor/reveal。

## 验证

自动化至少覆盖：

- 普通与 Instance 派生 Layers 行的 hover 身份；
- 当前 revision 上普通节点与派生 projection 的完整 render-path stroker；
- selected、hidden、missing、tool/edit-mode 与 identity change 清理；
- 普通多选 lock/visibility 快捷键的一事务、一 revision、一 undo；
- 派生层 lock/visibility override、Main fallback、reset、保存重开与渲染/导出；
- 隐藏行和持久状态图标，以及 Layers 行不再常驻删除；
- macOS `Command` 与 Windows `Control` 快捷键等价行为。

## 后果

Layers、Canvas 与 Inspector 对 lock/visibility 使用同一事实，hover 只是一份可丢弃的当前 revision 投影，不会制造第二份状态。剩余工作包括组件派生层更多 Figma 允许字段、对象菜单、复杂大树虚拟化，以及 macOS/Windows 打包产品的视觉与键盘 smoke；不得用 projection ID 持久化或恢复旧 native hover chrome 补齐这些缺口。
