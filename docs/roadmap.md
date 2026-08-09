# OpenDesign 路线图

本路线图按架构依赖组织，不按临时反馈逐项追加。完整产品边界由 [`design-capability-baseline.md`](design-capability-baseline.md) 定义；每个实施切片必须同时覆盖公共语义、事务、人工 UI、Agent、渲染/导出、持久化和验证。

## P0：稳定当前 `1.1.0` 与 Leafer 迁移

- 为 host-only `put_asset + insert_element(image)` 内部事务补 Renderer 集成测试，验证单次 revision、作用域和一次 undo 同时移除 asset/node。
- 为 Agent composer 的剪贴板粘贴和文件拖放补交互测试，验证 Renderer 只提交 bytes，最终 run 只携带安全附件元数据。
- 让 HTTP(S) 图片读取的超时和取消覆盖 body stream，而不只覆盖 response headers；补慢 body、超限和取消测试。
- 在本仓库启动的 Electron 实例中复验：Agent 渐进事务期间 pan/zoom/resize 后 Leafer editBox 始终贴合选区，不出现巨大蓝色角、残影或输入锁死。
- 实机复验复杂渐变/光晕/模糊、属性检查器同步、本地路径/URL `read_image`、粘贴/拖放附件和 `place_image`。

完成条件：全仓 `pnpm verify` 通过，关键 Electron 交互写入 `verification.md`，ADR-0009/0010 的验证项有实际证据。

## P1：专业能力契约

- 为完整能力矩阵建立独立版本的 capability manifest，逐项记录 `available / degraded / unavailable`、provider、限制和验证证据。
- 设计一个完整的专业基础文档版本，统一正式 Vector/Path/Line/Polygon/Star、constraints/layout、富文本/font、图片 crop/adjustments、Component/Instance/Variant、style/token binding 和 export settings。
- 提供确定性迁移、未知版本拒绝、保存重开、preview、undo/redo、Agent schema 和 fidelity warning 测试；不得把长期语义藏进 `extensions`。

## P2：精确图层、变换与矢量

- 补齐创建、重命名、复制、删除、编组/解组、层级移动、跨容器移动和批量图层命令。
- 补齐对齐、分布、等间距、翻转、原点、智能吸附、参考线、标尺和像素对齐。
- 评估并固定成熟 geometry kernel，承载 Pen/path 节点编辑、布尔运算、flatten 和 outline stroke；不在 React 或 Leafer adapter 中手写计算引擎。

## P3：布局、文字与设计系统

- 建立 OpenDesign-owned constraints、auto layout、wrap、padding/gap、hug/fill/fixed、min/max、absolute child 与 grid 语义及可替换 solver。
- 建立富文本 runs、paragraph、OpenType/variable font、字体 asset、缺失字体替换和文本样式。
- 建立 Component/Instance/Variant/Override、共享样式、token/variable collection/mode/alias，以及人工和 Agent 共用的操作入口。

## P4：资源、导入导出与交付

- 完成图片 crop/focal/mask/replace/filter、资源浏览、引用恢复和字体资源生命周期。
- 建立 SVG、位图、PDF 和剪贴板设计内容的导入管线。
- 建立 PNG/JPEG/WebP/SVG/PDF、多倍图、选区/Frame/批量导出、透明背景、token 与开发检查路径；画布截图不能充当专业导出。
- 为万级节点、复杂文本、图片/效果、内存、帧率和长任务取消建立固定基准。

## P5：完整 Agent 权限与互操作

- 把当前设计工具纳入 Main-only Trust/Capability/Approval/Audit/Sandbox 执行链。
- 实现 attached roots、per-run resource handles、访问快照、撤销与跨 Project 多目标计划。
- 增加受控 `fetch_reference` 和隔离 `capture_reference`，明确 HTML 内容与网页视觉截图的不同语义。
- 让 MCP Client/Server 复用同一资源 locator、能力、revision、审批、审计、事务和撤销入口。

## 持续门禁

- 不恢复 OpenPencil、Canvas2D、手写选择框、隐藏 fallback 或双写状态。
- 不让模型、MCP、skills 或 Renderer 获得 Leafer 对象、原始凭据、任意路径或裸 shell。
- 新第三方依赖必须固定版本并更新 ADR、`engine-baseline.json`、第三方通知和兼容性测试。
- 文档只描述当前事实或明确目标；未验证能力不得宣传为完成。
