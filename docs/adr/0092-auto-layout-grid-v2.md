# ADR-0092：Auto Layout Grid v2 的自动行与 span-aware 轨道重排

- 状态：Accepted
- 日期：2026-08-18
- 文档协议：`DesignDocument 1.35.0`
- Layout Service：Auto Layout contract v8 / Grid contract v2
- Figma compatibility baseline：`@figma/plugin-typings 1.133.0`
- 关联：ADR-0053、ADR-0055、ADR-0057、ADR-0059、ADR-0091

## 背景

Grid v1 已建立二维显式轨道、cell/span、Manual 与 row-auto-flow 的权威事务语义，但固定容量要求调用方预先计算行数，内容增删时也不能保持自然回流。直接替换 rows/columns 数组则无法同步跨轨道 child、row-auto-flow layer order、history 与失败恢复。

Figma 公共 Plugin API 1.133.0 提供 `gridAutoTracks: ROWS`、`reorderRows` 与 `reorderColumns`。其轨道重排以原始顺序的 insertion index 为准，命中跨轨道 child 时自动纳入完整 span，并返回所有原轨道的 `{from,to}` 映射。OpenDesign 采用相同公开语义，但文档、事务、revision 与几何继续由 OpenDesign 持有。

## 决策

### 自动行是版本化文档事实

`DesignDocument 1.35.0` 在 Grid Auto Layout 增加可选 `autoTracks: "rows"`：

- 只允许与 `itemsPositioning: "row-auto-flow"` 同时使用；Manual Grid 继续要求显式 cell；
- 初始至少保留一行，内容超出容量时最多扩展到 4096 行；
- 新行按 Figma 默认创建为 Fill 1fr；删除、隐藏或移出 flow 后裁掉未占用尾行，但至少保留一行；
- 自动 Fill 行与垂直 Hug 存在确定冲突，因此 planner、文档 invariant 与 solver 都失败封闭；
- Runtime 将求解后的 effective rows 写回权威文档，因而 diff、history、undo/redo、保存重开与后续事务读取同一事实。

旧 `1.34.0` 文档只升级版本，不发明 `autoTracks`。Grid v1 的显式行行为保持不变。

### 轨道重排是单一领域 planner

`planReorderGridTracks` 接受 Frame、axis、`fromIndices` 与基于原始轨道顺序的 `insertionIndex`：

1. 对乱序和重复 `fromIndices` 去重并排序；越界、空输入或非法 insertion 整体失败且零 revision。
2. 若可见 flow child 的 span 与已选轨道相交，递归纳入整个 span，直到集合稳定。
3. 被选轨道保持原相对顺序，剩余轨道保持原相对顺序；planner 返回所有轨道的完整 `{from,to}` 映射。
4. Manual Grid 在同一事务内更新 track 数组与 child anchor，span 和 cell alignment 保持不变。
5. row-auto-flow Grid 在同一事务内重排 track 数组与对应 flow child 的 layer order，使下一次纯函数求解重现移动后的内容顺序；absolute、隐藏和非参与 child 的槽位保持稳定。
6. 命令数超过事务上限时整体拒绝，不拆成多个半完成 revision。

Inspector 的上下移动与 Agent `reorder-grid-tracks` 均调用该 planner。UI 不通过普通属性数组替换模拟轨道重排。

### Figma interop 与失败边界

- `autoTracks: "rows"` 双向映射为 `gridAutoTracks: "ROWS"`；缺省映射为 `NONE`。
- movement map 与官方 `GridTrackReorderEntry` 的 `{from,to}` 结构一致。
- 自动行仍只支持 Figma 当前默认的 Fill 1fr；本版不增加私有 auto-row template。
- Leafer 继续只投影 Runtime 求解后的 transform/size，不持有 Grid 或轨道重排状态。

## 明确未完成

Grid v2 不支持自动列、自定义自动轨道模板、dense/column auto-flow、baseline、画布 cell/track 拖拽手柄、SVG Grid metadata、响应式 breakpoint，或 macOS/Windows 打包 GUI 实机证据。这些能力不得通过 `extensions`、CSS Grid 状态或 Leafer 私有对象提前模拟。

## 验证

- solver：自动扩展/裁剪、span 扩行、Fill 1fr、Manual/Hug 冲突与 4096 上限；
- Runtime：effective rows 写回、span-aware 行列重排、row-auto layer order、非法输入零 revision、undo/redo/save/reopen；
- UI/Agent：Inspector 自动行模式、禁用直接行增删、typed Agent 事务与完整 movement map；
- interop：固定 Figma Plugin API typings 下 `ROWS/NONE` 双向映射；
- 回归：Grid v1 显式轨道、线性 Auto Layout、Layout Guide 与通用 Agent apply 旁路边界保持不变。
