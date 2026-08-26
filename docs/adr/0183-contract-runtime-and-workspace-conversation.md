# ADR-0183：共享契约运行时与 Workspace Conversation 描述符

状态：已接受

## 背景

设计工具已经通过 Desktop-local `contract-validation.ts` 使用 executable schema、host binding 与 domain refinement；Agent Event 又在 `@opendesign/agent-contracts` 内实现了一份相似 runtime。Workspace 的 Project/Conversation 描述符只有 TypeBox schema 与布尔 `isXxx`，Desktop Create/Delete/OpenContext 继续手写 exact-key、标题和 union 判断。结果是同一验证阶段存在多份实现，Preload 只能判断形状而不能关联响应，请求合法时仍会重复遍历；Workspace Store 读取损坏 Conversation 时还会静默过滤，使用户看到会话消失。

## 决策

- 新建基础包 `@opendesign/contract-runtime`。它只依赖 TypeBox，统一拥有 discriminated-union 字段定位、`ValidationIssue { code, path, expected, actual, recovery }`、structure → model refinement → trusted binding → canonical structure → domain refinement 的执行顺序和稳定格式化；它不是仓库扫描、数量/hash 门禁，也不包含任何产品策略。
- `@opendesign/design-contracts` 将通用 schema issue adapter 交给该包并保留根导出；Desktop `contract-validation.ts` 变成薄重导出；Agent Event 也消费同一 runtime，删除包内重复实现且保持 Supervisor 单次解析。
- `@opendesign/workspace-contracts/descriptors` 独立拥有 Stable ID、时间、相对路径、Project/Design File/Conversation descriptor、Conversation create/identity request、descriptor list 的 schema 与 Contract。相对路径 schema 直接拒绝控制字符、盘符、反斜杠、空段和遍历；Design File extension、Project 内 ID/document/path 唯一、Conversation 时间顺序与列表 ID 唯一只存在于 domain refinement。
- Conversation Descriptor Contract 接受窄验证上下文，用于关联 Create/Delete 响应的 ID、Project、title 与 lifecycle。Project 是否已注册、活动 Run 删除门禁、真实 Project/File/Page 可用性、symlink 与 root containment 继续由 Main runtime guard 拥有。
- Desktop OpenContext 保持独立 executable union Contract，并关联请求 Conversation ID。Preload 的 Conversation API 拆成独立模块：outbound request、inbound result 和整个列表均通过权威 Contract；数组错误保留索引路径，不再逐项布尔过滤。
- Workspace Store 写入和读取使用同一 Descriptor Contract；读取同时核对 SQLite 的 Conversation ID、origin/filed Project 与 updatedAt 冗余列。非法 JSON 或列不一致明确失败，不再静默消失；`saveConversation` 只更新已存在实体，创建仍只走 Main create owner；`originProjectId` 保持不可变。
- Workspace Run Target/Access Snapshot 与 Global Task/Delivery Ledger 是不同 owner，继续按独立切片迁移。本决策不混入权限、续跑、完成门禁或旧 Delivery 持久化裁决。

## 验证

Contract Runtime、Design/Agent/Workspace Contracts、Desktop Contract facade、Conversation API、Project IPC/Host/Store 定向测试覆盖 discriminant 字段路径、Project descriptor 唯一性、控制字符与路径、Conversation 时间/列表/响应关联、Preload 双向拒绝、Main target resolution、Store update-only 与冗余列损坏可见失败。对应包与 Desktop TypeScript、ESLint、Prettier、production build 覆盖基础包导出及 Main/Preload/Renderer bundle。
