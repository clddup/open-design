# ADR-0110：Logo 身份探索、矢量首切片与交付证据

> 部分决策已由 ADR-0301 取代：不再物化或校验自动生成的 monochrome/32/24/16 evidence nodes。

- 状态：Accepted
- 日期：2026-08-20
- Design Plan：`1`（增加 Logo 专属可选字段，`deliverable=logo` 时必填）
- Compact First Slice：`1`（增加 editable Path）
- Built-in Design Skills：`1`（增加 Logo planning/critic）
- 文档协议：不变
- 关联：ADR-0095、ADR-0098、ADR-0102、ADR-0103、ADR-0104

## 背景

一条四目标品牌交付实测虽然包含 Concept Exploration、Selected Logo System、Desktop App Icon 与 Brand Usage Preview，却从第一版 Plan 起把全部方向收敛为同一个开放式 O。三个“方向”主要改变开口、轮廓和排列，通用 Graphic skill 与模型自评仍允许它通过。该 Run 还把 Logo 误分类为 `brand-asset`，因此没有 Logo 专属方法；compact first-slice 只支持 Group、Frame、Rectangle、Ellipse 与 Text，无法快速提交真实可编辑 Logo contour。

现有确定性门禁能证明 Frame、region、revision、布局和组件关系，却不能证明三项概念探索真的存在。审美不能伪装成确定性事实，但可确定性验证“独立语义根、黑白证据和小尺寸证据是否真实落入文档”。

## 决策

### Logo 使用专属 skill bundle

`@opendesign/design-skills` 新增固定哈希的 `logo-visual-direction v1` 与 `logo-capture-critic v1`。`deliverable=logo` 同时绑定通用 Graphic 与 Logo 专属 skills；其他 Graphic deliverable 不加载 Logo 规则。

Primary outcome 为 Logo、Symbol、Wordmark、Identity system 或由 Logo 派生的 App Icon 时必须选择 `logo`。使用场景和品牌预览不会把 primary deliverable 降级为 `brand-asset`。

### Plan 显式表达三项概念探索

Plan v1 增加可选 `logoExploration`；仅 `deliverable=logo` 必填，其他 deliverable 禁止提交。它包含唯一 exploration target 和恰好三项 direction：

- 每项使用不同 `principle`，颜色、圆角、笔画、开口、旋转或排列变化不能作为不同 principle；
- 每项声明稳定 `rootNodeId`、`monochromeNodeId` 与按 32/24/16 px 排列的三个 evidence node；
- thesis 与 construction logic 仍是模型设计判断，不进入确定性审美评分。

最终 exact-revision inspection 阻塞缺失的 direction Frame/Group、黑白证据或小尺寸证据。宿主只证明结构和渲染对象存在，不声称它们美观、独特或可注册。

### 首切片支持真实矢量 Path

Compact first-slice v1 增加有界 SVG path data 与必填 solid fill；宿主固定编译 `fillRule=nonzero`，首轮不暴露 stroke 与更多矢量样式字段。Logo 可在第一次真实 revision 中提交 authored contour，不再被迫用圆形和矩形近似；首轮成功后完整工具继续承担专业矢量精修。元素预算、稳定 ID、单 region、父子顺序、事务、revision、history 与权限边界不变。

新设计快路径可在已有 Page 内容旁分配新 artboard，但 Plan registration 必须拒绝新 artboard 彼此重叠或覆盖任何现有 Page root。它不获得修改已有内容的权限。

## 后果

- Logo 方法不再污染海报、插画和已有品牌物料流程。
- 三项探索的存在、独立根和尺寸证据可验证；审美仍需固定 capture 盲评。
- 新设计首轮 context 增加一项有界 planning skill，但不新增 read-skill/provider 往返。
- Plan v1 的 additive 字段会使旧实验 Logo Plan 无法继续注册；产品未发布，不保留兼容 fallback。

## 验证

- skill 内容哈希、唯一 ID、bundle 路由与 context budget；
- Logo first-slice 缺少 exploration、重复 principle 或重复 evidence ID 时拒绝；
- editable Path 编译为 canonical Path node；
- final inspection 缺少任一 32/24/16 evidence node 时拒绝 verified；
- 已有 Page root 与新 artboard overlap 时拒绝 allocation；
- 固定 Logo benchmark 仍需记录 T0/T1、终态时间、概念分歧、小尺寸识别与盲评结果，未取得证据前不得宣传“审美已解决”。
