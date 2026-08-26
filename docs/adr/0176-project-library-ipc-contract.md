# ADR-0176：Project Library IPC 单一契约

状态：已接受

## 背景

Project Library 的 Catalog、Publish、List、Read、Enable、Accept 与 Ignore 跨 Main/Preload/Renderer 使用同一组 wire 数据，但原 shared contract 同时以 TypeScript interface、`isRecord`、`onlyKeys`、字段类型判断、数组范围和引用关系遍历维护结构事实。结构与 catalog 领域关系混在同一批布尔 guard 中，无法为 IPC 诊断提供稳定字段路径，也会在新增字段时要求修改多处平行判断。

## 决策

- `project-library-contract-schemas.ts` 唯一拥有所有 Project Library wire shape：exact object、稳定资源 ID、内容寻址 Library/Release ID、时间戳、数组范围和 request/result discriminants。
- `project-library-contract-domain.ts` 只拥有跨字段与跨实体关系：Catalog/Release 唯一性、latest release 存在性、enabled/accepted/ignored 引用完整性、接受与忽略互斥，以及 publish result 的 Library/Release identity 一致性。
- `project-library-contract.ts` 是稳定 facade，只组合 `defineContract` 并保留现有 `isXxx` 布尔 API 作为 Contract 适配；Main、Preload 和 Renderer 不再维护第二份结构规则。
- Publish result 继续复用 `LibraryReleaseSnapshotSchema` 与 canonical snapshot refinement，不复制 DesignDocument Library release 语义。迁移不改变 IPC channel、sender 校验、Project scope、存储格式、发布行为或现有引用。

## 验证

Project Library contract、Project Host 与 Project IPC 定向测试覆盖完整 Catalog、全部 request family、publish result、未知字段、悬空 Library/Release、冲突 decision、空白名称和稳定 issue path。Desktop TypeScript、ESLint、Prettier 与 production build 覆盖新的三层 owner。
