# ADR-0154：Figma-compatible Wrap Fill 子层

- 状态：Accepted
- 日期：2026-08-25
- DesignDocument：`1.46.0`
- Layout Service：contract `10`
- 扩展：ADR-0056、ADR-0057、ADR-0153

## 背景

OpenDesign 已支持 Horizontal Wrap、Min/Max、主轴 Auto gap 与 wrapped rows 的交叉轴自动分布，但仍拒绝 Wrap 内任何 Fill child。这个限制会阻止常见的响应式卡片、筛选条和“达到最小宽度后换行、进入当前行后填满剩余空间”的设计。

Figma 的 Wrap 只适用于 Horizontal Auto Layout。其 child 主轴 Fill 由 `layoutGrow: 1` 表达，交叉轴 Fill 由 `layoutAlign: "STRETCH"` 表达；Min/Max 决定 child 能否进入当前 row。Figma 公共说明也明确展示了为 Wrap child 设置 Fill container 与 minimum width 的响应式用法。继续把全部 Fill 关闭不是保守兼容，而是缺少专业布局能力。

该切片只改变可信宿主的确定性布局，不增加 Provider 请求、视觉 Critic 或动画等待。首稿质量继续由 authoring、结构和视觉复核保证，不能用低质占位换速度。

## 决策

### 文档与迁移

继续复用已有 child `layoutSizing.horizontal/vertical: fixed | fill` 与 `layoutLimits`，不为 Wrap 增加私有字段。`DesignDocument 1.46.0` 记录求解语义变化；`1.45.0` 迁移只提升 schema version，不重写节点、尺寸或布局字段。

### 主轴 Fill 与分行

Horizontal Wrap contract 10 按以下顺序求解：

1. Fixed child 以 clamp 后的固定宽度作为 flex basis。
2. Horizontal Fill child 以 `minWidth` 作为分行 basis；未设置时为零，`maxWidth` 仍限制 basis。
3. 按文档 child 顺序和固定/自动 packed gap 贪心分行；超宽单项继续单独 overflow，不丢失。
4. 每个 row 独立把扣除 padding、固定 child 和 packed gaps 后的非负空间，通过既有 bounded Fill 分配给该 row 的 Fill children。
5. Min/Max 使用 water-filling 重分配；达到 max 后剩余空间保留给 alignment/Auto gap，不跨 row 借用宽度。
6. Fill 后的 Auto gap 只消费该 row 仍然存在的非负自由空间。

因此 child 可以用 `minWidth` 决定何时换行，并在进入 row 后填满该 row 的可用宽度；不同 row 不建立隐式列宽关系，固定列系统应继续使用 Grid Auto Layout。

### 交叉轴 Fill

- 单个 Vertical Fill child 拉伸到所在 row 的高度；Fixed siblings 继续按 Frame `counterAlignment` 对齐。
- 当所有可见 flow children 都是 Vertical Fill、Frame 高度 Fixed 且 `counterAxisAlignContent` 为 `auto`/缺省时，wrapped tracks 平分扣除 padding、固定 counter gap 和最小 row heights 后的非负剩余高度，等价于 Figma `AUTO` 的 stretch 情形。
- `counterAxisAlignContent: space-between` 优先保持 rows 的内容高度，把自由空间分配到 rows 之间，不同时拉伸 track。
- Hug height 不能包含 Vertical Fill child，避免 parent Hug 与 child Fill 的循环依赖；现有失败语义保持。

### 人工 UI 与 Agent

Properties Inspector 不再为 Wrap child 禁用 Fill container；Horizontal 与 Vertical sizing 继续调用既有 typed `set-layout-sizing` planner。Min/Max 仍由同一 Layout Limits 区设置。没有新增 Wrap 专用 UI 状态或旁路写入。

Agent Arrange 契约直接复用权威 Auto Layout、Layout Sizing 与 Layout Limits schema，并明确说明 Fill minimum basis、row-local bounded distribution 和 counter-axis stretch。模型只提交语义和稳定 ID，坐标与尺寸由 Layout Service / EditorRuntime 派生。

### Figma interop

`@opendesign/figma-interop` 增加 Wrap child 公共字段映射：

- `layoutSizing.horizontal: fill` ↔ `layoutGrow: 1`
- `layoutSizing.vertical: fill` ↔ `layoutAlign: "STRETCH"`
- Fixed ↔ `layoutGrow: 0` / `layoutAlign: "INHERIT"`

Figma 已废弃的 child-specific `MIN/CENTER/MAX` counter alignment 不进入 OpenDesign child schema；遇到时明确失败，Frame 级 `counterAxisAlignItems` 继续作为唯一对齐事实。该 adapter 证明公共字段可往返，不声明已经完成 Figma 文件导入导出。

## 后果

- 响应式卡片可用同一 Wrap Frame 表达“最小宽度触发换行，当前行自动铺满”。
- Inspector、Agent、Runtime、save/reopen、undo/redo 与 Figma 公共 child 字段共用既有 `layoutSizing/layoutLimits` 事实。
- 不增加模型往返或逐层审查，因此不会以速度换质量，也不会拖慢首个真实画面。
- Fill rows 仍是 flex-like row-local 语义；需要跨行对齐、固定列或统一轨道时应使用 Grid，而不是伪造 Wrap 列。
- Vertical Wrap 不属于 Figma 公共模型，不再作为追赶项；baseline、canvas spacing/reflow handles、Grid 自动列/更多自动轨道与 breakpoint 继续独立推进。

## 验证

- Fixed + Fill 与多个 Fill child 按 min-width 分行，并在每 row 内经过 Min/Max bounded distribution。
- 单个 Fill child 在新 row 填满可用宽度；不同 row 不共享列宽。
- Vertical Fill child 拉伸到 row；全部 Vertical Fill + Fixed height + AUTO 时 tracks 拉伸，space-between 时不拉伸。
- Hug width、Hug height + Vertical Fill、非法输入在 revision 前失败。
- Runtime preview/apply、save/reopen、undo/redo 与嵌套收敛保持确定性。
- Inspector 显示两个 Fill container 入口；Agent typed sizing 可在 Wrap 中成功提交。
- Figma `layoutGrow/layoutAlign` 往返，非法 grow 与 deprecated child alignment 明确拒绝。

## 参考

- [Figma Plugin API：layoutWrap](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutwrap/)
- [Figma Plugin API：layoutGrow](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutgrow/)
- [Figma Plugin API：layoutAlign](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutalign/)
- [Figma Plugin API：layoutSizingHorizontal](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutsizinghorizontal/)
- [Figma Learn：horizontal and vertical flows in auto layout](https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout)
