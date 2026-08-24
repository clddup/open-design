# ADR-0149：上下文视觉校准，不引入第二套 Design Skill 运行时

状态：Accepted，扩展 ADR-0098 的内置 Design Skills、ADR-0120 的 brief-specific visual direction 与 ADR-0147 的首切片视觉方向。

## 背景

OpenDesign 已把 UI 结构、UI 视觉方向、通用图形、Logo 方向和对应 capture critic 分成七个随应用构建静态注入的方法包，并在同一次 first-slice 调用中提交 `designIntent`。生产反馈仍显示不同 brief 容易收敛到相似的安全中间态：相近密度、相近表现力、相近卡片结构。现有 thesis、motif、composition tension 和 spacing 都是自由文本，模型可以写出不同描述却继续绘制同一种布局。

调研了两个用户指定的外部项目：

- [Taste Skill](https://github.com/Leonxlnx/taste-skill/tree/72e299530e2eb31ed8da06181bc19f6c18a00821)（MIT）用 contextual brief inference 和 variance/motion/density 三个尺度纠正通用前端模型偏置，但主 skill 明确面向 landing page、portfolio 和 frontend redesign，不适用于 dashboard、data table 或 multi-step product UI；其 React、Tailwind、GSAP、字体与浏览器实现规则也不属于 OpenDesign 画布契约。
- [Impeccable](https://github.com/pbakaus/impeccable/tree/c3a30086bc395ea2197fbe287dc59c18969aaeb6)（Apache-2.0）把 surface 分成 persuade/operate/read/experience，使用 durable product/design context、命令 playbook、浏览器截图和 deterministic source detector。其 23 个前端命令、hooks、源码 detector 和临时工作目录是 AI coding harness，不应成为 OpenDesign 第二套 tool/runtime/validation 状态。

两个项目的正收益不是更多规则，而是：从当前 surface 的成功条件推导视觉校准；把审查限制在有界批次；不要让所有 brief 落到相同中间值。OpenDesign 已具备 surface mode 方法、有界 draft Critic 和 exact-revision capture，缺少的是可由当前单一 Plan 承载的短结构化校准。

## 决策

### 在当前 design intent 中增加三个短决策

当前 `DesignIntent` 增加：

```text
calibration.surfaceMode = persuade | operate | read | experience | graphic
calibration.expressiveness = restrained | balanced | expressive
calibration.density = airy | balanced | dense
```

UI 必须根据当前 surface 使用前四种 mode；非 UI 交付必须使用 `graphic`。Main/Runtime 在单一 Plan refinement 中返回稳定字段路径，不能只依赖 system prompt。

Expressiveness 与 density 由任务频率、信息量、受众、品牌姿态、交付 viewport 和用户明确 mood 推导。它们不是用户必须配置的“快速/精细”模式，也不在 Composer 增加控制项。`balanced/balanced` 不能成为无脑默认；它只有在 brief 与真实任务都支持中间值时才合法。

### 同一次 first-slice 传递，不增加解释或回合

Calibration 与现有 subject/audience/job/thesis/motif 在同一个 `opendesign_generate_first_slice` 输入中提交。它只增加三个枚举值：

- 不要求逐元素解释；
- 不展示用户可见设计作文；
- 不新增 Plan-only Provider turn；
- 不新增 capture、Critic 或 refinement 次数；
- 不改变 scope、revision、transaction、permission 或 capability。

现有 skills 负责把校准落实到构图、比例、留白、信息量、字体、材质、轮廓和真实内容。Expressive 不等于增加特效；restrained 不等于无识别度；airy 不等于把内容丢在空画板中；dense 不等于微小控件堆成纹理。

### 复用现有 Critic，不增加第十个评分或新 Skill

UI、Graphic 与 Logo capture critic 在现有 composition tension、glance legibility、subject specificity 和 craft precision 中检查 calibration 与真实像素是否一致。当前九项非补偿 criterion 不增加新字段，不为 calibration 发起独立模型请求。

内置 skill 数量保持七个。外部仓库不 vendoring、不安装、不运行脚本、不引入 hooks、浏览器 detector、命令面板或依赖；其文本和代码不复制到产品。OpenDesign 只实现从调研得出的通用产品决策，因此不新增第三方运行时或许可通知。

## 后果

- first-slice 与普通 Design Plan schema 略增三个枚举，模型输出只增加很短的结构数据；固定 context budget 继续用现有上界验证，不能把字节数当真实速度证明。
- 当前未发布的 Plan v1 定义被直接替换，不保留旧缺字段输入兼容。恢复中的旧实验 Run 应明确失败并由新 Run 重新规划，不能静默补 `balanced`。
- Calibration 能减少“描述不同、结果相同”的安全中间态，但不能单独证明审美提升。真实效果仍需同 prompt/模型/工具预算的 UI、Logo 固定样张盲评和 `T1/T2/T_all` 证据。
- Durable Brand/Product Context、surface-specific reusable patterns 和用户/Project 自定义 Skill 仍是后续独立能力，不能由三个枚举冒充。

## 验证

- Design Plan 与 compact first-slice 的 Provider schema 都要求 calibration，缺失或非法枚举返回准确字段路径。
- UI + graphic、非 UI + persuade/operate/read/experience 在 domain refinement 失败；合法 calibration 经 first-slice compiler、Plan、inspection 和 independent Critic context 保留。
- UI/Graphic/Logo planning 与 critic bundle 都包含 contextual calibration 方法，但 Skill refs、数量和权限边界不变。
- 新设计 compact context 仍低于现有 34 KB 上界，系统 prompt 仍低于现有 17 KB 上界；没有新增 Provider 请求。
- 相关契约、compiler、Coordinator、Critic、system prompt、context budget、typecheck 与 Desktop build 通过。
