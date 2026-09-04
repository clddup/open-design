# ADR-0301：Logo 首稿只保留真实 Master，删除机械缩放伪证据

## 状态

接受。取代 ADR-0110 与 ADR-0125 中要求首稿物化 monochrome/32/24/16 evidence nodes 的部分；其余决策保持有效。

## 背景

此前 compact first-slice 要求每个 Logo 方向提供一个空 evidence root。Main 随后把 authored master 的完整子树复制四次，分别改成黑色或统一缩放到 32、24、16 px，并把这些自动生成节点当作交付证据。

这套做法没有执行小尺寸光学校正，只证明同一图形可以缩放。它同时扩大事务命令数、节点数、首稿耗时和失败面，并让概念画板被重复黑白样张占据。结构存在被误当成视觉质量，和独立 exact-revision capture critic 的职责重复。

## 决策

1. 每个 Logo exploration direction 只声明稳定 `rootNodeId` 与其下一个真实 authored `masterNodeId`。
2. 删除 `evidenceRootNodeId`、`monochromeNodeId`、`smallSizeNodeIds` 以及 Main 自动复制子树的编译路径。
3. 首稿使用 brief-specific primary color treatment；单色只作为 silhouette 审查维度，不覆盖主 Logo 的颜色表达。
4. exact-revision critic 以真实 direction root、master 和 capture 为证据，检查轮廓、反形、光学平衡、模板化倾向和小尺寸适应潜力，但不得把机械缩放称为光学校正。
5. 用户要求 Selected Logo System 或 Desktop App Icon 时，在对应后续 target 中显式制作真正的尺寸变体；16/24/32 px 变体可以调整笔画、负空间、细节和留白，而不是自动等比复制。

## 结果

- 三方向首稿的命令量不再按 master 子树大小额外放大四倍。
- 画板保留真实设计内容，不再被宿主注入的黑白/缩放副本挤占。
- 结构校验只证明方向 root 与 authored master 存在；视觉质量继续由 capture critic 和后续真实 refinement 负责。
- 产品未发布，不保留旧 evidence 字段或兼容分支。

## 验证

- First Slice Provider/Runtime Contract 不再接受旧 evidence 字段，并保持准确字段路径。
- 编译结果的命令和 inserted node IDs 不包含宿主派生 evidence clone。
- final structure verification 要求每个 direction 的 master 位于对应 root 下。
- critic 收到真实 root/master IDs，不再收到自动缩放节点。
