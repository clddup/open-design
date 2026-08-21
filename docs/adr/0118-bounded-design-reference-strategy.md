# ADR-0118：有界 Design Reference Strategy

- 状态：Accepted
- 日期：2026-08-21
- DesignDocument：不变（`1.36.0`）
- Design Plan：v1 增加可选 `referenceStrategy`
- 关联：ADR-0010、ADR-0018、ADR-0098、ADR-0104、ADR-0117

## 背景

OpenDesign 已能把用户附加的 raster 图片交给作者模型，也能读取和放置图片，但生产 Plan 不区分参考图与交付素材。模型可能把 UI 截图当成要放入画布的内容，把真实照片只当作配色参考，或只模仿一张参考图的颜色而忽略构图、材质和品牌约束。独立 Critic 原先只看最终 capture，也无法判断用户明确给出的视觉方向是否被遵循。

成熟设计工具把 style/brand/design-system context 作为正式输入，而不是依赖“参考一下”这样的无结构文本。OpenDesign 当前还没有跨文件 Library、模板市场或持久 Brand Kit，因此本切片只建立 Run-scoped、内容寻址且可验证的参考策略，不虚构更大的资源系统。

## 决策

Design Plan v1 和 compact first-slice v1 增加可选 `referenceStrategy`：

- 当前 Run 没有 raster 附件时可省略；有 raster 附件时 Main 强制每张图片恰好分类一次；
- decision 固定为 `style-reference`、`composition-reference`、`brand-reference`、`content-asset` 或 `ignore`；
- 每项必须说明 application、应保留的 transferable decisions 与明确 avoidances；
- 最多两张图片可作为 active visual reference，避免重复图片输入、上下文膨胀和互相冲突的方向；content asset 与 ignore 不进入 Critic reference 输入；
- Main 只接受当前 Run 已授权的内容寻址 `image_<sha256>`，拒绝漏项、跨 Run ID、重复 ID 和第三张 active reference。

作者模型仍在原始用户消息中看到获准图片。Plan 负责把观察转成可执行策略，而不是重新传输图片或授予新能力。真实内容素材继续通过现有 `place_image`/`update_image` 进入 DesignDocument；视觉参考本身不自动写入文档。

clean capture 的 stateless Critic 继续以第一张图片作为 exact-revision delivery capture，并按 Plan 顺序附加最多两张 active visual references。JSON 明确列出 capture/reference attachment IDs 和 referenceStrategy。存在 active reference 时新增 critical、非补偿的 `reference-adherence`：检查声明的构图、层级、字体、材质、色调或品牌原则是否可见，同时拒绝仅换色和 literal copying。宿主仍计算阈值，作者或 Critic 的通过文字不能覆盖低分。

## 后果与边界

- 用户提供参考图后，模型必须明确其用途，不再靠隐含猜测决定“参考还是放置”。
- Critic 能判断结果是否真正遵循参考方向，但不会要求复刻，也不把参考图写入文档/history。
- 当前策略只在一次 Run 内有效；它不是 Brand Kit、跨文件 Library、Pattern catalog、模板市场或长期项目记忆。
- 文档内已有 Components、Variables 与 Shared Styles 仍通过 inspection 提供；高阶 Pattern 发现和 Brand Context 持久化是后续独立切片。
- 当前复用所选 image-input/tool-use 模型；独立 Critic 模型配置仍未实现。

## 验证

- schema/normalizer 覆盖五种 decision、唯一 attachment、最多两张 active reference、额外字段和 compact compiler 保真；
- Coordinator 覆盖有图无策略拒绝、跨 Run ID 拒绝、全部附件一次分类以及 Critic context 的精确引用；
- Critic 覆盖 delivery capture 始终第一、参考顺序、`reference-adherence` critical failure 和非补偿门禁；
- 没有图片附件的既有 Run 行为保持不变。
