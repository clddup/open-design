# ADR-0019：图片 placement 采用版本化非破坏语义并按纵向切片演进

- 状态：已接受
- 日期：2026-08-10
- 文档协议：`1.3.0`
- 补充：ADR-0010、ADR-0011、ADR-0012
- 后续：画布直接裁剪 Session 已由 ADR-0089 实现
- 取代：ADR-0011 中“下一次协议升级必须同时交付所有专业基础字段”的单体升级要求；专业能力仍须完整设计，但允许按可独立迁移和验证的纵向切片升级

## 背景

旧 Image 节点只有 `fill / contain / cover`，无法区分 Figma 类产品中的 Stretch、Fit、自动 Fill 与用户可编辑 Crop，也无法持久化焦点、缩放、旋转和翻转。ImagePaint 虽有 Leafer 风格的 offset/scale 字段，但没有完整的人机交互、Agent 工具、迁移和跨后端语义，不能据此宣称支持专业裁剪。

Figma 的图片裁剪是非破坏性的：双击图片或从检查器进入 Crop 后，可在画布内重定位、缩放和旋转，隐藏区域仍保留；Fill/Fit/Crop/Tile 与可逆图片调整属于同一图片属性工作流。OpenDesign 采用相同的产品原则，但文档协议不得复制 Figma 或 Leafer 的私有对象。

## 决策

### `DesignDocument 1.3.0` 拥有 Image placement

Image 节点不再保存含义模糊的 `fit` 字符串，改为版本化 `placement`：

- `stretch`：非等比铺满节点边界。
- `fit`：保持比例并完整显示图片。
- `fill`：保持比例覆盖边界，并保存归一化焦点。
- `crop`：在原 asset 上保存归一化焦点、`1..64` zoom、旋转和水平/垂直翻转。

placement 属于节点实例，而不是 asset。同一原图可在多个节点中使用不同裁剪；裁剪、undo/redo、保存和重开都不修改或重复压缩原始 asset。

`1.0.0 / 1.1.0 / 1.2.0` 文档在内存中确定性升级：旧 `fill → stretch`、`contain → fit`、`cover → fill(center)`，迁移来源写入 namespaced extension。未知版本继续拒绝，正常保存前不改写源文件。

### Image service 负责确定性几何

新增 `@opendesign/image-service`，输入版本化 placement、源图片尺寸和目标节点尺寸，输出引擎无关的 resolved placement。服务负责旋转后的 cover 比例、焦点约束、翻转和空白像素防护；不持有文档，不读取路径，不修改 asset。

Leafer adapter 把 resolved placement 投影为固定 `leafer-editor@2.2.9` 的 `stretch / fit / clip` 图片填充。Renderer、Agent 和文档中都不保存 Leafer paint JSON。后续像素调整、滤镜、颜色管理和导出准备继续扩展 Image service，并优先接入经过许可与跨平台验证的成熟实现，而不是在 React 或 adapter 中手写像素算法。

### 专业能力按纵向切片升级

一次同时引入 layout、rich text、component、token、image 和 export 的单体协议升级会阻塞可独立验证的高优先级能力。后续允许每个专业能力单独升级协议，但每个切片仍必须覆盖 schema、migration、runtime、human UI、Agent、provider、persistence/export、undo/redo 和能力清单；未覆盖完整表面的能力保持 `degraded`，不得以底层字段存在冒充完成。

当前纵向切片已经覆盖协议、迁移、确定性 crop geometry、Leafer 投影、检查器 placement 控件、受限文件选择、来源替换，以及人工 UI/Agent 共用的显式 Page/node planner。来源替换以 `put_asset + update_properties + 可安全删除旧 asset` 的单个事务执行；共享 asset 保留，取消或失败不产生 revision，Agent 不读取实时选区。ADR-0089 已补齐画布直接 Crop 的拖拽/缩放、Enter 单事务应用、Escape 零 revision 和 stale session 取消；图片 adjustments/filter、AI 像素编辑、完整产品保存重开 smoke 和真实 macOS/Windows 指针验证尚未完成，因此 `image.crop-adjustments` 继续标记为 `degraded`。

## 验证

- Schema 拒绝越界焦点、低于 1 的 zoom、未知字段和不完整 crop。
- 三种旧 fit 值确定性迁移并记录来源。
- Image service 覆盖 center fill、焦点边界、旋转、翻转、零尺寸拒绝。
- Leafer projection 对固定尺寸生成稳定 clip/scale/offset/rotation，且不改写 asset。
- 后续 UI/Agent 切片必须补齐 Enter 应用、Escape 取消、一次 undo、保存重开、来源替换、macOS/Windows 键盘与指针行为测试。

## 参考

- Figma：<https://help.figma.com/hc/en-us/articles/360040675194-Crop-an-image>
- Figma 图片属性：<https://help.figma.com/hc/en-us/articles/360041098433-Adjust-the-properties-of-an-image>
