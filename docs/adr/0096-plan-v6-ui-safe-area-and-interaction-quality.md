# ADR-0096：Plan v6 的 UI 安全区与交互目标质量门禁

- 状态：Accepted
- 日期：2026-08-19
- Agent Plan：`DesignPlan 6`
- Layout Quality：`DesignLayoutQualityReport 3`
- 文档协议：不变（质量策略属于 Run/Plan，不写入 `DesignDocument`）
- 关联：ADR-0018、ADR-0034、ADR-0050、ADR-0095

## 背景

Layout Quality Report v2 能确定性发现 Frame 越界，但只知道目标 artboard 和当前文档几何。一个底部导航按钮可以完全位于 Frame 内，却侵入设备 Home Indicator/Dynamic Island 等安全区；一个 20×20 的图标也可以位于 Frame 内，却不是可可靠操作的命中区域。让视觉模型在 capture review 中自行判断这些规则会产生假阳性、平台阈值漂移和重复修复。

不能只按 `390×844` 等 Frame 尺寸猜设备。Figma 的 Frame preset 提供常见设备/资产尺寸，Frame 本身承载 layout guides、constraints 与 auto layout；layout guides 是设计辅助，不等于设备安全区或交互语义。OpenDesign 因此保留 Figma-shaped Frame/layout 数据，并在 Agent Plan 上增加独立、显式、可验证的交付策略。

参考事实：

- Figma Frame 支持 preset、Clip Content、layout guides、constraints 与 auto layout；layout guides 是 Frame 内的结构辅助，不改变内容几何；
- Apple 建议 iOS/iPadOS 常用按钮命中区域至少 `44×44 pt`，macOS 至少 `28×28 pt`；
- Android 建议触摸目标至少 `48×48 dp`；
- WCAG 2.2 AA 的 pointer target 最小尺寸为 `24×24 CSS px`，另有 spacing 等例外。首个确定性切片不猜测例外，只检查 Plan 明确声明的实际 hit-area 节点。

## 决策

### Plan v6 为每个 target 声明质量 profile

每个 target 必须选择：

- `graphic`：Logo、海报、品牌资产、插画等非 UI 交付，不执行设备安全区或交互目标检查；
- `ui`：声明 `platform`、`interactionMode`、四边 `safeAreaInsets`、`safeAreaNodeIds` 与 `interactiveNodeIds`。

`safeAreaInsets` 是目标 Frame 的 parent-local 内边距。模型不得根据 Frame 尺寸猜设备；用户或产品上下文没有建立 inset 时使用零。`safeAreaNodeIds` 只列必须留在安全区内的前景内容，不应把可延伸至设备边缘的背景列入。`interactiveNodeIds` 必须是 `safeAreaNodeIds` 子集，并指向实际按钮/控件 hit-area Frame 或 layer，而不是其中 16–24 px 的可见 icon。

UI deliverable 只能使用 `ui` profile，其他 deliverable 只能使用 `graphic`。v2/v3/v4/v5 Plan 继续读取用于历史 journal 和恢复，但不获得未声明的设备规则；当前模型 schema 只生成 v6。高置信空白画布 compact first-slice 同样要求 profile并编译为 v6；缺少新字段的历史 compact input 仍按原规则编译为 v4/v5。

### 平台阈值由可信宿主拥有

模型不提交最小尺寸数值。`@opendesign/design-contracts` 固定解析：

- Android：`48×48`；
- iOS/iPadOS：`44×44`；
- macOS：`28×28`；
- touch/mixed 的其他平台：`44×44`；
- pointer-only Web/Windows/other：`24×24`。

报告返回实际 world-space 尺寸、所需尺寸和来源标签。后续如实现 WCAG spacing exception、平台 scale 或产品级覆盖，应版本化扩展策略，不允许模型在单次调用中降低阈值。

### exact-revision capture 执行检查

Main 将当前 active target 的 profile 绑定到 `RendererDesignCaptureTarget`。Renderer 在与离屏 capture 相同的权威 `DesignDocument` revision 上生成 Layout Quality Report v3：

1. 保留 v2 的 artboard identity、geometry、clipping 和 overflow 检查；
2. 验证每个质量节点存在、属于该 Frame 且有效可见；
3. 把显式 inset 转为 world-space safe-area bounds，检查前景节点是否完整包含；
4. 对交互节点检查 world-space displayed bounds 是否达到宿主阈值。

安全区恢复继续返回当前 parent-local position、最小 local delta 和 recommended position，并以 `constraint: safe-area` 区分普通 artboard containment。Frame 旋转、倾斜或缩放时首版 fail closed，不把轴对齐 inset 静默近似为正确设备区域。

Main 同时校验 report 的 document/revision/Page/Frame/profile 与当前 Plan 完全匹配。初稿 capture 把问题交给 typed visual review；refinement 后任何 error 都阻止 ledger 进入 `verified`。模型应移动安全区违规节点，并扩大实际 hit area；不能只放大 icon 冒充可点击区域。

### Amendment 与身份

Plan amendment 改变 inset、platform 或 interaction mode 会把已落地 target 重新置为 drafted。材料已经开始后，已有 safe-area 和 interactive node ID 不能删除或换名；可以新增质量节点。create target 的质量节点继续受 Run-scoped new-node prefix 约束，防止与未披露 Page 节点冲突。

## 后果与限制

- 解决“Frame 内但侵入安全区”和“视觉图标太小却被当作按钮”的确定性假阳性。
- 质量 profile 不进入 `.opendesign`，不制造 Figma 兼容字段，也不改变人工设计文档语义；它是 Agent delivery acceptance policy。
- 首版只检查显式节点，不从名称、颜色、图层 kind 或视觉外观猜哪些对象可交互。
- WCAG spacing exception、控件重叠/遮挡、文字截断、对齐/间距异常、焦点状态、视觉 critic 与设计 skill 仍是后续独立切片。
- 图形交付不受 UI 规则误杀；视觉美感仍不能由本报告证明。

## 验证

- contract 测试覆盖 profile 形状、平台阈值、唯一 ID、inset 边界和 UI/graphic 分流；
- Plan/compact schema 测试覆盖 v6、v4/v5 历史读取和 Main new-node namespace；
- EditorRuntime 测试证明节点完全位于 Frame 内但侵入 iOS safe area 时失败，并同时报告 32×32 小于 44×44；Android 48×48 合格；
- bridge/Main/Coordinator 测试证明 profile 经过受校验 capture target 进入 Renderer，篡改或丢失 profile 的 report 被拒绝；
- final ledger 继续由既有 exact-revision capture、inspection 和 `errorCount === 0` 门禁控制。

## 复审条件

引入 Device preset registry、响应式多 viewport 验收、WCAG spacing exception、交互原型语义、平台 scale 或用户可配置质量策略时复审。任何扩展仍必须显式、有版本、可重放，不能根据 Frame 名称或尺寸偷偷推断。
