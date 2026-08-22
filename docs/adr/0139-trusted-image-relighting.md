# ADR-0139：可信图片重打光

- 状态：已接受
- 日期：2026-08-22

## 背景

OpenDesign 已支持非破坏图片调整、整图提示词编辑、区域编辑、扩图、分辨率提升和独立背景替换，但“改变光线”仍只能借用自由提示词。自由提示词会把光线、背景、主体和风格混成同一意图，无法证明宿主只要求 Provider 改变照明，也无法为恢复谱系保存稳定语义。

Figma Weave 的公开产品行为把 `Change lighting` 作为独立图片工具，并让用户选择照明方向。OpenDesign 采用这一公开交互边界，但继续使用自有文档、事务和 Provider adapter。

## 决策

### 使用稳定 preset，而不是自由 relight prompt

图片重打光只接受以下 provider-independent preset：

- `natural-soft`
- `studio-softbox`
- `golden-hour`
- `moonlight`
- `neon`

Renderer 和 Agent 只提交 typed `lightingPreset`。Main 将 preset 映射为固定专业指令，要求保持主体身份、构图、几何、材质、文字、背景内容和相机视角，只改变光源方向、色温、强度、阴影与高光响应。Renderer、Agent 和文档都不接收宿主 prompt。

### 独立契约与派生语义

`DesignDocument 1.44.0` 的图片派生记录增加可选 `lightingPreset`；`relight` 必须存在该字段，且不得携带用户 prompt、mask 或参考图片。其他操作不得携带 `lightingPreset`。Image Service contract 8、Desktop API、Agent tool schema、Main host 和 EditorRuntime planner 共同验证同一不变量。

成功结果通过既有 `expectedAssetId` stale 门禁，以一笔 Runtime transaction 写入新 asset、typed derivation 和节点 source 引用。节点 transform、size、placement、filters、圆角和层级保持不变。取消、Provider 失败、返回 action/source/preset 不匹配或并发过期均为零 revision。

### 人工与 Agent 共用同一入口

Inspector 图片 More 菜单提供 `Change lighting…`，用户选择 preset 后执行；Agent 根据设计语境从同一 preset 集合选择。两条路径共用 Main `changeLighting`、Desktop API、来源谱系、Undo 和保存恢复。

## 后果

- 用户不需要编写容易漂移的重打光提示词。
- Provider prompt 可以继续优化而不改变文档语义或把内部指令冒充用户内容。
- 当前 preset 集合是公共契约；新增或改变含义需要同步 schema、Main 映射、Agent 描述和 UI 文案。
- 局部带提示词重绘、风格统一、大图按需加载和资源生命周期仍是后续工作。

## 验证

- Design contract：preset 与 derivation 组合、迁移和非法字段拒绝。
- Desktop API / Agent tool：typed request、互斥输入和返回结果校验。
- Main host：每个 preset 的固定指令、Provider 请求和失败边界。
- EditorRuntime：stale-safe 派生提交、来源恢复和 Undo。
- Renderer：More 菜单、preset 选择、pending/cancel 和完整 relight transaction。

## 参考

- [Figma：Use Weave tools](https://help.figma.com/hc/en-us/articles/40779260614935-Use-Weave-tools-in-Figma)
- [Figma：Bring imagery into your designs](https://help.figma.com/hc/en-us/articles/41159711083543-AI-workflows-collection-Bring-imagery-into-your-designs)
