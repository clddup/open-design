# ADR-0239：Import/Export 运行时边界单一契约

## 状态

已接受。

## 背景

ADR-0204 已收敛 Renderer→Main 的导入导出准备结果，但 Import/Export Service 与 SVG Worker 内仍有平行的对象遍历、exact-key、尺寸、枚举和 union 判断。相同结构分别存在于 TypeScript 类型、Worker 守卫、Service 守卫和 SVG metadata 读取器中，字段变化仍可能造成生产端与消费端漂移。

## 决策

1. `@opendesign/import-export-service` 唯一拥有 Raster export request、SVG fidelity issue、SVG import/export result、editable Vector metadata 和 Text metadata envelope 的 executable Schema/Contract。
2. Renderer Import/Export feature 唯一拥有 SVG Worker request/response Schema/Contract；Worker 与调用端直接消费同一 Contract，不再维护 `isRecord/exactKeys/isRect/isIssueArray` 等平行结构判断。
3. Schema 负责字段、unknown fields、discriminated union、范围、集合预算和正尺寸。format/background、imported root、节点 ID 唯一、拓扑和 metadata 迁移规则留在各自 domain owner。
4. 历史 Text/Vector metadata 先通过有界 envelope Contract，再执行版本迁移，最后通过当前 canonical properties/network Contract；迁移不得静默补救损坏结构。
5. 本切片不合并 Provider 工具、不增加 hash/文件数量/版本匹配门禁，也不改变 Conversation、Run、文件授权或原生保存框边界。

## 结果

- Worker、Service 和 metadata 读取器使用同一结构事实，错误可定位到稳定字段路径。
- 删除重复手写结构遍历；现存布尔入口仅是 Contract 的薄投影。
- 该切片减少契约漂移和无效重试，但不冒充模型首响应或设计生成速度优化。

## 验证

- Raster PNG quality、JPEG background 和 unknown field 返回 `/quality`、`/background/mode`、`/filePath`。
- SVG Worker import/export request、completed/failed response、重复 root、padding 与非正 bounds 均由同一 Contract 验证。
- SVG Text/Vector metadata 的 envelope、canonical properties/network、拓扑和标准 SVG 往返继续通过定向测试。
