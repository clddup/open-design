# ADR-0031：版本化专业位图导出与 Main 原生交付边界

- 状态：已接受（共享实现与自动化完成；macOS/Windows 打包产品保存实测待完成）
- 日期：2026-08-12
- 补充：ADR-0005、ADR-0009、ADR-0011、ADR-0015、ADR-0023
- 固定渲染 provider：`leafer-editor 2.2.9`

## 背景

OpenDesign 已有两条图像相关链路，但都不能充当专业位图交付：`opendesign_capture_canvas` 是为 Agent 视觉审查限制到 1280×960 的 JPEG；SVG v1 是可编辑交换服务，不生成 PNG/JPEG/WebP。把截图直接保存、把编码器手写进 Renderer，或让 Agent 提交目标路径都会混淆审查与交付、扩大 Electron 权限边界，并产生与权威设计文档脱离的输出路径。

Figma 的公开产品行为把 layer/Frame 作为稳定导出目标，并显式提供倍率或固定边长、透明度、JPEG 质量和原生保存。OpenDesign 采用这些可验证的产品语义，同时加入 WebP；不复制 Figma 私有实现，也不把尚未完成的 Slice、批量、多 export configuration、Display P3 或 PDF 宣称为可用。

## 决策

### Raster Export v1 是独立契约

`@opendesign/import-export-service/raster` 定义 `RASTER_EXPORT_VERSION = 1`。请求只包含：

- 明确 `pageId + rootNodeId`；
- `png | jpeg | webp`；
- `1× | 2× | 3×` 或固定输出宽度/高度；
- 透明或六位十六进制背景色；JPEG 必须有明确颜色背景；
- JPEG/WebP 质量与 `smooth | pixelated` 重采样。

纯 planner 在创建渲染 surface 前计算保持纵横比的整数输出尺寸，并执行单边 16384 px、总计 100,000,000 像素预算。PNG 不接受无效质量字段，JPEG 不接受透明背景，跨进程编码结果限制为 256 MiB。这里的预算用于阻止错误或伪造请求分配无界内存，不替代未来可配置的大图/切片服务。

首版只导出一个稳定 layer、Group 或 Frame。多选批量、组合多 root、Slice、整页、多份持久 export settings、PDF、颜色配置和资源切图进入后续版本，不能由 v1 隐式猜测。

### 冻结文档与离屏 Leafer 投影

人工入口在开始时冻结当前 `DesignDocument`、revision、Page 和唯一选中 root；Agent 只接受最近一次 `opendesign_inspect_document` 返回的稳定 Page/root ID，不读取发送时或实时选区。Renderer 创建独立、不可命中的离屏 Leafer adapter，投影冻结文档并调用 `leaf.export()` 的官方 PNG/JPEG/WebP 能力。导出期间的 pan、zoom、选区、窗口尺寸、活动 Design File 和后续 revision 都不能改变本次像素。

`LeaferEngineAdapter.exportRaster()` 与 `capture()` 保持两个接口。后者继续是有界审查 JPEG；前者返回原始交付 bytes、MIME 和精确输出尺寸，不进入附件 store，也不受 review 尺寸/质量限制。两条链路不得互相冒充。

### Main 保存 bytes，但不拥有第二个渲染器

Renderer 只把 `suggestedName + format + MIME + Uint8Array + dimensions` 交给类型化 Preload。Main 再次 exact-shape 校验，按格式打开原生保存框，并把字节先写入同目录唯一临时文件后原子 rename。目标路径不返回 Renderer、Agent utilityProcess 或模型；Renderer/Agent 输入也不能提交 `filePath`。

Main 不解析 DesignDocument、不创建 Leafer 场景，也不重新编码图片。它只负责原生对话框、路径扩展名、字节预算、取消检查和原子文件落盘。POSIX 与 Windows path semantics 分别验证；JPEG 接受 `.jpg/.jpeg`，其他格式只接受精确扩展名。

### 人工与 Agent 共用交付链

Properties Inspector 的 Export 区提供 SVG/PNG/JPEG/WebP 格式选择。位图模式显示倍率/固定边长、预估尺寸、透明/背景、质量、重采样、单目标限制、进行中、取消、成功、错误状态；切换格式不会修改文档、selection、revision 或 undo history。标题栏和 File 菜单的导出命令执行当前 Inspector 格式，不再写死为 SVG。

`opendesign_export_raster` 只接受版本化设置、稳定 Page/root ID 和 portable suggested name。Renderer 返回受限的内部 preparation；Main 校验 revision、target、format、MIME、dimensions 和 bytes 后调用同一 `RasterFileService`。utilityProcess 最终只得到 `saved/name/format/dimensions/byteSize/revision/rootNodeId`，不获得 bytes 或路径。用户取消保存框是正常 `saved:false`，不是设计失败。

## 结果与限制

- PNG/JPEG/WebP 不再依赖手写编码器，也不建立第二份文档状态。
- 人工与 Agent 使用同一格式语义、Renderer provider 和 Main 保存服务。
- 导出是只读操作；成功、失败或取消都不产生 revision/history/selection 变化。
- Renderer export 仍在 Web 进程异步执行。大图 UI 帧时间和真实取消响应需要 macOS/Windows 打包产品继续验收；如基准证明需要，再把渲染调度迁入专用 worker/offscreen provider，不改变 v1 请求语义。
- 当前尺寸预览来自节点逻辑尺寸；最终保存报告使用 Leafer 实际 render bounds 的精确输出尺寸。旋转、描边与 effect 可能让两者不同。
- 当前无批量、多配置、Slice、PDF、P3/ICC、资源命名后缀和跨格式 resampling benchmark，因此 capability 保持 `degraded`。

## 验证

- contract tests 覆盖倍率/固定边长、纵横比、格式特定字段、维度/像素/bytes 预算和未知字段拒绝。
- Leafer adapter tests 覆盖格式、背景、质量、重采样、精确尺寸和缺失 target。
- Renderer tests 覆盖冻结文档、隔离投影、清理、取消、Agent preparation 和 selection 不参与目标解析。
- Main/Preload/IPC tests 覆盖 exact-shape、MIME、路径不外泄、取消、原子替换及 POSIX/Windows 扩展名。
- UI tests 覆盖格式、尺寸、单目标、进度、成功和文档零 revision；Agent host tests 覆盖 forged/stale preparation、原生取消和模型结果不含 bytes/path。
- macOS/Windows 打包程序仍需分别验证保存框、目录选择、覆盖、取消、1×/2×/3×尺寸、透明 PNG/WebP 与 JPEG 背景；完成前不标记 `available`。
