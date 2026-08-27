# ADR-0201：Design File Component Catalog 单一契约

## 状态

已接受。

## 背景

OpenDesign 会在 exact-revision inspection 中向 Agent 提供当前 Design File 的可复用 Component 摘要，使 Plan 可以明确选择创建 Component、复用既有 Component 或保留普通图层。该 Catalog 此前由 Renderer 生成，却在 Desktop shared 层通过一套手写 record、exactKeys、safeId 和 union 判断校验；Main 只把任何失败压缩成泛化的 inspection error。结构规则、预算关系和恢复路径无法复用统一 Contract，也无法告诉 Agent 是哪个 Component 或 property 字段损坏。

## 决策

1. shared Design System 模块唯一拥有 DesignSystemComponentCatalogSchema/Contract，并从 Schema 导出 Catalog、Entry 与 Property 类型。
2. Schema 负责对象形状、可选字段、availability/property type 分支、字符串安全边界、数组/Record 数量和非负计数；不再并行维护手写 shape guard。
3. 唯一 domain refinement 负责：
   - totalCount、components 与 truncated 的关系；
   - Catalog 序列化字符预算；
   - componentId 和 property name 唯一性；
   - scopeUsageCount 不超过 Design File usageCount；
   - descriptionTruncated 必须绑定实际 description。
4. Renderer 继续从权威 DesignDocument revision 生成有界 Catalog，不读取其他文件的 Main subtree。Main inspection 解析同一 Contract，并把首个失败字段前缀为 /componentCatalog 后写入结构化 workflow issue。
5. isDesignSystemComponentCatalog() 仅保留为 Contract 的布尔薄投影。现有 Component Service、Plan reuse-component 语义、Page/revision/capability 和文档事务边界不变。

## 结果

- Renderer 生成、Main 消费和组件复用策略共享同一结构事实。
- 非法 property type、重复名称、scope count 和截断关系返回准确路径，不再只显示“catalog invalid”。
- Catalog 仍是有界 inspection 投影，不进入 DesignDocument，不复制跨文件 Component Library，也不授予写权限。
- 本切片删除旧手写结构遍历，不增加仓库文件数、hash 或固定文案门禁。

## 验证

- Renderer 生成 current-scope/design-file 与截断 Catalog 后通过同一 Contract。
- Main 对 Catalog domain failure 保留 /componentCatalog/components/... 字段路径。
- 非法 property discriminant、重复 Component/property ID、usage 与 truncation 关系返回稳定 code/path。
- existing Component reuse Plan 的 stale catalog、创建与实例策略回归。
