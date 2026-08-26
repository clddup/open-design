# ADR-0178：Native File Import/Export IPC 单一契约

状态：已接受

## 背景

独立 Design File、SVG 与 Raster 的原生打开/保存桥共享“Renderer 只能提交内容与建议文件名、Main 独占真实路径”的安全边界，但其 request/result 结构长期散落在巨型 `desktop-api.ts`。文件名、SVG 长度、Raster 格式/MIME/字节/尺寸和 exact keys 由多个手写 guard 重复判断；独立 Design File 的 open/save response 甚至未在 Preload 返回 Renderer 前验证。

## 决策

- `native-file-contract.ts` 唯一拥有 Open/Save Design File、Open/Save SVG 与 Save Raster 的 request/result executable schemas 和 Contracts；`desktop-api.ts` 只作为稳定 facade 重导出类型与布尔适配。
- `portable-file-name.ts` 以结构 schema 表达长度、控制字符与跨平台禁用字符，以唯一 refinement 处理空白、`.`/`..`、尾部点/空格及 Windows 保留名称。所有 Native File Contract 复用该 owner。
- Raster request schema 直接约束格式、MIME、`Uint8Array`、编码大小和尺寸；格式与 MIME 的对应关系作为单一跨字段 refinement 返回 `/mimeType`，避免多 discriminant union 把错误错误归因到另一分支。
- Preload 现在同时验证独立 Design File 的 open result、save request 与 save result；SVG/Raster 保持双向验证。Main 继续独占 native dialog、路径解析、覆盖、原子写入、UTF-8/字节预算和 sender 校验。
- 不改变 IPC channel、对话框行为、文件扩展处理、存储格式或 macOS/Windows 路径策略，不增加 Renderer 路径字段或兼容双写。

## 验证

Desktop API、Standalone Design File IPC、SVG IPC/Service、Raster IPC/Service 与 Renderer Import/Export workflow 定向测试覆盖全部 request/result、跨平台文件名、未知路径字段、SVG 内容预算、Raster format/MIME、字节和尺寸及稳定 issue path。Desktop TypeScript、ESLint、Prettier 与 production build 覆盖 Main/Preload/Renderer bundle。
