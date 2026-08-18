# ADR-0091：Auto Layout Grid v1 的二维轨道、单元格与事务内回流

- 状态：Accepted
- 日期：2026-08-18
- 文档协议：`DesignDocument 1.34.0`
- Layout Service：Auto Layout contract v7 / Grid contract v1
- Figma compatibility baseline：`@figma/plugin-typings 1.133.0`
- 关联：ADR-0053、ADR-0055、ADR-0056、ADR-0057、ADR-0058、ADR-0059、ADR-0060、ADR-0061

## 背景

线性 Auto Layout、Wrap 和 Layout Guide 已能表达一维内容流与视觉辅助，但专业 dashboard、卡片矩阵、产品列表和跨列 Hero 需要真正的二维布局。Layout Guide 不改变 child 几何，不能充当 Auto Layout Grid；把 CSS Grid、Figma 节点或 Leafer Flow 私有状态直接保存进文档也会破坏 OpenDesign-owned 事务与可替换投影边界。

Figma 公共 Plugin API 当前公开 `layoutMode: GRID`、rows/columns、独立 gap、`FIXED/FLEX/HUG` track、manual/row-auto-flow positioning，以及 child anchor/span/alignment。OpenDesign 采用同类公开产品语义，但由自有 schema、纯函数 Layout Service 和唯一 EditorRuntime 持有事实。

## 决策

### 版本化文档语义

`DesignDocument 1.34.0` 在 Frame/Slot `properties.autoLayout` 增加 `mode: grid`：

- 四边 padding、`rowGap`、`columnGap`；
- 至少一条 row 与 column，最多各 4096 条；
- track 为 `fixed(px)`、`fill(fr)` 或 `hug`；
- `itemsPositioning` 为 `manual` 或 `row-auto-flow`；
- Frame 两轴继续使用 Fixed/Hug；Hug 轴禁止 Fill track；
- direct flow child 可持久化 `gridPlacement`：0-based row/column、正整数 span，以及 start/center/end/auto 单元格内对齐；
- `layoutSizing` 的 Fixed/Fill 继续决定 child 自身是否填满 grid area，min/max 继续在最终尺寸上 clamp。

旧 `1.33.0` 文档只升级版本，不发明 Grid。`gridPlacement` 离开 Grid parent、切回线性 flow、变为 absolute 或关闭 Auto Layout 时清理。Manual Grid 的每个可见 flow child 必须有显式 cell；row-auto-flow 按稳定 `childIds` 做 row-major 排布并把权威解析结果写回 placement。

### 确定性 Grid solver

`@opendesign/layout-service` Grid contract v1 是无状态纯函数：

- Fixed track 使用像素值；Fixed Frame 轴把扣除 padding、gap、Fixed/Hug 后的非负空间按 fr 权重分给 Fill tracks；
- Hug track 从占用它的 child intrinsic size 推导；跨多个 Hug track 的不足空间确定性均分；
- span area 包含内部 track gap；Fixed child 按单元格对齐，Fill child 填满 area 后应用 min/max；
- Manual placement 对越界和重叠失败封闭；row-auto-flow 按 layer order 找下一个可容纳 span 的空 area；容量不足明确失败；
- Frame Hug 由轨道、gap 与 padding 得出，再应用 Frame limits 与 padding minimum。

本版不自动创建 row。显式 tracks 容量不足时失败，防止把未实现的 `gridAutoTracks: ROWS` 伪装成普通 row-auto-flow。

### Runtime、人工与 Agent

EditorRuntime 把 Grid 纳入现有 deepest-first、Auto Height Text 重测和有界 fingerprint 收敛；insert/delete/show/hide/reorder/reparent、Frame resize、preview/apply、undo/redo 与保存重开共享同一几何事实。Leafer 继续只投影最终 transform/size，不获得 Grid 状态。

Inspector 提供 Grid 模式、自动/手动 item positioning、track 增删与 Fixed/Fill/Hug 编辑、双 gap、padding、Frame sizing，以及 child cell/span/alignment。所有修改经 `planSetFrameAutoLayout`、`planSetNodeGridPlacement`、layout sizing/limits planner 进入单一 Runtime。

Agent 复用 `opendesign_arrange_layers` 的 `set-auto-layout` 与新增 `set-grid-placement`；generic apply 插入或修改 `autoLayout/gridPlacement/layoutSizing` 继续失败封闭。`@opendesign/figma-interop` 把 Grid 映射到固定官方 typings 的 `GRID`、`FIXED/FLEX/HUG`、`MANUAL/ROW_AUTO_FLOW`、anchor/span/alignment，并明确输出 `gridAutoTracks: NONE`。

## 明确未完成

Grid v1 不支持自动增删 row、row/column reorder、自动 track 类型模板、dense/column auto-flow、baseline、canvas cell drag/reorder handles、SVG Grid metadata 或双平台打包 GUI 实机证据。Figma 的 `gridAutoTracks: ROWS`、`reorderRows`、`reorderColumns` 紧接本 ADR 作为 Grid v2，不得通过 extensions 或调用方手算坐标提前模拟。

## 验证

- schema/migration：严格 track/cell/span union、未知字段拒绝、`1.33.0 → 1.34.0` 无发明迁移；
- Layout Service：Fixed/fr/Hug、双 gap、padding、span、Fill、alignment、Manual overlap/out-of-bounds、row-auto-flow 与容量不足；
- Runtime：启用、reflow、layout sizing、cell swap、preview/apply、undo/redo/save/reopen 与 nested convergence；
- UI/Agent：Inspector 与 typed arrange tool 使用同一 planner，generic apply 旁路失败；
- interop：固定 Figma Plugin API 类型映射保持精确字段和值域。
