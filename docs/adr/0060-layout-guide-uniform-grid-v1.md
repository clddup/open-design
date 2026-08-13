# ADR-0060：Layout Guide Uniform Grid v1

状态：已接受
日期：2026-08-14
范围：

- 文档协议：`DesignDocument 1.19.0`
- EditorRuntime、Inspector、Leafer 编辑辅助投影与内置 Agent

## 背景

UI、图标和海报设计需要不改变图层几何的参考网格。Figma 已把旧称 Layout Grid 的能力命名为 Layout Guide，并明确区分于会重排 child 的 Auto Layout Grid：前者是 Frame 上的视觉辅助，后者是二维响应式布局流。

OpenDesign 先交付前者的最小完整切片，避免把“显示 8pt 网格”和“二维 cell/span/reflow”混成一个字段或求解器。

## 决策

`Frame.properties.layoutGuides?: LayoutGuide[]` 持久化最多八个稳定 guide。v1 仅支持：

```ts
{ id, type: "grid", size, color, opacity }
```

- `size` 为 1–10000 px，guide ID 在同一 Frame 内唯一；每个 Frame/guide 最多投影 4096 条线；
- guide 不改变 child transform/size/order，不参与 constraints、Auto Layout、bounds、selection、history diff 之外的布局求解；
- Inspector 在选中 Frame 时提供添加、尺寸、颜色、不透明度和删除；所有写入经 `planSetFrameLayoutGuides` 与唯一 EditorRuntime 事务；
- Leafer 只在选中的 Frame 上把 guide 投影到内置 editor `sky` 的不可命中辅助层。pan/zoom、Frame transform/resize 时重算；切换选区或 Page 时清理；
- guide 不进入 Leafer document tree，因此离屏 capture、PNG/JPEG/WebP 与 SVG 导出不包含它；
- Agent 使用 `opendesign_arrange_layers action=set-layout-guides`。generic apply、insert、replace 不得写入 guide；
- `1.18.0 → 1.19.0` 只升级 schema，不为旧 Frame 发明 guide。

## 边界

Columns、Rows、stretch/fixed alignment、margin/gutter/offset、共享 guide style、吸附、标尺/手工参考线、baseline，以及 Auto Layout Grid 的 track/cell/span/reflow 均不属于 v1。双平台打包 GUI 和像素 baseline 仍待验收，布局能力保持 `degraded`。

## 验证

- schema、迁移、重复 ID 与密度预算；
- planner 的 Page/Frame/lock/no-op、preview/apply、save/reopen、undo/redo；
- Inspector add/edit/remove 与 Agent strict action；
- generic apply/update/insert/replace 旁路零 revision；
- Leafer overlay 不进入 document scene/capture/export，并随 viewport 与 Frame 几何更新。
