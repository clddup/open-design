# ADR-0133：可信去背景图片编辑

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.42.0`（不变）
- 关联：ADR-0014、ADR-0127、ADR-0132

## 背景

OpenDesign 已有全局图片生成服务、非破坏图片属性和可恢复来源谱系，但没有一个真实 AI 图片编辑动作。把“去背景”伪装成重新生成或普通来源替换，会丢失操作语义，也无法保证原图恢复、并发安全和失败零写入。人工 Inspector 与 Agent 还必须共享同一 Provider、凭据、事务和取消边界，不能在 Renderer 新建联网路径。

Figma 的公开产品行为把 Remove background 作为选中图片上的独立异步动作。OpenAI Images API 则明确以 `/images/edits` multipart 编辑已有图片，并支持透明 PNG 输出。这两个公开事实足以确定产品交互和 adapter 形状，不推断任何私有实现。

## 决策

### 一套全局图片服务，两条窄 API 路径

现有 `GlobalImageGenerationSettings v1` 保持唯一应用级配置和凭据来源，用户界面改称“全局图片服务”。`ImageGenerationHost` 继续以 `/images/generations` 生成新图，并新增 `/images/edits` 去背景路径；不增加 Conversation Provider fallback、第二份 API Key 或模型名分支。

去背景请求使用 multipart，提交一个受限 PNG/JPEG/WebP 源图、固定保留主体的编辑意图、`background=transparent`、`output_format=png`、`size=auto` 与 `quality=auto`。请求复用 10 分钟硬超时、AbortSignal、24 MB 响应和 16 MB 图片上限。返回值必须通过 PNG 结构检查，并由 Main 解码为有效尺寸且至少含一个透明像素；Provider 只声称透明但返回不透明结果时失败。

### 远端工作完成后才原子写文档

Renderer 在调用前确认明确 Page、Image node 和 `expectedAssetId`，只允许内嵌 PNG/JPEG/WebP。Main 可持有短生命周期输入字节和输出字节，但凭据与网络不会进入 Renderer 或 Agent。Provider 成功后，Renderer 再对当前权威文档执行 stale 检查；只有节点仍使用 `expectedAssetId` 时才在一笔事务中提交：

1. 内容寻址的新 Image asset；
2. `operation=remove-background` 的 derivation，记录受限 provider/model/request provenance；
3. 当前 Image node 的 asset 引用更新。

节点身份、尺寸、placement、filters、圆角和其他属性保持不变。取消、Provider 失败、无效输出、选区变化后的目标删除或 asset 并发变化都不产生文档 revision；短生命周期 attachment cache 不构成 Design File asset。

### 人工与 Agent 入口

Image Inspector 提供紧凑 Remove background 动作，运行时不锁画布，显示 pending 和取消。成功后来源历史立即出现“去背景结果”，可切回原图并通过一次 Undo 回滚完整事务。

Agent 使用独立 `opendesign_edit_image`，首个 action 仅为 `remove-background`。模型只提交 inspection 返回的 `pageId/nodeId/expectedAssetId`，不接收源图 base64、Provider 参数或任意 provenance。Main 通过受信任内部只读桥取得当前源图，完成编辑后再调用内部派生事务；内部字节结果不进入 Provider transcript。

## 后果

- 去背景成为第一个真实、可取消、可恢复的 AI 图片编辑能力，原图永不被覆盖。
- 人工与 Agent 共用 Provider、来源谱系和 EditorRuntime，不形成 Renderer 网络旁路或第二份文档状态。
- 远端编辑时间不会阻塞画布，但仍取决于配置的图片模型；产品只展示真实 pending，不播放假绘制步骤。
- Image Paint、GIF、外部 URI、多图、局部重绘、扩图、背景替换、重打光和风格统一仍需后续独立切片。

## 验证

- Host 测试覆盖 multipart 字段、鉴权、透明 PNG 拒绝、大小和取消边界。
- Runtime 测试覆盖 typed derivation、stale、单事务、undo 与保存语义。
- Renderer bridge 测试覆盖受限源图读取、派生提交和通用 JSON 大小边界例外。
- App/Inspector 测试覆盖成功、来源恢复、属性保留、一次 Undo 和取消入口。
- Agent schema 测试证明模型输入不包含图片字节、Provider 或模型参数。

## 参考

- [OpenAI Image generation and editing](https://developers.openai.com/api/docs/guides/image-generation)
- [Figma Make or edit an image with AI](https://help.figma.com/hc/en-us/articles/24004542669463-Make-or-edit-an-image-with-AI)
