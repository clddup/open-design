# ADR-0204：Import/Export 跨边界结果单一契约

## 状态

已接受。

## 背景

SVG/Raster 工具输入已经使用 executable Contract，但 Renderer 返回给 Main 的 Raster 导出准备结果、SVG 导入结果和 SVG 导出准备结果仍分别通过手写 `isRecord/exactKeys`、字段遍历和 fidelity issue 判断校验。输入与结果采用不同契约架构，会让跨进程错误只能退化为“Renderer returned invalid export”，也要求新增字段同时修改多套守卫。

## 决策

1. `@opendesign/import-export-service` 唯一拥有 `SvgInterchangeIssueSchema`；`isSvgInterchangeIssue()` 只保留为该 Schema 的布尔薄投影。
2. Desktop Import/Export schema owner 唯一拥有 `PreparedAgentRasterExportSchema`、`AgentSvgImportResultSchema` 与 `PreparedAgentSvgExportSchema`。
3. Schema 负责完整对象结构、unknown fields、枚举、字符串/字节/尺寸/revision/数组预算及嵌套 fidelity issue；不再维护平行 `isRecord/exactKeys/safeId/boundedText` 遍历。
4. Domain refinement 只负责 Raster format/MIME 对应、portable suggested name 和 SVG root 必须包含在 imported node IDs 中。
5. 现有 `isPreparedAgentRasterExport()`、`isAgentSvgImportResult()` 与 `isPreparedAgentSvgExport()` 只调用各自 Contract。Renderer/Main 文件保存、revision correlation、显式目标和路径不外泄边界不变。
6. 本切片不为了减少公开工具数量把 SVG/Raster 强塞进更大的 union。是否合并 Provider 工具必须依据真实工具选择错误和披露阶段成本，而不是数字好看。

## 结果

- Renderer→Main 的导入导出结果获得稳定 `code/path/expected/actual/recovery`。
- SVG fidelity issue 在 service 生产端和 Desktop 消费端共享同一结构事实。
- 删除三套手写跨边界结果守卫，不新增兼容 alias、hash、文件数或 fixture 门禁。
- Provider 公开工具数量不变；本次收益来自减少契约漂移，不冒充生成速度优化。

## 验证

- 合法 Raster、SVG import 与 SVG export 结果通过各自 Contract。
- Raster MIME 漂移准确定位 `/mimeType`。
- SVG import 缺失 root identity 准确定位 `/rootNodeId`。
- 嵌套未知 fidelity issue code 准确定位 `/issues/0/code`。
- 现有 Renderer bridge、Main SVG/Raster export host 与 SVG import 事务行为继续通过回归。
