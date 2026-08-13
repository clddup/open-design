# ADR-0054：隔离 Agent 审查截图与 Leafer 全局异步导出队列

- 状态：Accepted
- 日期：2026-08-13
- 文档协议：不变（`DesignDocument 1.13.0`）
- 画布基线：`leafer-editor 2.2.9`
- 关联：ADR-0018、ADR-0031、ADR-0034、ADR-0052

## 背景

真实 6-target 生成样本出现 64 次 Renderer 工具失败，capture 阶段累计约 4,593 秒；多次请求在进入 `capturing` 后固定等待 Main 的 90 秒 idle watchdog。Run 级熔断可以阻止无限重试，但不能恢复截图能力。

固定版本 Leafer 的 `@leafer-in/export 2.2.9` 实现表明，异步 `UI.export()` 把所有导出加入包级全局、非并行 `TaskProcessor`。队首任务会等待 `waitViewCompleted`，随后等待 `canvasToBlob`。OpenDesign 的外层 30 秒 Promise race 只能停止等待并销毁当前 Adapter，不能取消已经进入该全局队列的 Leafer 任务。一次底层 Promise 永久不返回后，后续新建离屏 App 的 capture 仍排在同一个已毒化队列后面，因此重建 surface 不能恢复。

## 决策

Agent 的有界 JPEG 视觉审查截图不再调用异步 `UI.export()`：

1. 只等待当前离屏 Leafer App 的 `waitViewCompleted`；
2. 使用同一固定 Leafer export plugin 的 `UI.syncExport("jpg")` 生成 data URL；
3. 在 Renderer 内严格验证 `data:image/jpeg;base64`、尺寸和字节；
4. 继续由既有 30 秒 capture deadline 约束可等待的 geometry/readiness 阶段；超时或取消销毁当前 Adapter 和 DOM surface；同步 data URL 编码以 `1280×960` 审查尺寸硬上限约束工作量，不能伪称 timer 可抢占同步 JavaScript；
5. 后续 capture 使用独立 App readiness，不进入任何包级共享 export task queue。

固定 Web 平台的 `canvasToDataURL` 是同步调用，且 `syncExport` 仍复用 Leafer 的 bounds、scale、render、paint/effect 和 canvas 管线；本决策不建立第二套 Canvas renderer，也不从文档绕过 Leafer 投影。

专业 PNG/JPEG/WebP 交付导出仍使用异步 Blob 路径。它是用户显式、低频、需要格式与质量选项的独立工作流，不在本切片中改为 data URL。若实机证据显示该路径同样会毒化全局队列，应作为独立导出 worker/隔离切片处理，不能用 Agent capture 的窄修复扩大宣称。

## 失败与恢复语义

- geometry/readiness 不完成：30 秒后返回既有 `renderer_capture_timeout`，释放临时 App；
- 同步导出返回 Promise、非 JPEG data URL、非法 base64、非法尺寸或 provider error：立即失败，不导入附件；
- 一次 readiness 永久挂起不能阻塞另一独立 App 的健康 capture；
- Main 的两次连续 canvas stall 熔断继续保留，作为最后防线而不是根因修复替代品；
- 已提交设计 revision、ledger、history 与 autosave 语义不变。

## 验证

- 专项测试证明 capture 使用 `syncExport` 而不调用异步 `export`；
- 第一张独立 surface 的 readiness 永久挂起时，第二张 surface 可以立即完成；
- invalid data URL、缺失 target、非法 bounds、timeout、dispose 和 DOM surface 清理继续失败封闭；
- Page/Frame capture、组件派生投影和专业 fixture 继续经过同一 Leafer Adapter；
- 完整 `pnpm verify` 覆盖类型、架构边界、全量测试与生产构建。
