# ADR-0053：线性 Auto Layout v1 与事务内自动回流

- 状态：Accepted
- 日期：2026-08-13
- 文档协议：`DesignDocument 1.13.0`
- Layout Service：linear Auto Layout contract v1
- 关联：ADR-0036、ADR-0045、ADR-0051

## 背景

普通 Frame constraints 只能定义父 Frame resize 时直属子层如何固定、居中、拉伸或缩放，不能表达按钮、导航、列表和卡片内部的内容流。仅在 Inspector 点击时执行一次排列也不是 Auto Layout：新增、删除、隐藏、文字测量、重排或 resize 后若不会自动回流，文档保存的仍然只是静态坐标。

Figma 当前把 Auto Layout 的专业语义拆为容器 flow、padding/gap/alignment，以及 child fixed/hug/fill sizing；进一步支持 wrap、auto gap、min/max、ignore-layout child 与 grid。OpenDesign 先建立自有的线性 fixed-size 基础，并要求所有事务入口共享自动回流，不能把 Leafer Flow 私有对象写入公共文档或只为 Inspector 增加一次性排列命令。

## 决策

### `DesignDocument 1.13.0`

Frame `properties.autoLayout` 新增严格 union：

- `mode: none`：明确关闭 Auto Layout；省略同样表示普通 Frame；
- `mode: horizontal | vertical`：线性流；
- 四边 `padding.top/right/bottom/left`，范围 `0..1_000_000`；
- 固定非负 `gap`；
- `primaryAlignment` 与 `counterAlignment`：`start / center / end`。

旧 `1.12.0` 文档确定性迁移到 `1.13.0`，不自动发明 Auto Layout。规则属于 Frame properties，不属于 Renderer session、extensions 或 Leafer 场景。

流内直属子层不得同时携带普通 constraints。启用 Auto Layout 时，专用 planner 在同一事务中清除既有 constraints；拖入流 Frame 的层同样清除。后续 ignore-layout/absolute child 能力必须新增明确子层语义后才能重新使用 constraints。

### 无状态 Layout Service

`@opendesign/layout-service` 新增 linear Auto Layout contract v1。输入只包含 Frame 尺寸、方向、padding、gap、两轴 alignment，以及有序、可见、固定尺寸子层；输出稳定 ID 对应的局部位置。

求解器不读取文档、selection、viewport、Leafer、Agent、文件或凭据，也不保存第二份布局状态。内容溢出时仍给出确定性位置；是否裁剪由 Frame `clipsContent` 决定。

### EditorRuntime 在每笔事务结束前统一回流

Runtime 对一笔事务依次执行：

1. 所有显式 DesignOperation；
2. 文字 Auto Size 的可信测量；
3. 所有 Auto Layout Frame deepest-first 求解；
4. 文档 invariant、diff、revision 与 history。

因此 insert/delete、visible、size、文字内容、move/reorder/reparent、父 Frame resize 和嵌套流都在同一个 preview/apply、revision 与 undo 中得到最终几何，不需要调用方记住补发第二笔“reflow transaction”。隐藏子层退出流但保留稳定 childIds 位置，重新显示后回到原层序。嵌套 Frame v1 本身仍是 fixed size，因此 deepest-first 主要保证确定性，并为后续 hug sizing 留出正确求解顺序。

### 人工、画布与 Agent

- Inspector 在 Frame 上提供方向、gap、四边 padding 和两轴 alignment；只展示当前真实支持的 fixed-flow 参数；
- `Shift+A` 对单选 Frame 启用按 Frame 长宽建议的水平/垂直流，`Alt/Option+Shift+A` 移除；
- Layers 重排和 reparent 进入同一层级 planner并自动回流；
- 单选 populated Frame 画布 resize 继续通过 Frame layout planner；
- 流内子层直接画布 move/resize 明确拒绝且零 revision，因为 v1 尚无画布 reflow/reorder handles；
- Agent 复用 `opendesign_arrange_layers action=set-auto-layout`，只声明规则，不提交子层坐标；通用 apply 直接修改 Frame autoLayout 或流内子层 geometry 会被宿主拒绝。

constraints Inspector 在流内子层上隐藏。所有错误均来自可信宿主状态，不允许 UI 显示一个会静默吸回或制造空 history 的假交互。

## 明确未完成

本切片不支持 hug/fill、wrap、auto gap、baseline、min/max、child stretch、ignore-layout/absolute child、grid、负 gap、canvas spacing/reflow handles、SVG Auto Layout metadata、Instance 特例或双平台打包 GUI 实机证据。能力清单保持 `degraded`，不得把线性 fixed-flow v1 宣传为完整 Figma Auto Layout。

## 验证

- schema 严格 union、未知字段拒绝、`1.12.0 → 1.13.0` 无发明迁移；
- Layout Service 覆盖水平/垂直、两轴三种 alignment、padding/gap、空流、溢出与非法输入；
- Runtime 覆盖启用时清 constraints、固定层序、隐藏/显示、insert/delete、size、reorder/reparent、父 resize、嵌套 flow、preview/apply、save/reopen 和 undo/redo；
- 文档 invariant 拒绝 Auto Layout flow child constraints 与失效层级；
- Inspector、快捷键、Layers、Canvas commit 与 Agent 专用 tool 使用同一 planner/Runtime；
- 流内直接画布 geometry 和 Agent 通用 apply 旁路均失败且零 revision；
- capability manifest、engine baseline、fixture schema 与生成文档共同使用 `DesignDocument 1.13.0`。
