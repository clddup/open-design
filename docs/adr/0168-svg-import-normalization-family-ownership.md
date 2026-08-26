# ADR-0168：SVG 导入 Normalization Family 所有权

## 状态

已接受。

## 背景

ADR-0167 已把不可信 SVG 字符串、XML/root/structure budget 和 source viewport 迁入唯一 parse family。聚合 `svg.ts` 仍直接处理继承 presentation style、inline style、长度与 opacity、SVG transform、OpenDesign transform 转换，以及导入 Group 的 bounds/rebase。

这些步骤发生在节点语义选择之前或容器组装期间，属于同一导入 normalization 边界。继续让它们散落在 `svg.ts` 会使 Group、Mask、Frame、Shape 与 Gradient 分支分别依赖局部 helper，后续新增单位、transform 或 style 语义时容易形成不一致路径。

## 决策

1. `svg-normalize.ts` 是 SVG 导入 normalization 的唯一 owner，负责：
   - presentation attribute 与 inline style 的继承和受支持属性集合；
   - unitless/px length、opacity、unit interval 与正值长度；
   - SVG transform 解析、有限矩阵校验和 OpenDesign `Transform` 转换；
   - 导入 Group/Mask 子节点的变换后 bounds 与原地 rebase。
2. `svg.ts` 的 Root、Group、Mask、Frame、Shape、Gradient 与 Path 分支全部消费该 family，不保留第二份 style/length/opacity/transform/bounds helper。
3. Normalization family 只返回规范化值和结构化 `SvgInterchangeIssue`，不选择节点 kind，不解析 paint/gradient definition，不创建节点，也不拥有 fidelity 汇总或 serialization。
4. 本切片不改变公共 SVG API、版本、单位支持、矩阵顺序、Group local coordinate 语义、issue code 或失败行为，不增加兼容 facade。
5. Phase 9 继续开放；paint/gradient appearance、fidelity、serialize 和剩余 import/export orchestration 仍需迁移。

## 结果

- 所有导入分支共享同一套 style、数值和 transform 规范化行为。
- Group 与 Mask 的 local bounds/rebase 不再由聚合 service 私有实现。
- `svg.ts` 进一步收缩为语义导入和导出编排，但仍不是最终薄 orchestration。

## 验证

- 独立测试覆盖 style 继承、inline CSS warning、style/attribute precedence、有效/无效 transform、Group bounds/rebase、px/非法 length 和 opacity clamp。
- 既有 SVG 回归覆盖 Root、Group、Mask、Frame、Shape、Text、Vector、Gradient 与导入导出行为。
- Import/export package typecheck、定向 ESLint、Prettier 与 Desktop build 通过。
