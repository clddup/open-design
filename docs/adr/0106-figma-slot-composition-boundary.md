# ADR-0106：Figma Slot composition boundary

- 状态：已接受
- 日期：2026-08-20
- 文档协议：`DesignDocument 1.35.0`（无版本变化）
- Component Service：contract v4（无版本变化）
- 关联：ADR-0045、ADR-0063、ADR-0067、ADR-0068

## 背景

roadmap 曾把 `nested Slot` 记为 Component 的后续能力，但该名称混合了两种不同结构：

1. 一个 source Slot 直接包含另一个属于同一 Main Component 的 source Slot；
2. Slot 内容包含 nested Component Instance，而该 Component 自己拥有 Component Properties 或 Slot。

Figma 的公开 Slot 文档允许 Slot 接收任意图层和 nested Instance，并明确说明普通 Frame/Text 放进 Slot 后不能再绑定 Component Property；需要保留内部 Component Properties 时，应先建立 Component，再把它的 Instance 放进 Slot。公开 Plugin API 同时把 Slot 定义为 Component/Instance 中由 Component Property 赋予身份的 Frame-like node，`clone()` 会返回普通 Frame。

因此第一种结构不是 Figma 的公开 composition model；第二种才是可互操作的专业组件组合方式。若 OpenDesign 把两者都称为 nested Slot，会让 Reset、Variant migration、Inspector ownership 和未来 Figma adapter 出现无法确定的语义。

参考：

- [Figma SlotNode](https://developers.figma.com/docs/plugins/api/SlotNode/)
- [Figma：Use slots to build flexible components](https://help.figma.com/hc/en-us/articles/38231200344599-Use-slots-to-build-flexible-components-in-Figma)

## 决策

### Slot-in-Slot 永久失败封闭

同一个 Main Component 中，source Slot 不能成为另一个 source Slot 的祖先或后代。人工、Agent 和 Runtime 的 `add-property(SLOT)` planner 在事务前拒绝两种方向；文档 invariant 同样拒绝绕过 planner、导入或损坏持久化形成的 nested source Slot。

这不是“Slot v1 暂未实现”的占位限制，而是 Figma-compatible composition boundary。OpenDesign 不增加私有 `nestedSlot` 字段，也不把无法往返的结构藏进 `extensions`。

### 通过 nested Instance 组合灵活内容

Slot 可以包含普通图层、图片、文字、Group、Frame 和 Component Instance。nested Instance 按自己的 Component identity 解析自己的 properties、Variants 与 Slot；外层 Component 不取得这些 property 的所有权。

Component Service 可以在同一当前 revision 投影中返回 nested Instance 的视觉树和 Slot 状态，但针对某个持久 Instance 的 Create/Clear/Reset Slot action 只能命中该 Instance 当前 effective root Component 的 `SLOT` definition。仅仅因为 resolver 在派生树中看到了同名或其他 nested Slot，不能把它当成外层 Instance 的可写属性。

### 后续派生实例编辑

未来画布内部派生 Main child 直选/编辑必须显式携带外层持久 Instance ID、稳定 `sourcePath`、派生 owner Component/Instance identity 和当前 revision。它应为 nested Instance 建立可审计的 override target，不得把内层 Slot override 平铺为外层 Instance child，也不得从 Inspector 文案或 property name 猜归属。

## 迁移与兼容

现有协议从 ADR-0067 起已经要求 nested Slot 失败封闭，因此不升级 `DesignDocument`。本决策只补齐 planner 文案、持久文档 invariant 和 root-action ownership 校验；历史合法文档无需迁移。若旧文件实际含 Slot-in-Slot，它原本就是无效状态，读取时继续明确拒绝而不猜测展开方式。

## 验证

自动化至少覆盖：

- 先创建内层 Slot 后再创建外层 Slot 会失败；
- 先创建外层 Slot 后再创建内层 Slot 会失败；
- 绕过 planner 构造的 nested source Slot 被文档 invariant 拒绝；
- Slot 内 nested Instance 的 Slot 继续参与渲染解析；
- 外层 Instance 的 Slot action 不能误命中 nested Instance 的 Slot；
- 外层 Instance 自己的 Slot action 保持可用。

## 后果

roadmap、capability manifest 和产品架构不再把 Slot-in-Slot 计为专业能力缺口。Component 能力保持 `degraded` 的相关原因是：派生 nested Instance 的直接选择/编辑、跨文件 Library/publishing、完整 Figma Plugin/REST adapter 与 macOS/Windows 打包 GUI 证据仍未完成。
