# ADR-0061：Layout Guide Columns / Rows v2

状态：已接受
日期：2026-08-14
范围：

- 文档协议：`DesignDocument 1.20.0`
- EditorRuntime、Inspector、Leafer 编辑辅助投影与内置 Agent

## 背景

Uniform Grid 适合图标和精细几何，但网页、移动端和编辑排版更常依赖列、行、margin 与 gutter。Figma 当前把 Layout Guide 明确定义为 Frame 上的视觉辅助，并区分于会建立 track/cell/span 并重排 child 的 Auto Layout Grid。

## 决策

`LayoutGuide` 在既有 `{ type: "grid" }` 之外增加 `columns` 与 `rows`：

- 固定型：`alignment: start | center | end`、`count`、`sectionSize`、`gutter`；start/end 另有 `offset`；
- Stretch 型：`alignment: stretch`、`count`、`gutter`、`margin`，section size 由当前 Frame 轴长确定性派生；
- `count` 为 1–4096；距离为有限非负值，固定 section 必须大于零；Stretch 的 margin/gutter 必须给每个 section 留出正尺寸；
- 所有 guide 延续稳定 ID、颜色、透明度、Frame 内最多八项与单 guide 4096 primitive 预算；
- Columns/Rows 在 Leafer editor sky 投影为裁剪在 Frame 内的半透明色带。它们不可命中、不改变 child、constraints、Auto Layout、bounds、selection 或导出；
- Inspector 支持从加号菜单新增三种 guide、切换类型/对齐并条件编辑字段；Agent 继续通过 `set-layout-guides` 替换完整有序集合；
- generic apply/insert/replace 旁路、锁定、错 Page、重复 ID、无效 Stretch 几何和 no-op 继续失败关闭。

## 边界

Guide Style、变量绑定、复制/粘贴 guide、全局或单项显隐、吸附、标尺与手工参考线、baseline，以及 Auto Layout Grid 的 track/cell/span/reflow 不属于 v2。Layout Service contract 仍为 v6，因为 Columns/Rows 不进入布局求解。

## 验证

- `1.19.0 → 1.20.0` 迁移不改写既有 Uniform Grid；
- 四种 fixed 对齐轴语义（Columns left/center/right、Rows top/center/bottom）与 Stretch resize；
- Inspector add/type/alignment/count/size/gutter/offset/margin/color/opacity/remove；
- Agent strict schema、generic 旁路、undo/redo/save/reopen；
- overlay 裁剪、pan/zoom/resize、不可命中以及 capture/export 隔离。
