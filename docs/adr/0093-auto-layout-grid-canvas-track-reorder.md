# ADR-0093：Auto Layout Grid v3 的画布轨道重排

- 状态：Accepted
- 日期：2026-08-19
- 文档协议：`DesignDocument 1.35.0`（不变）
- Layout Service：Auto Layout contract v8 / Grid contract v2（不变）
- 关联：ADR-0053、ADR-0060、ADR-0091、ADR-0092

## 背景

Grid v2 已有权威二维轨道几何与 `planReorderGridTracks`，但人工操作只存在于 Inspector。专业设计平台需要让用户在画布上直接理解和重排轨道；若画布层自行替换数组或在 pointer move 连续写文档，就会绕过 span closure、row-auto-flow layer order、revision 与 undo。

Figma 的[公开 Grid 工作流](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow)在选中 Grid Frame 后于顶部和左侧显示轨道控制，并用 grabber 拖动轨道；拖动时用蓝色插入线预览目标位置，跨入相邻轨道的 cell object 会使关联轨道一起移动。公开 Plugin API 的 [`reorderRows`](https://developers.figma.com/docs/plugins/api/properties/nodes-reorderrows/) / `reorderColumns` 继续以原始顺序的 insertion index 表达同一语义。OpenDesign 对齐该用户工作流，不依赖私有 `.fig` 数据或 Figma 运行时。

## 决策

### 画布只持有可丢弃编辑会话

选中单个、可编辑、轴对齐的 Grid Frame 且工具为 Select 时，Leafer 内置 editor `sky` 显示行列边界以及顶部/左侧编号抓手：

- 轨道尺寸由固定 `@opendesign/layout-service` Grid solver 对当前权威文档重新求解，Fixed/Fill/Hug、padding、双 gap、可见 flow child 与自动行共用 Runtime 的输入语义；
- overlay、抓手、hover/drag 外观和插入线不进入 `DesignDocument`、revision、history、save、capture 或 export；
- 抓手保持近似固定屏幕尺寸，pan/zoom 时从 `viewport × Frame world transform` 重投影；不可逆、旋转、skew、镜像、锁定或当前无法求解的 Frame 失败封闭，不显示可操作抓手。
- 单个 Frame 的行列总数超过 512 时不创建数千个 sky 命中对象，继续使用 Inspector；后续 viewport virtualization 取代该保护门禁前，不把超大 Grid 描述为画布直接操作可用。

### pointer move 预览，pointer up 单事务

拖动会话冻结 `documentId + revision + frameId + axis + source index`：

1. pointer move 只在 editor sky 更新最近 insertion slot 和插入线，不写文档；
2. source 前后两个相邻 slot 都视为 no-op；
3. pointer up 只提交一个 `{frameId, axis, fromIndices, insertionIndex}` 语义请求；Renderer 调用既有 `planReorderGridTracks`，再由唯一 `EditorRuntime.apply` 形成一个 revision 和一个 undo；
4. span closure、Manual placement remap 与 row-auto-flow layer order 仍完全由 Grid v2 planner 处理，Leafer 不复制领域算法；
5. Escape、pointer cancel、选区/工具变化、文档 identity 或 revision 变化会丢弃会话且零 revision。Runtime 拒绝时保留权威文档并通过既有编辑错误通道反馈。

### 可访问性与平台边界

Inspector 现有的行/列上移下移按钮继续提供键盘可访问的同一 planner 入口，画布抓手不是唯一操作方式。命中区大于可见 pill，状态同时由抓取光标、pill 透明度和插入线表达，不只依赖颜色。macOS 与 Windows 共用同一 pointer/keyboard 代码；原生 GUI、触控板和高 DPI 仍需发布门禁实机验证。

## 明确未完成

本切片不实现轨道边缘 resize/Fixed 转换、多轨道 Command/Ctrl/Shift 选择、轨道删除、child 跨 cell 拖拽/交换、画布 span 拉伸、旋转 Grid 控件、canvas-only 键盘轨道导航、SVG Grid metadata、自动列或 responsive breakpoint。这些能力继续按独立垂直切片进入 Runtime 与画布，不能塞进 Leafer 私有状态。

## 验证

- 纯几何：Fixed/Fill 轨道、padding/gap、insertion slot、锁定/旋转/非法 child 失败封闭；
- Adapter：控件只在 editor sky，远端拖动回调一次，相邻 slot、Escape 与 stale revision 零回调；
- Renderer/Runtime：画布回调调用同一 planner，单 revision、单 undo，undo 恢复原轨道；
- 回归：Layout Guide、selection、vector/image edit、capture/export、Grid v1/v2 与 Inspector/Agent 入口不建立第二份状态。
