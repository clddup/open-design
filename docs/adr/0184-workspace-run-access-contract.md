# ADR-0184：Workspace Run Target 与 Access Snapshot 单一契约

状态：已接受

## 背景

`@opendesign/workspace-contracts` 的 Run target、resource locator、root grant、resource reference 与 access snapshot 已有严格 TypeBox schema，但 domain 关系仍由 `isDesignTarget / isRunTargetSet / isRootGrant / isRunAccessSnapshot` 手写布尔遍历。结构错误没有稳定字段路径；`primaryTarget` 的相等判断逐字段枚举，新增字段时容易漏检；grant、reference、Run、Conversation 与 permission 的交叉关系也只能返回统一 false。该组规则与 Project/Conversation Descriptor、Global Task/Delivery 分属不同 owner，不应继续堆在根 `index.ts`。

## 决策

- 新增 `@opendesign/workspace-contracts/access`，唯一拥有 Design entity ID、resource locator、root grant、resource reference、Design Target、Run Target Set 与 Run Access Snapshot 的 executable schemas、Static 类型与 Contracts；根入口只作稳定重导出。
- 结构、枚举、长度、unique array 与 discriminated locator branch 只由 schema 定义。Domain refinement 只处理：grant lifecycle、primary selection membership、target/Design File 唯一、primary target membership/equality、grant/reference ID 唯一、reference Run、Conversation-scoped grant、root locator grant existence 与 permission subset。
- `primaryTarget` 暂时保持现有完整对象 wire shape，避免在契约迁移中混改协议；其一致性使用 TypeBox deep equality，不再逐字段枚举。未来若改为 target ID 引用，必须作为独立协议决策。
- 每个失败返回稳定 `ValidationIssue { code, path, message, recovery }`。原 `isXxx` 名称只保留为消费对应 Contract 的布尔 facade，不再维护第二套规则；合法大 snapshot 的 guard 不做深拷贝。
- 本切片只收敛当前数据契约，不宣称 attached roots、per-run handles、完整 Capability/Approval/Sandbox 执行链已经实现，也不改变 Main 对真实路径、资源句柄与授权状态的所有权。
- Global Task 与 Design Delivery Ledger 继续作为下一独立 owner 迁移；旧 Delivery normalizer、续跑和完成门禁不混入本切片。

## 验证

Workspace Contract 定向测试覆盖 locator discriminant/relative path、grant lifecycle、selection membership、target/Design File uniqueness、primary target canonical equality、reference Run、grant identity、Conversation scope与 permission subset，并验证准确 code/path。Design/Editor/Desktop TypeScript 与使用这些 facade 的 Conversation、Project、Agent design-tool 测试覆盖根导出兼容和现有运行链。
