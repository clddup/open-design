# ADR-0130：Figma-compatible Image Paint 非破坏调整

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.41.0`
- Image Service：contract 3
- 渲染后端：`leafer-editor` / `@leafer-ui/draw` 2.2.9
- 关联：ADR-0070、ADR-0129

## 背景

ADR-0129 已让独立 Image 节点支持七项非破坏调整，但 Figma 的公开文档模型没有 Image Node；图片属于 Shape、Frame 或 Text 的某个 Image Fill/Stroke。同一层可以有多项 Paint，节点级 filter 会错误处理其他 Fill、Stroke 和 Effect，因此不能作为 Image Paint 的兼容实现。

Leafer 2.2.9 的公开 `IImagePaint.filter` 和 `PaintImage.applyFilter/recycleFilter` 为每个 Paint 预留了处理边界，但没有发布标准图片调整 provider。只保存字段会形成画布无变化的假能力。

## 决策

### 文档与设计系统共用一种 Image Paint

`DesignDocument 1.41.0` 在 `ImagePaint` 增加可选 `filters`，直接复用 ADR-0129 的七项 `-1..1` 稀疏字段和 Image Service contract 3 的归一化、像素顺序与 alpha 保持规则。节点 Fill/Stroke、Text run Fill、local Paint Shared Style、Component Main 与 Instance 派生外观继续保存和解析同一个 Paint 结构，不增加私有副本或 flatten asset。

`1.40.0` 文档确定迁移到当前协议；旧 Paint 不猜造调整值。来源替换通过 Paint spread 保留 filters，asset 删除同时检查普通 Paint、Text run Paint 和 local/imported Paint Style 引用。

### 人工与 Agent 锁定具体 Paint 身份

Inspector 在每个 Image Fill/Stroke 行内显示紧凑调整控件。拖动只更新本地 draft，pointer release、键盘确认或 blur 才调用 `planImagePaintFilterUpdate` 并提交一笔 revision/undo；Reset 只清当前 Paint。

`opendesign_update_image action=set-paint-filters` 必须携带 inspection 返回的 `pageId`、`nodeId`、`paintField`、`paintIndex`、完整 `expectedPaint` 和 filters。planner 在当前权威 revision 重新检查 Page、节点、Paint index 与完整 Paint identity；重排、删除、换图或其他 Paint 属性变化后返回 stale，而不是让模型重写完整 fills/strokes 数组。通用 Agent apply 修改已有 Image Paint filters 时失败关闭。

### 每 Paint 派生渲染缓存

Leafer adapter 在 `PaintImage.applyFilter` 正式边界安装 OpenDesign provider。原图 ready 后，provider 按“原始 Leafer image + 规范化 filters”创建并复用调整后的 Canvas 派生 image；每次最多处理 1,048,576 像素的 RGBA 分块。派生 image 只存在适配器缓存，不进入 DesignDocument、asset registry、history、保存文件或模型上下文；空闲变体有界回收，原图销毁时清理全部派生资源。

每项 Image Paint 独立携带 Leafer filter 数组，因此多个 Fill/Stroke、Text run、local Shared Style 和 Component 投影不互相污染。生产画布、exact-revision capture 与 PNG/JPEG/WebP export 共用同一 Leafer projection 和派生缓存。

SVG 1.1 当前仍明确拒绝 Image Paint，不会静默导出未调整图片。Figma 隔离 adapter 继续以官方 `ImageFilters` 七字段形状验证兼容边界；完整 imageHash/transform 文件导入导出仍属于后续格式适配。

## 后果

- 首次使用某个原图/调整组合需要生成一次派生像素；相同组合后续复用，文档与 undo 不携带派生字节。
- 同一原图允许多个同时活跃的调整组合；只回收未被 Paint 使用的空闲派生项。
- Image Service contract 保持 3，因为 RGBA 算法和公共服务职责未改变；文档协议升级为 1.41.0。
- standalone 跨 Design File Image Paint Style 在 Library release 中缺少独立 asset bundle 时明确拒绝发布，不产生能引用却无法渲染的假 Library；Style asset dependency bundle 由后续 Library 切片承接。
- SVG 位图嵌入、P3/ICC、GPU/WASM 大图加速、完整 Figma imageHash/transform adapter 与双平台原生产品 smoke 继续保持门禁。

## 验证

- Design contracts 覆盖 Image Paint filters 范围、未知字段拒绝与 `1.40 → 1.41` 迁移。
- EditorRuntime 覆盖 Fill/Stroke index、完整 Paint stale identity、单 revision/undo、保存重开和来源替换保留。
- Inspector 覆盖 deferred slider commit、Reset 和具体 Paint 目标参数。
- Agent 覆盖严格 tool schema、trusted planner 执行与通用 apply 旁路拒绝。
- Leafer 覆盖每 Paint projection、派生图复用、RGBA 生效，以及与节点级 filter 的隔离。
