# ADR-0137：可信图片分辨率提升

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.42.0`（不变）
- 图片服务契约：`OpenDesign Image Service contract 6`
- 关联：ADR-0132、ADR-0133、ADR-0136

## 背景

OpenDesign 已经通过同一图片服务、Main Provider adapter、来源谱系和 Runtime 事务支持去背景、整图提示词编辑、区域 Erase/Isolate 与 Expand。Figma 的公开图片工作流在 Expand 之后提供独立 `Boost resolution`：用户选择图片后直接执行，不要求输入提示词或倍率；异步任务运行期间仍可继续编辑其他内容。

GPT Image 2 当前允许编辑请求指定任意合规输出尺寸，但要求两边是 16px 倍数、最长边不超过 3840px、长短边不超过 3:1，并限制总像素；超过 3,686,400 像素的输出仍标为 experimental。OpenDesign 当前图片编辑结果还必须通过 16 MiB 的内嵌 asset 上限。把这些约束暴露给 Renderer、用户或模型会形成 Provider-specific UI，也无法证明输出确实比当前 source 更高分辨率。

## 决策

### 宿主计算唯一目标尺寸

Image Service contract 6 新增纯函数 `resolveImageUpscaleSize(sourceSize)`。它以源 bitmap 的整数像素尺寸为唯一输入，优先选择两轴约 2× 的输出；小图至少达到 Provider 最小像素预算，大图使用不超过 3840px、3,686,400 像素与当前内嵌结果预算的最大有意义尺寸。结果两边始终为 16px 倍数，宽高比不超过 3:1，并且总像素至少增加 5%。

源图宽高比超过 3:1、尺寸非法、已经没有合规的更大输出，或只能获得不足 5% 的像素增益时失败关闭。产品不提供倍率选择，也不把 Provider 限制写入文档协议。

### Main 规范化并验证像素

人工与 Agent 请求只携带当前 Page、Image node、`expectedAssetId` 和内嵌 source asset。Main 解码 source，验证 asset 声明尺寸与真实 bitmap 一致，将其规范化为 PNG，并根据真实透明像素决定 `background=transparent` 或 `auto`。`ImageGenerationHost` 使用固定的清晰度提升 prompt、`quality=auto`、精确 `size` 和 `/images/edits`；Renderer、Agent 与模型上下文不接收图片字节、目标尺寸、Provider 或凭据。

Provider 返回必须是精确目标尺寸 PNG；透明源还必须返回含透明像素的 PNG。格式、尺寸、透明度、取消或网络失败都会在 Main 中终止，不建立 attachment、asset、derivation 或 revision。

### 专用来源事务保持设计几何

成功结果成为新的内容寻址 image asset，并建立 `operation=upscale` derivation。derivation 不保存固定宿主 prompt，也不允许 mask 或 reference；extensions 只记录 provider/model/request ID、源/目标像素尺寸、透明度要求与像素增益，不记录路径或凭据。

Runtime 新增专用 `upscale-source` planner，再次验证：

1. Image node 仍引用 `expectedAssetId`；
2. 当前 source asset 像素尺寸仍与请求开始时一致；
3. result asset 尺寸等于 Image Service 对 source 计算出的唯一目标；
4. derivation 是无 prompt、mask、reference 的 `upscale`。

成功事务只写入结果 asset、derivation 和节点 `assetId`。节点的 design size、transform、placement、filters、圆角、布局语义和层级完全不变。一笔 Undo 恢复原 asset，并删除新结果与 derivation。普通 `derive-source` 不能伪造 upscale。

### 人工与 Agent 共用执行链

Inspector 在紧凑 `More image actions` 菜单中提供“移除背景”和“提升分辨率”，避免随着图片能力增加横向堆叠按钮。运行中画布与 Inspector 显示同一真实 pending 状态和 Cancel；切换选区不取消任务，用户取消、Provider 失败或 stale target 均零 revision。

`opendesign_edit_image action=upscale` 不接受 prompt、scale、mask 或 reference。Main 通过内部只读 bridge 获取当前 source，再使用与人工入口完全相同的 Host 和 `upscale-source` transaction。

## 后果

- OpenDesign 获得与 Figma 公开行为一致的一键分辨率提升，同时保持 Provider adapter 可替换。
- 提升的是 source 像素密度，不是画布节点尺寸；不会引发布局回流或改变裁剪构图。当前不请求 Provider 的 experimental 超大输出；大图按需 asset storage 完成后才能安全提高该上限。
- 生成式超分辨率仍可能重建高频细节，因此结果作为可恢复派生来源保存，原图永不覆盖。
- 带提示词的局部重绘、背景替换、重打光、风格统一、Image Paint 编辑和多参考图仍待后续切片。

## 验证

- Image Service 测试覆盖普通 2×、小图像素下限、大图上限、16px 对齐、无提升空间、非法像素与超宽比例。
- Host 测试覆盖固定 prompt、精确 size、透明背景、网络前目标拒绝和 Provider 输出尺寸漂移。
- Desktop API 与 Agent schema 测试覆盖无参数公开 action、禁止 scale/prompt/mask/reference，以及专用内部 commit。
- Runtime 与 Renderer execution 测试覆盖目标尺寸重算、普通 derive 旁路拒绝、stale source、单 revision、属性保持和一次 Undo。
- App 测试覆盖 More 菜单入口、真实异步请求、节点几何/placement/filter/圆角保持、来源历史和取消零 revision。

## 参考

- [Figma：Make or edit an image with AI](https://help.figma.com/hc/en-us/articles/24004542669463-Make-or-edit-an-image-with-AI)
- [OpenAI Image generation and editing](https://developers.openai.com/api/docs/guides/image-generation)
