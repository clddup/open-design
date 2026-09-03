# ADR-0196：Independent Visual Critic 单一动态契约

## 状态

已接受。

## 背景

Independent Visual Critic 的 criterion 集合由当前交付类型、Logo 输出、概念方向和参考图动态决定。此前 `design-visual-critic.ts` 同时维护 Provider JSON Schema 与 Runtime 手写 `parseCriticInput / boundedText / exactKeys`，Capture JPEG attachment 又有第三套字段判断。规则漂移时，Critic 已消耗一次独立 Provider 请求才被 Runtime 以笼统的 `invalid scorecard` 拒绝，错误也无法定位到具体 criterion 字段。

## 决策

1. `createDesignVisualCriticVerdictContract()` 根据当前 criterion IDs 构造一次动态可执行 Schema；同一 Schema 对象同时用于 Provider tool disclosure 与 Runtime parse。
2. Schema 直接拥有 summary、完整动态 criteria map，以及 score/evidence/refinement 的一致关系：1–3 分必须给出一项材料性 refinement，4–5 分必须省略 refinement；删除并行的手写 parser、字段枚举和错误解释。
3. 不再提供与 criterion-level refinement 重复的顶层 refinement 列表。每项修改必须归属到一个未达标 criterion，Runtime 只从这些未达标项生成后续精修输入。
4. Capture structured content 与 JPEG attachment 分别使用可执行 Contract；attachment 继续拒绝额外路径字段和非 JPEG MIME。
5. 非法 Critic response 进入现有 `visual_critic_unavailable` workflow failure，首个准确 Contract path 与恢复建议进入结构化 failure，不再只返回 `invalid scorecard` 字符串。
6. 不增加 Critic 次数、Provider retry、固定等待、兼容 parser 或新的公开设计工具。

## 结果

- Provider 与 Runtime 不再维护两套 Critic verdict 结构。
- “已可交付分数”和“仍需材料性精修”不能同时出现，也不存在第二份无归属 refinement 列表。
- 动态 Logo direction criterion 的错误可定位到 `/criteria/<criterionId>/<field>`。
- 未达标项缺少 refinement、已达标项携带 refinement、分数越界、criterion 缺失或多余字段在同一 Contract 中得到一致结果。
- Capture attachment 的 MIME、大小和未知字段使用稳定 code/path 报错。

## 验证

- 动态 Contract 的 schema 即 Provider 使用的 schema。
- 分数越界返回准确 criterion score 路径。
- 3 分携带 refinement 可通过；4 分不携带 refinement 可通过；4 分携带 refinement 返回准确 criterion refinement 路径。
- PNG 或携带 `filePath` 的 capture attachment 返回准确字段路径。
- 现有 Logo critical threshold、reference criterion、exact-revision review 与 ledger 投影行为保持不变。
