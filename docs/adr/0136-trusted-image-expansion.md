# ADR-0136：可信画布扩图工作流

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.42.0`（不变）
- 图片服务契约：`OpenDesign Image Service contract 5`
- 关联：ADR-0089、ADR-0127、ADR-0132、ADR-0135

## 背景

区域擦除与对象提取已经建立 Image node-local 几何、Main 可信 mask、远端取消、来源谱系和原子事务边界，但扩图不是另一种 lasso 动作。Figma 的公开工作流把 Expand 作为独立入口：用户拖动图片四边或四角的蓝色手柄，也可选择目标宽高比，确认后才运行异步图片任务。`Select area` 继续只承载 Erase 与 Isolate，整图提示词也保持独立入口。

OpenAI Images edit API 接受 mask，并要求源图与 mask 同格式、同尺寸且 mask 含 alpha。当前 GPT Image 公开尺寸约束要求边长为 16 的倍数、长短边不超过 3:1，并允许任意满足像素预算的分辨率。mask 对模型是提示而非严格像素约束，因此仅依赖 Provider 声称“保留原图”不足以满足专业扩图的非破坏语义。

## 决策

### Expand 是独立画布 session

单选、未锁定、内嵌 PNG/JPEG/WebP Image 可从 Inspector 进入 Expand。Canvas 使用 disposable DOM/SVG overlay 显示原始边界、真实扩展区、四边/四角手柄、Free / 1:1 / 4:3 / 3:2 / 16:9 比例选择以及 Cancel / Expand；该状态不进入文档、revision、history 或保存文件。

Image Service contract 5 统一 session 与几何：扩展量使用 Image node-local `top/right/bottom/left` 设计单位，只能向外，每边最多当前对应尺寸的两倍，最终宽高比不超过 3:1。手柄拖动、比例 preset、最小有效扩展、有限数值和 provider raster 几何都由同一无状态 service 解析。Escape、Page/tool/selection/node/asset/revision 变化取消且零 revision。Auto Layout `Fill` 图片必须先改为固定尺寸，避免回流覆盖扩图几何；Fixed/Absolute 图片按现有布局语义继续。

### Main 构造精确 Provider 画布

Renderer 与 Agent 只提交节点局部扩展量，不提交像素、mask、路径、Provider 或模型。Main 解码当前 source asset，并按节点的 Stretch/Fit/Fill/Crop、rotation 和 flip 投影出用户当前可见的原图区域。

扩展后的设计比例映射到短边 1024px、长边向上对齐 16px 的受控 Provider 画布；原图占据与设计几何相同的整数像素矩形，扩展区透明。Main 生成同尺寸 RGBA mask：原图矩形 alpha 255，扩展区 alpha 0。`ImageGenerationHost` 使用固定延展场景的 prompt、精确 `size`、`background=auto` 和 `/images/edits`；源图、mask 与输出必须同尺寸 PNG。

由于公开 API 明确说明 mask 只是指导，Provider 成功后 Main 会把准备阶段的完整原图保护矩形逐像素覆盖回生成结果。模型只拥有新增边界，不能修改、重绘或漂移原图区域。该复合发生在 Main，Renderer 与模型 transcript 都不接收图片字节。

### 结果与节点几何一次提交

Provider 输出通过格式、尺寸和复合校验后，Main 建立内容寻址结果 asset、唯一 PNG mask supporting asset 和 `operation=expand` derivation。derivation extensions 记录扩展量、原 placement/target size、Provider canvas 与保护矩形，不记录凭据或路径。

Runtime 的专用 `expand-source` planner 再检查当前 `expectedAssetId`、原 node size、placement 和固定尺寸语义。用户在等待期间只平移、旋转或重挂载节点时可继续基于当前 transform；resize、placement、asset 或 Fill sizing 变化会 stale 失败。成功事务同时：

1. 写入 mask asset、结果 asset 与 derivation；
2. 将 Image source 切到结果并把 placement 设为 Stretch；
3. 增长节点 size，并按当前 affine transform 平移新局部原点，使原图保护矩形保持原世界位置。

一次 Undo 恢复完整节点几何与来源，并删除本次新建的结果、mask 和 derivation。失败、取消、输出漂移或 stale target 均不产生 revision。任务运行时画布保持可操作，状态区只展示真实 pending 与 Cancel。

### 人工与 Agent 共享同一边界

人工手柄和 `opendesign_edit_image action=expand` 共用 Desktop API、ImageGenerationHost、Main raster、Runtime planner 与来源历史。Agent 必须从当前 inspection/capture 获取 Page、Image node、`expectedAssetId`、节点尺寸与所需扩展方向；Main 通过内部只读桥取得权威 placement/size，模型不能伪造 prepared canvas 或直接调用 `derive-source` 绕过扩图几何。

## 后果

- OpenDesign 获得与 Figma 公开交互一致的独立 Expand 工作流，同时以可信像素复合提供比纯 mask 提示更强的原图保护。
- 扩图结果仍是普通 Image asset；画布、capture、导出、来源切换、保存与撤销不增加旁路。
- 每边两倍和 3:1 是当前 Provider 约束下的显式产品边界，不被错误描述为通用文档限制；后续 adapter 可通过新契约扩展。
- Boost resolution 随后由 ADR-0137 接入同一来源谱系；带提示词的局部重绘、背景替换、重打光、风格统一、Image Paint 编辑和多参考图仍待后续切片。

## 验证

- Image Service 测试覆盖自由手柄、比例 preset、no-op、边界、16px 对齐 Provider canvas 和保护矩形。
- Main raster 测试覆盖当前 placement 投影、透明扩展区、mask alpha、原图保护像素复合和尺寸漂移拒绝。
- Host 测试覆盖固定 prompt、精确 size、multipart mask、网络前尺寸拒绝和输出尺寸验证。
- Desktop API、Agent schema、内部只读/写 bridge 与 Runtime 测试覆盖专用 action、普通 derive 旁路拒绝、stale size/placement/asset、Fill sizing、单 revision、一次 Undo 和来源谱系。
- App 测试覆盖 Inspector 入口、真实 overlay、比例选择、选择工具隐藏、提交、Escape、revision stale、属性保留与取消零 revision。

## 参考

- [Figma：Make or edit an image with AI](https://help.figma.com/hc/en-us/articles/24004542669463-Make-or-edit-an-image-with-AI)
- [OpenAI Image generation and editing](https://developers.openai.com/api/docs/guides/image-generation)
