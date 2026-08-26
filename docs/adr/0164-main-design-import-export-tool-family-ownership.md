# ADR-0164：Main 设计 Import/Export 工具族所有权

## 状态

已接受。

## 背景

SVG 导入、SVG 导出和 Raster 导出的文件、路径与字节边界已经分别由 `AgentSvgImportHost`、`AgentSvgExportHost` 和 `AgentRasterExportHost` 持有。但 Main 入口仍直接解析三个公开 Contract、检查 Run inspection、执行 visual-review 写门禁、解析 delivery target、调用 host，并在 SVG 导入 revision 后推进 delivery。

这使 import/export 的策略生命周期分裂在入口与三个底层 host 之间。底层 host 已能独立验证 Renderer 准备结果、revision 和原生文件保存，入口编排却只能随整个桌面启动路径间接验证，也容易在新增格式时继续堆分支。

## 决策

1. `DesignImportExportToolHandler` 是 Agent SVG/Raster import/export policy family 的唯一 Main dispatcher owner，负责：
   - 使用公开权威 Contract 返回准确字段路径；
   - 要求当前 Run 已完成权威 document inspection；
   - SVG 导入前执行 visual-review 写门禁并解析 material delivery target；
   - 委托既有 Main host 完成 Run reference 物化、Renderer 事务、原生保存和路径/字节隔离；
   - 仅在 SVG 导入返回真实 revision 后记录 material write，并附加当前 delivery。
2. 三个既有 host 继续分别持有格式专用可信边界：
   - `AgentSvgImportHost` 持有 attachment 物化、内部安全 ID prefix、Renderer import 结果和 revision 验证；
   - `AgentSvgExportHost` 持有 SVG 准备结果验证和原生保存；
   - `AgentRasterExportHost` 持有 Raster bytes/尺寸/格式验证和原生保存。
3. Main 入口只提供 coordinator、execution context、取消信号、按需 host getter 与 delivery decorator，不再实现三个工具分支或 imported-node 解析。
4. 非 import/export 工具返回 `null` 且不初始化任何格式 host。Malformed 输入在 inspection、Renderer 或原生文件对话框之前失败。
5. 不改变公开工具名称、schema、审批、Run reference、原生对话框、输出 metadata、事务、revision、delivery 或错误语义；不增加兼容 facade 或第二条 import/export 路径。

## 结果

- Import/export 的策略编排与格式 host 各有单一、可定向测试的 owner。
- SVG 源码、Raster bytes、内部 ID prefix 和本地路径仍不会进入 Agent utility process。
- Main 入口不再随格式能力扩展而继续增加业务分支。
- Page/Component policy family 仍需迁出，因此 Phase 6 保持开放。

## 验证

- 非 import/export 工具不解析 Contract、不检查 inspection，也不取得 host。
- malformed SVG export 在原生保存前返回 `/suggestedName` 等准确路径。
- SVG/Raster export 均要求 inspection，并只调用对应 Main host。
- SVG import 依次执行 inspection、visual-review 写门禁、target 解析、host transaction、真实 revision 记录与 delivery 附加。
- Desktop 定向 Vitest、typecheck、ESLint、Prettier 与生产 build 通过。
