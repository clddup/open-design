# ADR-0055：Auto Layout 轴向尺寸 v1 与有界收敛

- 状态：Accepted
- 日期：2026-08-13
- 文档协议：`DesignDocument 1.14.0`
- Layout Service：linear Auto Layout contract v2
- 关联：ADR-0036、ADR-0051、ADR-0053

## 背景

`DesignDocument 1.13.0` 已建立线性 Auto Layout 与事务内自动回流，但 Frame 和直属子层都只能使用持久固定尺寸。按钮、导航、表单、卡片和响应式内容需要表达“容器适应内容”和“子层占满可用空间”，并要求文字测量、嵌套布局、人工编辑和 Agent 写入共享同一确定性结果。

Figma 将尺寸分为容器 Fixed/Hug 与子层 Fixed/Fill，并在 Auto Layout 树中传播。OpenDesign 采用同类产品语义，但继续由自有文档、Layout Service 与 EditorRuntime 持有事实；Leafer 只消费最终 revision 投影。

## 决策

### 版本化语义

`DesignDocument 1.14.0` 增加：

- Auto Layout Frame `properties.autoLayout.sizing.horizontal/vertical: fixed | hug`；省略等价于两轴 Fixed，保证 `1.13.0` 文档无发明迁移；
- Auto Layout 直属子层 `layoutSizing.horizontal/vertical: fixed | fill`；省略等价于两轴 Fixed；
- `layoutSizing` 离开 Auto Layout parent 或关闭 parent flow 时清除，不在普通 Frame、Page root、Group 或 extensions 中保留失效状态；
- Group/Boolean 的 bounds 跟随内容，当前不能 Fill；Auto Width Text 不能 Fill，Auto Height Text 不能纵向 Fill；水平 Fill + Auto Height Text 明确支持。

可见子层不得在 parent 同轴 Hug 时使用 Fill。隐藏子层退出布局计算，因此其既有 sizing 不制造 Hug/Fill 冲突；重新显示后重新参与并接受 invariant 校验。

### Layout Service contract v2

纯函数求解器接收 Frame 两轴 sizing 与每个可见子层两轴 sizing，并输出 Frame 最终尺寸以及每个子层的最终位置和尺寸：

- Hug 主轴 = 两端 padding + 子层尺寸总和 + gaps；
- Hug 交叉轴 = 两端 padding + 最大子层尺寸；
- Fixed 主轴上的多个 Fill 子层确定性平分非负剩余空间；
- 交叉轴 Fill 占满扣除 padding 后的非负可用尺寸；
- 同轴 Hug + Fill 返回 `sizing-conflict`，不猜测优先级。

求解器不读取文档、selection、viewport、Leafer 或模型状态，也不保存第二份布局事实。

### EditorRuntime 有界收敛

每笔事务在显式命令后执行有界循环：deepest-first flow 求解 → 只重测宽度发生变化的 Auto Height Text → 比较布局几何 fingerprint。稳定即提交；最大 pass 数按 flow Frame 数有界，超限则整笔事务失败且 revision/history 不变。

该循环允许子层 Fill 宽度改变文字高度，再由祖先 Hug 高度吸收结果。preview 与 apply 使用同一求解和 Text provider；undo/redo/save/reopen 保存具体最终尺寸，不依赖重新请求模型或 Leafer 私有 Flow。

### 人工与 Agent

- Inspector 为 Auto Layout Frame 提供 Width/Height Fixed/Hug，为直属子层提供 Width/Height Fixed/Fill；
- 所有子层 sizing 通过 `planSetNodeLayoutSizing`，不走 generic update；
- 手动 resize Hug Frame 的发生变化轴切回 Fixed，未变化轴保持原 sizing；
- Fill 子层直接画布 geometry 操作继续拒绝，避免拖动后被回流静默吸回；
- Agent `opendesign_arrange_layers` 的 `set-auto-layout` 接受 Frame sizing，新增 `set-layout-sizing`；通用 apply 修改 `autoLayout`、`layoutSizing` 或 flow child geometry 均失败且零 revision。

## 明确未完成

本切片不支持 wrap、auto gap、baseline、min/max、aspect ratio、ignore-layout/absolute child、grid、canvas reflow handles、SVG Auto Layout metadata、Instance resize 特例或双平台打包 GUI 实机证据。能力保持 `degraded`，不能宣称完整 Figma Auto Layout。

## 验证

- `1.13.0 → 1.14.0` 不发明 sizing；schema 拒绝 Frame Fill、child Hug 与未知字段；
- Layout Service 覆盖两方向 Hug、主轴 Fill 平分、交叉轴 Fill、隐藏层与冲突；
- Runtime 覆盖 nested Hug、Auto Height Text 重测、增删/显隐/重排/resize/reparent、preview/apply、undo/redo/save/reopen；
- 关闭 flow 与 reparent 离开 flow 清理 sizing；手动 Frame resize 只切换变化 Hug 轴；
- Inspector、快捷键上下文和 Agent 共用 planner；generic apply 与直接画布旁路失败封闭；
- capability manifest、engine baseline、fixture schema 与生成文档共同使用 `DesignDocument 1.14.0` 和 Layout Service contract v2。
