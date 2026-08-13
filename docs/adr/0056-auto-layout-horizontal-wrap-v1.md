# ADR-0056：Auto Layout 水平 Wrap v1

- 状态：Accepted
- 日期：2026-08-13
- 文档协议：`DesignDocument 1.15.0`
- Layout Service：Auto Layout contract v3
- 关联：ADR-0036、ADR-0053、ADR-0055

## 背景

线性 Auto Layout 已支持方向、padding、gap、对齐和 Fixed/Hug/Fill，但标签组、响应式卡片行与工具栏仍需要在固定可用宽度内自动换行。Figma 当前把 Wrap 作为 Horizontal flow 的模式，并允许水平与垂直间距独立设置；Grid、Auto gap、min/max 和 absolute child 是不同能力。

OpenDesign 采用这一公开产品语义，同时继续由自有文档、纯函数 Layout Service 与唯一 EditorRuntime 保存事实。Wrap 不是 Leafer 私有 Flow 状态，也不由模型计算最终坐标。

## 决策

### 严格版本化语义

`DesignDocument 1.15.0` 只在 Horizontal Auto Layout 上增加：

```ts
wrap?: {
  mode: "wrap";
  counterGap: number;
}
```

`gap` 是每行内部的水平间距，`counterGap` 是行间垂直间距。`1.14.0 → 1.15.0` 只升级版本，不发明 Wrap。Vertical flow 与未知 Wrap 字段由严格 schema 拒绝。

Wrap v1 要求 Frame 水平 sizing 为 Fixed，以 Frame 宽度形成确定换行阈值；Frame 高度可 Fixed 或 Hug。所有可见直属子层必须保持两轴 Fixed，Wrap+Fill 明确拒绝。隐藏子层退出分行与冲突检查；超宽单项独占一行并允许越过内容宽度，不静默缩放。

### Layout Service contract v3

求解器按 `childIds` 稳定顺序贪心分行：当前行加入下一项会超过扣除左右 padding 后的非负内容宽度时开始新行。每行高度取该行最大 child 高度。

- `primaryAlignment` 独立作用于每一行的水平内容；
- `counterAlignment` 同时作用于行内不同高度 child 的垂直对齐，以及 Fixed Height Frame 内整组行的垂直对齐；
- Hug Height = 上下 padding + 各行高度 + 行间 `counterGap`；
- Fixed Height 不改变行高，只在剩余交叉轴空间内对齐整组行；
- 求解器不读取文档、selection、viewport、Leafer 或模型状态。

### Runtime、人工与 Agent

EditorRuntime 在增删、显隐、resize、重排、Frame resize、reparent、preview/apply、undo/redo 和 reopen 后走同一求解与有界 nested convergence。Document invariant 与 planner 都拒绝 Wrap+Hug Width 和可见 Fill child，防止通用事务或旧客户端绕过。

Inspector 只在 Horizontal flow 显示 `Single line / Wrap`。开启 Wrap 时把 Width sizing 明确切为 Fixed，并以当前水平 gap 初始化 vertical gap；关闭 Wrap 或切 Vertical 时删除字段。Wrap child 的两个 Fill 选项保持可见但 disabled，表达当前限制并保留键盘可访问标签。

Agent `set-auto-layout` 使用同一严格对象 schema；Vertical Wrap、负 `counterGap`、未知字段、Wrap+Hug Width 与 Wrap+Fill 均失败且不产生 revision。系统提示明确这些边界，不要求模型估算分行坐标。

## 明确未完成

本切片不支持 Vertical Wrap、Wrap+Fill、Auto gap、baseline、min/max、aspect ratio、ignore-layout/absolute child、Grid、canvas reflow handles、SVG Auto Layout metadata 或双平台打包 GUI 实机证据。能力继续保持 `degraded`，不能宣称完整 Figma Auto Layout。

新版 Figma 还保证 padding 不被压缩；OpenDesign 当前 Fixed Frame 仍可能小于 padding。本切片不静默改变所有线性布局的 Frame minimum，后续需单独升级契约与兼容测试。

## 验证

- schema/migration 覆盖 Horizontal Wrap、Vertical/未知字段拒绝和 `1.14.0` 无发明迁移；
- Layout Service 覆盖贪心分行、独立双 gap、逐行/整组 alignment、Hug/Fixed Height、超宽、隐藏层及非法 sizing；
- Runtime 覆盖增删/显隐/resize/重排/父尺寸、nested Hug、preview/apply/history/reopen 和 planner/invariant 失败封闭；
- Inspector 覆盖开启/关闭/切方向、默认与编辑 vertical gap、Width Hug 和 child Fill 禁用及可访问标签；
- Agent schema 与执行路径覆盖合法 Wrap 和非法 Vertical/负 gap/未知字段；
- capability manifest、engine baseline、fixture 与生成文档共同使用 `DesignDocument 1.15.0` 和 Layout Service contract v3。
