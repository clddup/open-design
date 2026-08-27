# ADR-0202：Design Capability Manifest 单一契约

## 状态

已接受。

## 背景

Design Capability Manifest 是 OpenDesign 向产品 UI、Agent 和验证文档声明专业能力状态的可信事实。它决定某项能力是否可用、降级或不可用，并阻止模型把只有 schema 占位或局部实现的能力宣传为完成。此前 Manifest 使用一套抛异常式手写 parser，重复实现对象形状、exact keys、枚举、字符串、数组和本地化字段校验，失败只有泛化 TypeError，无法复用统一的结构化字段路径。

## 决策

1. design-capabilities 包唯一拥有 DesignCapabilityManifestSchema/Contract，并从同一 Schema 导出 Manifest、Category、Capability、Evidence、Status 与 Surface 类型。
2. Schema 负责字段形状、未知字段、本地化文本、ID/date 格式、status/surface 枚举、required surface 非空唯一和 evidence/reference 数组。
3. 唯一 domain refinement 只负责：
   - Category ID 与 Capability ID 唯一；
   - Capability category 必须引用已声明 Category；
   - Capability status 必须从 required surfaces 与 automated/manual evidence 确定性派生。
4. 内置 manifest.json 在模块加载时只通过该 Contract 一次解析，失败使用结构化 code/path 形成明确启动错误；成功值再深度冻结。isDesignCapabilityManifest() 只保留为 Contract 的布尔薄投影。
5. Agent 的 capability summary 和 opendesign_get_capabilities 继续从同一冻结 Manifest 投影，不改变任何现有能力状态，也不新增仓库门禁。

## 结果

- 产品、Agent 与验证使用同一份专业能力状态事实。
- 未知字段、错误分类引用和虚假 available 状态返回准确字段路径。
- Manifest 的结构校验与状态派生职责分离，不再维护 record/array/exactKeys/parseStatus 等平行 parser。
- 这项 Contract 只描述真实能力，不使 unavailable/degraded 能力自动变为可用。

## 验证

- 当前内置 Manifest 通过 Contract 并保持深度冻结。
- 无 evidence 的专业流程不能被标记 available。
- 未知字段、未知 Category 与状态派生不一致返回稳定 code/path。
- Agent capability tool 返回与冻结 Manifest 同源的有界投影。
