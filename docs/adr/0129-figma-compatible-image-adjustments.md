# ADR-0129：Figma-compatible Image 非破坏调整

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.40.0`
- Image Service：contract 3
- 渲染后端：`leafer-editor` / `@leafer-in/filter` / `@leafer-ui/draw` 2.2.9
- 关联：ADR-0031、ADR-0089、ADR-0127

## 背景

OpenDesign 已有 Image 节点、内容寻址 asset、Fit/Fill/Crop、焦点、旋转/翻转、来源替换、画布直接裁剪，以及单目标 PNG/JPEG/WebP 导出，但不能调整曝光、对比度或色彩。海报、品牌物料和真实 UI 素材因此需要在外部软件预处理，Inspector 与 Agent 也无法在不覆盖原始 asset 的前提下修正图片。

Figma 公共 Plugin/REST 边界把基础图片调整定义为七个可选 `-1..1` 字段：`exposure`、`contrast`、`saturation`、`temperature`、`tint`、`highlights`、`shadows`，缺省值均为 `0`。Leafer 2.2.9 的公开图片类型声明了同名字段，但官方文档明确当前只提供自定义 filter 基础设施，没有公开标准图片调整处理器。直接把字段写给 Leafer 会形成“文档可保存、画布无效果”的假能力。

## 决策

### 文档保存七项稀疏调整

`DesignDocument 1.40.0` 在 Image 节点 `properties.filters` 增加七个可选字段，范围严格为 `-1..1`。缺失字段、空对象和显式零在视觉上等价；Image Service 在写入前按固定字段顺序 clamp 并删除零值。旧 `1.39.0` 文档确定迁移到当前协议，不猜造调整值。

当前切片只覆盖 OpenDesign 的正式 Image 节点。通用 Shape 的 Image Paint 可能与其他 Fill/Stroke 叠加，不能把整节点 filter 冒充单个 paint filter；其文档、Inspector、渲染与 Figma paint adapter 必须在后续完整切片共同实现。

### 一个 OpenDesign-owned RGBA 投影服务

Image Service contract 3 提供确定性 sRGB RGBA 调整函数：曝光、对比度、色温/色调、饱和度、高光与阴影按固定顺序处理，alpha 原样保留。字段形状与范围兼容 Figma 公共 API，但不宣称与 Figma 私有像素实现逐像素相同。

Leafer adapter 通过固定版本 `@leafer-in/filter` 注册 OpenDesign 自有 processor。processor 只读取当前元素的 axis-aligned world bounds，并以最多 1,048,576 像素的分块处理，避免复制整张画布或为大图创建单个超大 `ImageData`。生产画布、exact-revision capture 和 PNG/JPEG/WebP export 都消费同一 Leafer projection，因此不建立截图专用或导出专用第二套滤镜。

SVG 1.1 vector interchange 当前整体拒绝 Image 节点与 Image Paint，不会静默丢失调整后导出未调整图片。SVG 位图嵌入与滤镜保真属于后续能力。

### 人工与 Agent 共用专用事务

Inspector 在现有 Image 区域显示七个紧凑滑杆/数值控件。拖动期间只更新控件 draft，pointer release、键盘确认或 blur 才提交一笔 `planImageNodeUpdate(action=set-filters)` 事务，避免一次拖动产生大量 revision/undo。Reset 提交空对象。

`opendesign_update_image` 增加 `set-filters`，只接受 inspection 返回的稳定 Page/Image IDs 与严格七字段 schema。通用 Agent apply 修改已有 Image 的 asset、placement 或 filters 时失败关闭，防止绕过专用 source/placement/filter planner。来源替换只更新 asset/可选 placement，因此保留现有 filters。

## 后果

- 用户可以在不改变原始 asset 的前提下调整真实图片，保存重开、undo/redo、Agent 修改、画布、capture 和位图导出保持一致。
- Figma interop 在隔离包中验证七字段 Plugin API 形状；Figma 类型不会进入 Core 文档或 Runtime。
- `@leafer-in/filter` 与 `@leafer-ui/draw` 成为 `@opendesign/leafer-engine` 的固定直接依赖并记录 MIT notice；Leafer filter 对象仍是可丢弃投影，不进入文档。
- Image Paint 调整、SVG 位图、P3/ICC、AI 局部编辑、GPU/WASM 加速与 macOS/Windows 原生产品证据继续保持明确边界。

## 验证

- Design contracts 覆盖字段范围、未知字段拒绝与 `1.39 → 1.40` 迁移。
- Image Service 覆盖稀疏归一化、七项确定性变换、alpha 保持和非法 RGBA 拒绝。
- EditorRuntime 覆盖专用 planner、no-op、单 revision/undo、JSON 保存重开与来源替换保留。
- Leafer 覆盖 filter projection、真实 processor 注册、有界像素区域与 alpha 保持。
- Inspector 与 Agent 覆盖交互提交、reset、严格 tool schema、通用 apply 旁路拒绝和 trusted Renderer 执行。
- Figma interop 覆盖公共 `ImageFilters` 七字段 round-trip。
