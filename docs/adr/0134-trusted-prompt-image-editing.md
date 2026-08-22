# ADR-0134：可信提示词图片编辑与单参考图

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.42.0`（不变）
- 关联：ADR-0014、ADR-0127、ADR-0132、ADR-0133

## 背景

去背景已经证明人工 Inspector 与内置 Agent 可以共享同一图片服务、来源谱系、取消和原子事务边界，但它仍是一个固定意图的单图动作。Figma 的公开图片编辑流程允许用户用提示词编辑整张选中图片，并可附加一张参考图；OpenAI Images edit API 也允许在 multipart 请求中按顺序提交多张图片。OpenDesign 需要先建立这条通用而受限的整图编辑路径，再在后续切片中增加 mask、局部选择和扩图，避免把局部编辑的交互、几何和 provider 约束一次性混入。

## 决策

### 一个编辑 Host，两种明确动作

`ImageGenerationHost` 的 `/images/edits` adapter 支持 `remove-background` 与 `prompt-edit`。`prompt-edit` 接受 1～32,000 字符提示词、一个必需源图和最多一个可选参考图；multipart 中源图始终位于 `image[]` 第一项，参考图位于第二项，并请求 `background=auto`、`output_format=png`、`size=auto` 与 `quality=auto`。返回值必须是结构有效且可由 Main 解码为正尺寸的 PNG；只有去背景继续要求真实透明像素。

全局图片服务配置、凭据、10 分钟超时、大小限制和 AbortSignal 保持唯一。Renderer、Agent 和工具参数不能指定 Provider、模型、路径或内联图片字节。

### 参考图只通过既有授权边界进入

人工入口使用现有原生图片选择器取得一个有界、内嵌、内容寻址的 PNG/JPEG/WebP asset，但在远端编辑完成前不写入 Design File。Agent 入口只接受当前 Run 已授权的 `referenceAttachmentId`；Main 通过 `AgentReferenceHost` 复核并物化图片。源图和参考图字节只在 Main 的短生命周期请求中存在，不回传模型 transcript。

### 结果、参考图和来源谱系一次提交

Provider 成功后，Main 返回内容寻址结果 asset、可选 supporting reference asset 与 `operation=prompt-edit` 的 derivation。derivation 保存裁剪后的原始提示词、`referenceAssetIds` 以及受限 provider/model/request provenance。Renderer 再以当前权威文档和 `expectedAssetId` 规划一笔事务，按顺序提交：

1. 文档中尚不存在的 supporting reference asset；
2. 结果 asset；
3. prompt-edit derivation；
4. Image 节点的新 asset 引用。

Runtime 要求 supporting asset 与 derivation 输入精确对应，拒绝缺失、无关、重复、自引用或同 ID 不同内容。成功保持节点身份、尺寸、placement、filters、圆角和其他属性；一次 Undo 回滚结果、引用、谱系和本次新纳入的参考图，保存重开保持完整 provenance。Provider 失败、取消、无效输出或 stale target 都不产生 revision。

### 紧凑 Inspector 工作流

Image Inspector 提供内联“使用提示词编辑”入口，包括提示词、可选参考图、执行和取消。文件选择期间和远端编辑期间画布保持可操作；运行状态说明真实动作，不播放假绘制过程。去背景继续作为并列的直接动作。Agent 复用原 `opendesign_edit_image`，不增加第二个图片编辑工具。

## 后果

- OpenDesign 获得可恢复的整图自然语言编辑，并支持一张真实参考图，而不牺牲原图或并发安全。
- 参考图成为可验证的文档 provenance，不是隐藏在 Provider 请求中的不可恢复输入。
- 结果仍是普通 Image asset，因此现有画布渲染、位图导出、保存和来源历史无需新增旁路。
- mask、Select area、Erase、Isolate、Expand、Boost resolution、多参考图和 Image Paint 编辑仍需后续垂直切片。

## 验证

- Host 测试覆盖 prompt 边界、multipart 图片顺序、单参考图限制、PNG 输出和网络前拒绝。
- Desktop API 与 Agent schema 测试覆盖精确 union、Run 授权附件 ID、禁止路径/字节/Provider 参数，以及 derivation/supporting asset 对应关系。
- Runtime 与 Renderer bridge 测试覆盖 supporting asset 原子提交、保存重开、一次 Undo 和无关/缺失/冲突输入失败关闭。
- App 测试覆盖提示词编辑器、参考图选择、属性保留、取消、来源谱系和零 revision 失败语义。

## 参考

- [Figma：Make or edit an image with AI](https://help.figma.com/hc/en-us/articles/24004542669463-Make-or-edit-an-image-with-AI)
- [OpenAI Image generation and editing](https://developers.openai.com/api/docs/guides/image-generation)
