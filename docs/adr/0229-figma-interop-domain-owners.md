# ADR-0229：Figma Interop Domain Owners

## 状态

已接受。

## 背景

`@opendesign/figma-interop` 使用固定官方 Plugin API typings 验证 OpenDesign 的 Figma-compatible 公共语义，但根 `index.ts` 同时实现图片调整、Auto Layout/Grid、Shared Styles、富文本、Export Settings、Component Properties 和 Variables。聚合入口超过一千行，测试也把七个领域放在同一文件，后续增加 Plugin/REST adapter 时会继续扩大跨领域耦合。

## 决策

1. 图片调整、Auto Layout/Grid、Shared Styles、Text Range、Export Settings、Component Properties 与 Variables 分别拥有独立模块。
2. `appearance-projection.ts` 只提供 Shared Style 与 Text Range 共用的颜色、blend、Text Case/Decoration 和 FontName 投影；内部 helper 不从 package 根入口公开，根入口只保留原有 `toFigmaFontName` 公共函数。
3. 固定 Plugin typings 版本与 commit 由 `plugin-baseline.ts` 独立拥有。
4. 根 `index.ts` 只 re-export 既有公共 API；OpenDesign Core 仍不导入 Figma 类型，也不建立 Figma 文档作为第二份设计事实。
5. 聚合测试按相同领域 owner 拆分，继续通过 package 根入口验证真实消费者表面，不增加文件数量、源码形状或内容 hash 门禁。

## 结果

- 根入口从 1243 行收缩为 9 行，所有生产与测试 owner 均低于项目 500 行边界。
- 官方 Plugin API shape、固定 typings baseline、现有 round-trip 与 unsupported issue 行为保持不变。
- 后续 Plugin/REST/DTCG adapter 可以在对应领域扩展，不需要把所有 Figma 语义重新塞回聚合入口。

## 验证

- Figma Interop typecheck；
- Image、Auto Layout/Grid、Shared Style、Text Range、Export、Variable 与 Component owner tests；
- ESLint、Prettier 与公共入口导入回归。
