# ADR-0272：Figma-compatible 规则图形圆角平滑与精确 Flatten

## 状态

已接受。

## 背景

OpenDesign 已有语义化 Polygon/Star、节点级圆角、Boolean、Flatten 与受控 SVG，但规则图形的圆角此前依赖 Leafer 原生近似，且 Polygon/Star 没有 Figma-compatible `cornerSmoothing`。圆角图形因此无法进入 Boolean、Flatten 或 SVG 精确往返，画布、导出和派生几何也存在多份实现风险。

## 决策

1. `DesignDocument 1.56.0` 为 Polygon 与 Star 增加可选 `cornerSmoothing: 0..1`，默认 `0` 不强制序列化。旧文档迁移只升级 schema，不制造字段。
2. Geometry Service contract 30 用一次性 editable Vector Network 生成规则图形精确几何。Polygon 的 `cornerRadius` 作用于全部顶点；Star 只作用于外尖角。边长不足时先降低 smoothing，再限制 radius。
3. Leafer、Boolean、Flatten 与受控 SVG 共用同一 geometry resolver。零圆角图形继续使用 Leafer 原生 Polygon/Star；圆角图形投影为精确 Path，但权威文档仍保留语义化节点。
4. Flatten 输出真实几何的 tight bounds、可编辑 Vector Network 和一次 revision/undo；不增加 Polygon/Star 专用 Agent 工具，人工与 Agent 继续复用现有 Flatten 和 `update_properties`。
5. 受控 SVG regular-shape metadata 升级为 2：零圆角继续输出标准 `<polygon>`，圆角输出标准 `<path>`，并保存 point count、Star inner radius、corner radius、corner smoothing 与原始尺寸。导入只在 metadata 与标准几何精确一致时恢复语义节点；metadata 1 的零圆角图形继续读取，普通外部 SVG 不猜测语义。

## 影响

- 画布、Boolean、Flatten 和 SVG 不再各自维护 Polygon/Star 圆角路径。
- Inspector 与现有 Agent node property contract 均可编辑 smoothing；非法范围在 Provider 可见 Schema 与 Runtime 同一字段路径失败。
- Star 内角保持尖锐，这是规则 Star 的公开语义，不把同一 radius 机械应用到全部 `2N` 顶点。
- 真实 Leafer 像素 baseline 与 macOS/Windows 打包产品直接操作证据仍需单独补充，不能由单元测试替代。

## 公开语义参照

- [Figma：Adjust corner radius and smoothing](https://help.figma.com/hc/en-us/articles/360050986854-Adjust-corner-radius-and-smoothing)
- [Figma：Shape tools](https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools)
