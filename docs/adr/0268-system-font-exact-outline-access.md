# ADR-0268：系统字体精确轮廓访问

## 状态

已接受。

## 背景

OpenDesign 已能通过用户显式导入的 TTF、OTF 与 TTC 字体为 HarfBuzz 提供确定性 shaping、glyph outline、文字装饰、Capture、Raster Export 与 Text Flatten。普通系统字体此前只能由 Chromium/Leafer 原生渲染；当设计使用未导入的本机字体时，画布可以显示文字，但精确 glyph outline 不可用，Flatten 与依赖 outline 的交付路径必须失败关闭。

专业桌面设计工具应直接使用当前设备已安装字体，同时不能自行枚举 macOS、Windows 字体目录、向 Renderer 暴露路径，或把系统字体字节写入 DesignDocument。

## 决策

1. 桌面 Renderer 使用 Chromium Local Font Access API 获取本机字体 metadata 与 SFNT bytes，不增加平台路径扫描、Preload 字体文件桥或双平台条件分支。
2. Main 只向当前可信顶层 Renderer 授予 `local-fonts` 权限；其他 WebContents、子 Frame 和其他权限一律拒绝。授权不产生任意文件系统能力。
3. Renderer 先按 Component Instance 与 Shared Text Style 的正式投影解析当前 DesignDocument，再只读取实际文字节点引用的 family。未使用的 Library Component 与 Text Style 不触发字体 bytes 读取。
4. 每个字体文件仍受 32 MB 上限和 HarfBuzz 的 SFNT 校验。字节以 SHA-256 生成现有 `font_<sha256>` 运行时 ID；相同内容在系统字体与显式导入路径之间只注册一次。
5. 系统字体只进入当前进程的可丢弃 HarfBuzz registry，不进入文档、history、autosave、Agent context 或持久字体资源。普通浏览器显示继续使用系统已有字体；显式导入字体仍通过 `FontFace` 注册以支持原生投影。
6. 打开文档及文档变化时按需 hydration；Agent 设计工具在执行精确 Capture、Export 或 Flatten 前等待当前文档字体 hydration。等待接受 Run 的 `AbortSignal`，取消后不得继续设计执行。
7. API 不可用、权限拒绝、单个字体不可读或无有效 face 时不阻塞普通编辑。Typography Inspector 显示精确轮廓不可用及显式导入恢复入口；需要 outline 的既有 Runtime 路径继续返回确定性 fidelity failure，不猜测轮廓。

## 影响

- macOS 与 Windows 共享 Chromium/Electron 的同一 API 和同一实现，不维护字体目录兼容表。
- 当前设备可获得系统字体的精确 glyph outline，但设计文件仍未携带字体授权或字体 bytes；跨设备打开时字体集合不同仍可能产生明确 missing/fidelity 状态。
- Variable font axes、OpenType feature 选择、字体随 Design File 迁移与双平台像素 baseline 仍是后续独立切片。

## 验证

- Main 权限测试覆盖可信顶层 Renderer、非字体权限、其他 WebContents 与跨源子 Frame拒绝。
- Local Font Access 测试覆盖 Component/Style 投影、未使用 Style 排除、family 过滤、内容寻址去重、坏 face 隔离、失败后重试与取消。
- Renderer Design Tool 测试证明工具执行等待字体 hydration，并在等待期间取消后停止。
- macOS 与 Windows 的真实安装包字体选择、Capture、Flatten 和像素对比仍需单独产品 smoke，不能由结构测试冒充。
