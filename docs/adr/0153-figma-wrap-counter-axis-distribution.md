# ADR-0153：Figma-compatible Wrap 交叉轴自动分布

- 状态：Accepted
- 日期：2026-08-25
- DesignDocument：`1.45.0`
- Layout Service：contract `9`
- 扩展：ADR-0056、ADR-0058、ADR-0092

## 背景

OpenDesign 的 Horizontal Wrap 已保存固定 `counterGap`，主轴也已支持 `space-between`。但固定高度的 Wrap Frame 不能像 Figma 一样把交叉轴剩余空间自动分配到 wrapped rows 之间；Inspector、Agent 与 Figma interop 也没有表达这一语义。

Figma 公共 Plugin API 使用 `counterAxisAlignContent: "AUTO" | "SPACE_BETWEEN"` 表达 wrapped rows 的交叉轴分布，并用 `counterAxisSpacing` 保存普通固定间距。`SPACE_BETWEEN` 只消费固定交叉轴上的非负剩余空间；没有自由空间时不能产生负 gap。Hug 高度由内容决定，因此自动分布自然收缩为零。

该能力是宿主布局语义，不需要增加 Provider 请求、Critic 或逐步等待，也不能用更快但低质量的首稿换取。Agent 只声明布局意图，可信 Layout Service 在现有事务内确定性派生几何。

## 决策

### 文档语义

`AutoLayoutWrap` 增加可选字段：

```ts
counterAxisAlignContent?: "auto" | "space-between"
```

缺省与 `auto` 都保留既有固定 `counterGap` 行为。`space-between` 表示自动分布 wrapped rows；`counterGap` 继续保存，模式切回固定时恢复原数值。`1.44.0` 迁移到 `1.45.0` 时不猜测新字段，旧文档视觉不变。

### 求解

Layout Service contract 9 在 Horizontal Wrap 中按以下顺序求解：

1. 继续按固定 Frame width 和 child 顺序贪心分行。
2. 先求各 row 的内容高度总和。
3. 固定高度且为 `space-between` 时，将 `frame height - vertical padding - row heights` 的非负剩余空间平均分配到相邻 row；零或一行的 gap 为零。
4. Hug 高度时不把保存的 `counterGap` 算入内容高度，自动 gap 为零。
5. 普通固定间距模式继续使用 `counterGap` 和既有整组交叉轴对齐。

Vertical Wrap、Wrap + Fill child、Hug width 与 baseline 不在本决策范围内，继续失败封闭。

### 产品与 Agent

Inspector 的 Wrap 区提供“垂直间距模式：固定 / 自动”。自动模式禁用数值输入但保留固定值，不建立第二份 UI 状态。Agent Arrange 契约直接复用权威 Auto Layout schema，并说明 `counterAxisAlignContent=space-between`；执行仍由现有 preview/apply、单 revision、单 undo 和 Runtime reflow 完成。

### Figma interop

隔离的 `@opendesign/figma-interop` 显式映射 Figma 公共字段：

- `layoutMode` / `layoutWrap`
- `itemSpacing` / `counterAxisSpacing`
- `primaryAxisAlignItems` / `counterAxisAlignItems`
- `counterAxisAlignContent`
- `primaryAxisSizingMode` / `counterAxisSizingMode`
- 四边 padding

这证明公共结构可往返，不声明已经完成 Figma 文件导入导出。当前 OpenDesign 不支持的 baseline alignment 等输入继续返回结构化失败，不在 adapter 内静默降级。

## 后果

- 固定高度的标签组、筛选器、卡片行等可以在不手写坐标的情况下稳定铺满交叉轴。
- Inspector、Agent、保存重开、undo/redo 与 Figma 公共字段共享同一文档事实和 Layout Service 求解结果。
- 旧 Wrap 文档视觉保持不变；模式切换不会丢失用户设置的固定间距。
- 不增加任何模型往返，因此不会牺牲首稿速度；它提升的是模型已经选择 Wrap 后的可编辑性和布局质量，不冒充审美质量评审。

## 验证

- 固定高度两行 `space-between` 得到确定性 row positions。
- Hug 高度自动 gap 收缩为零且不消费保存的固定 `counterGap`。
- 非法枚举、Vertical Wrap、Hug width 与 Fill child 在 revision 前失败。
- Runtime save/reopen、undo/redo 保持字段和最终几何。
- Inspector 固定/自动切换保持受控值；Agent schema 与执行接受同一权威字段。
- Figma 公共字段可往返；不支持的 baseline 输入明确拒绝。

## 参考

- [Figma Plugin API：counterAxisAlignContent](https://developers.figma.com/docs/plugins/api/properties/nodes-counteraxisaligncontent/)
- [Figma Help：horizontal and vertical flows in auto layout](https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout)
