# ADR-0135：可信图片区域选择、擦除与提取

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.42.0`（不变）
- 图片服务契约：`OpenDesign Image Service contract 4`
- 关联：ADR-0014、ADR-0089、ADR-0127、ADR-0132、ADR-0133、ADR-0134

## 背景

去背景与整图提示词编辑已经建立可信 Provider、可取消远端任务、可恢复来源谱系和原子事务边界，但用户仍不能在画布上指出图片中的具体对象。Figma 的公开图片编辑流程使用 `Select area` 进入 lasso，松开后可选择 Erase 或 Isolate；这类直接操作必须基于当前 Image 的真实 placement、旋转与翻转映射到源图，而不能让模型猜测画布坐标或让 disposable overlay 进入文档。

OpenAI Images edit API 接受与源图同尺寸、含 alpha 的 mask。该 mask 只用于引导模型，不是文档中由用户直接编辑的持久图层，因此应由 Main 从受校验的选区生成，并作为派生证据与结果一起原子提交。

## 决策

### 画布 lasso 是 session 状态

单选、未锁定、内嵌 PNG/JPEG/WebP Image 可从 Inspector 的 `Select area…` 进入。Canvas 使用覆盖层显示真实图片边界、用户拖出的 lasso 和 Erase / Isolate / Redraw / Cancel 操作；覆盖层不进入 `DesignDocument`、revision、history 或保存文件。

选区首先在 Image node-local 坐标中采样，再由 Image Service contract 4 按 Stretch/Fit/Fill/Crop、源图尺寸、rotation 与 flip 转换为 3～512 个归一化源图坐标点。非有限数值、退化面积、重复邻点和越界输入失败关闭。Escape、pointer cancel，以及 Page、tool、selection、node、asset 或 revision 变化都会取消 session 且不产生 revision。

### Main 生成并约束 mask

Renderer 与 Agent 只提交归一化选区，不得提交 mask bytes、路径、Provider 或模型参数。Main 解码当前源图并规范化为 PNG，在同源尺寸上生成 8-bit RGBA even-odd polygon mask：选区内 alpha 为 0，外部 alpha 为 255；PNG 尺寸和像素预算受限。

`ImageGenerationHost` 通过既有 `/images/edits` adapter 提交源图与 mask。Erase 使用固定移除选区对象的意图并请求自动背景；Isolate 使用固定提取选区对象的意图并请求透明背景。Host 在联网前校验源图与 mask 都是同尺寸 PNG 且 mask 含 alpha。Main 在 Provider 成功后校验结果可解码；Isolate 还必须返回真实透明像素。

### 一次可信事务提交结果

mask 以 PNG 内容 SHA-256 形成 supporting asset ID，但 Provider 失败、取消或输出无效时不进入文档。成功后 Runtime 要求 `maskAssetId` 与唯一 supporting PNG 精确对应，并在一笔事务中提交 mask asset、结果 asset、derivation 以及节点变化。

- Erase 更新当前 Image 的来源，保留节点身份、尺寸、placement、filters、圆角和其他属性。
- Isolate 保留原 Image 不变，在其后插入使用相同 transform、尺寸与图片属性的新 sibling Image。

两种动作均以 `expectedAssetId` 防止并发覆盖。一次 Undo 删除本次新增结果、mask、derivation，并恢复节点或移除新层。远端任务期间画布继续可操作，顶部只展示真实 pending 与 Cancel；成功时仅在用户仍选中源图的情况下选中新提取层，不抢夺后续用户选区。

### 人工与 Agent 共用同一边界

人工入口和 `opendesign_edit_image` 共用 Desktop API、ImageGenerationHost 与 Runtime planner。Agent 的 Erase 需要当前 inspection/capture 得到的 Page、Image node、`expectedAssetId` 与归一化 lasso；Isolate 还需要一个新的稳定 `resultNodeId`。工具不能直接写图片字节、mask、模型配置或 Renderer selection。

## 后果

- 用户可通过真实画布选择完成局部擦除或对象提取，过程不是 skeleton 或伪绘制动画。
- placement 与源图坐标转换集中在无状态 Image Service；React、Main 和 Provider adapter 不各自实现一套几何规则。
- mask 是可审计的派生输入，但只有与成功结果一起进入文档，不污染失败历史。
- Expand、局部提示词重绘、背景替换、重打光、风格统一、Image Paint 编辑与多参考图仍需后续切片。

## 验证

- Image Service 测试覆盖 Stretch/Fit/Fill/Crop、rotation、flip、去重、退化和输入边界。
- Main mask 测试覆盖 PNG 结构、CRC、同源尺寸、even-odd alpha 与像素预算；Host 测试覆盖 multipart mask、固定意图、背景模式、取消和网络前拒绝。
- Desktop API、Agent schema 与 bridge 测试覆盖精确 union、PNG mask provenance、禁止字节/路径/Provider 参数、稳定 result node 和 stale target。
- Runtime 与 App 测试覆盖 Erase/Isolate 原子事务、原层保留、新 sibling 属性、一次 Undo、Escape、revision stale、pending 期间继续选择以及取消零 revision。

## 参考

- [Figma：Make or edit an image with AI](https://help.figma.com/hc/en-us/articles/24004542669463-Make-or-edit-an-image-with-AI)
- [Figma：Use AI tools in Figma Design](https://help.figma.com/hc/en-us/articles/23870272542231-Use-AI-tools-in-Figma-Design)
- [OpenAI Image generation and editing](https://developers.openai.com/api/docs/guides/image-generation)
