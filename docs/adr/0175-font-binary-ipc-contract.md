# ADR-0175：Font Binary IPC 单一契约

状态：已接受

## 背景

Main 显式导入并按内容寻址保存字体二进制，Renderer 只通过 Preload 获取无路径 descriptor 与 `Uint8Array`。原 `font-binary-contract.ts` 为 descriptor、payload 和 read request 分别维护 `isRecord`、exact keys、正则、范围及控制字符手写判断；payload 的字节长度关系又混在结构遍历中。该边界属于 Main/Preload IPC，继续保留平行判断会重复已经迁移到 `defineContract` 的 Renderer Design Tool 与 Model Bridge 问题。

## 决策

- `FontBinaryDescriptorSchema`、`FontBinaryPayloadSchema` 与 `FontBinaryReadRequestSchema` 是三个 wire shape 的唯一结构事实源，直接表达 exact object、内容寻址 `font_<sha256>`、名称、格式和大小范围。
- 对外保留的 `isFontBinaryDescriptor`、`isFontBinaryPayload` 与 `isFontBinaryReadRequest` 只是对应 Contract 的布尔适配，不再拥有结构规则。
- payload 的 `bytes.byteLength === byteSize` 是唯一跨字段 refinement，返回稳定 `font_binary_payload.byte_size_mismatch`、字段路径和期望/实际长度；`Uint8Array` 类型由 executable schema 验证。
- 不改变字体存储、路径隔离、显式用户导入、IPC sender 校验或 Renderer API，不增加旧格式兼容分支。

## 验证

Desktop API、Font Binary IPC 与 Host 测试覆盖合法 descriptor/payload/request、路径字段拒绝、非法 ID、字节长度漂移及结构化 issue path。Desktop TypeScript、ESLint 与 Prettier 对该边界通过。
