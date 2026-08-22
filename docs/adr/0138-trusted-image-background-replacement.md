# ADR-0138：可信图片背景替换

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.43.0`
- 图片服务契约：`OpenDesign Image Service contract 7`
- 关联：ADR-0132、ADR-0133、ADR-0134、ADR-0137

## 背景

OpenDesign 已支持去背景和整图提示词编辑，但两者都不能准确表达“保留前景主体，只描述并替换背景”。把该意图继续记为普通 `prompt-edit` 会丢失可审计语义，也会让模型或用户重复编写易漂移的保主体约束。

Figma 当前把 Replace background 作为 Weave 的独立图片工具：用户选择图片、描述新背景并生成结果。该公开行为只用于确定产品入口与语义，不推断 Figma 私有实现。

## 决策

### 独立 typed operation

`DesignDocument 1.43.0` 新增 `replace-background` 图片派生操作，Image Service contract 7 将其纳入现有图片编辑动作。人工与 Agent 都只提交当前 `pageId/nodeId/expectedAssetId` 以及新背景描述；不接受 mask、reference、Provider、模型、图片字节或路径。

Main 校验 1–32,000 字符的非空描述，并在 Provider 边界追加固定保主体指令：保持身份、姿态、轮廓、比例、产品几何、Logo/文字、材质、边缘、构图与裁剪，只生成与主体空间关系一致的新背景。用户描述原样保存为 derivation prompt，宿主固定指令不冒充用户内容。

### 复用唯一 Provider 与事务链

`ImageGenerationHost` 复用全局 `openai-images` `/images/edits` adapter，单源图、`background=auto`、PNG 输出和既有超时/取消/响应大小限制。Provider 成功后，Renderer 重新验证 request/action/source/prompt 与零 reference/mask；只有节点仍引用 `expectedAssetId` 才通过 `derive-source` 在一笔 revision 中提交结果 asset、`replace-background` derivation 和节点 asset 引用。

节点 ID、层级、transform、design size、placement、filters、圆角和布局语义保持不变。取消、Provider 失败、无效输出、目标删除或 source 并发变化均零 revision；来源历史、保存重开和一次 Undo 保留原图。

### Inspector 与 Agent

Inspector 的紧凑图片 More 菜单新增“替换背景…”，复用现有 prompt editor，但使用专用标签、占位文案和提交动作，并隐藏不适用于该语义的参考图入口。运行时复用画布/Inspector 的真实 pending 与 Cancel，不锁定其他画布操作。

`opendesign_edit_image action=replace-background` 让模型只描述新环境；系统提示明确区分它与任意整图变换的 `prompt-edit`。两条入口共用 Main Provider、来源谱系、Runtime 和审计边界。

## 后果

- 背景替换成为可恢复、可取消、可审计的独立能力，不再依赖模型临时拼接保主体提示词。
- 当前 Provider 仍是生成式编辑，不能确定性证明每个前景像素完全不变；因此结果必须保留原图并允许 Undo/切换来源，不能宣称像素级抠图合成。
- 带提示词的局部重绘、重打光、风格统一、多参考图、大图按需存储和双平台原生产品证据继续作为后续切片。

## 验证

- Desktop API 与 Agent schema 拒绝空 prompt、reference、mask、Provider 和额外字段。
- Host 测试验证固定保主体指令、单源图、自动背景与取消/大小边界复用。
- Runtime 测试验证独立 derivation、零 supporting inputs、属性保持、stale、一次 Undo 和保存语义。
- App 测试验证 More 菜单、专用 prompt UI、真实异步提交、来源历史和节点几何/外观保持。

## 参考

- [Figma：Use Weave tools in Figma](https://help.figma.com/hc/en-us/articles/40779260614935-Use-Weave-tools-in-Figma)
- [OpenAI Image generation and editing](https://developers.openai.com/api/docs/guides/image-generation)
