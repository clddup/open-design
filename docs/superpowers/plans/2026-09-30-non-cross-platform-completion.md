# 非跨平台缺口逐项收敛实施计划

> **For agentic workers:** 本计划按可重放的独立验收切片执行；每个切片先验证再修复，跨平台安装与双平台原生验收暂不纳入。

**Goal:** 在不处理 macOS/Windows 发布门禁的前提下，逐项完成当前路线图中剩余的本机 Electron、固定样张、视觉/Agent 质量、性能和交付能力，并为每项保留真实证据。

**Architecture:** 所有设计写入继续通过 Main → typed tool → Renderer → 唯一 `EditorRuntime.apply()`；Leafer 只作为 exact-revision 可丢弃投影。先从本机 Electron 和固定 fixture 复验建立最小闭环，再按依赖顺序修复运行时缺陷，最后补能力、性能和文档证据。跨平台差异只保留窄 adapter，不在本计划中进行另一平台的安装或 GUI 验收。

**Tech Stack:** Electron 43、React 19、Leafer 2.2.9、TypeScript 5.9、Vitest 4、pnpm 10、Playwright/CUA、OpenDesign DesignDocument 1.57.0。

**Spec:** `docs/roadmap.md`、`docs/verification.md`、`docs/design-capability-baseline.md`、固定样张 `fixtures/professional/`。

## Global Constraints

- 不恢复 OpenPencil、Canvas2D、双写状态、裸 shell、任意路径或 Renderer Node.js 能力。
- 不把自动化测试、结构投影或作者自述当作真实像素/视觉证据。
- 每项改动必须有单一契约入口、结构化失败、可取消行为和保存/撤销边界。
- 暂缓 macOS/Windows 安装、升级、卸载与双平台 GUI smoke；不修改其发布门禁为“已完成”。
- 不提交截图、用户设计、凭据、模型会话或生成物；证据只记录在验证文档或测试 fixture 中。

## 执行顺序

### Task 1：本机 Electron 闭环基线

使用当前工作区启动开发 Electron，复验固定样张加载/画布渲染/选择/缩放/窗口尺寸/保存重开/撤销重做/导出/Agent 取消；记录第一个真实失败点。若失败可通过现有测试定位，先写回归测试再做最小修复。

验收：`pnpm verify`、相关定向测试、Electron 交互复现记录；不把无窗口 Agent smoke 当作 GUI 通过。

### Task 2：固定样张真实重放与证据

为 `OD-PENGUIN-01`、`OD-POSTER-01`、`OD-BRAND-01` 建立当前 Electron 可重放入口，保存 prompt、revision、capture、refinement、diagnostic 和最终 `.opendesign` 引用；完善缺少的 capture/export 产物边界。

验收：每个样张从干净 fixture 开始，真实画布至少完成写入→capture→修正→capture 或明确记录阻塞原因。

### Task 3：本机交互问题修复

处理 Task 1/2 发现的 editBox、pan/zoom/resize、Inspector 同步、文本输入、附件、图片放置、SVG/raster 导出等问题；每个问题一条回归测试和一笔原子提交。

### Task 4：质量门禁与 Agent 体验

完成未处理的 Plan/普通编辑边界、parser 结构化归因、Provider metadata/token 预算、视觉质量策略与盲评所需的可重放证据；保持模型可自主结束 Run。

### Task 5：性能与大型文档基线

建立万级节点、连续 revision、图片/效果、selection/editBox、pan/zoom 的 Electron 帧时间、内存、资源释放基准，设置可解释的回归阈值，不以隐藏警告代替优化。

### Task 6：非跨平台交付能力

补齐本机 SVG/PDF/批量/透明背景/切片/资源工作台等路线图缺口，逐项贯通 schema→Runtime→UI→Agent→导出→保存重开→undo/redo。

### Task 7：证据与文档收敛

仅根据已复验事实更新 `docs/verification.md`、能力 manifest 和路线图；仍未验证的项目明确保留为开放，不提前宣称完成。
