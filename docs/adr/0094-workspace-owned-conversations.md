# ADR-0094：Workspace 级 Conversation 与权威 Run 目标

- 状态：Accepted
- 日期：2026-08-19
- 契约：`WorkspaceContract 2`
- 取代：ADR-0006 中 `Conversation.homeProjectId` 与 Project 强归属决策
- 保留：ADR-0006 的资源层级、Working Set、Mutation Targets、Capabilities、四层安全模型与 revision 并发决策

## 背景

把 Conversation 绑定为 Project 的子实体，迫使用户先进入 Project 才能查找、打开或删除会话，也让 UI 容易把“会话放在哪个 Project 下”误解为运行权限或当前设计目标。真实 Agent 工作并不遵循这个关系：同一 Conversation 的后续 Run 可以指向不同 Project、Design File 或 Page；历史仍应在目标暂时不可用时可读。

OpenDesign 尚未正式发布，允许删除旧预发布 Workspace 数据并采用破坏性契约升级，不保留 `homeProjectId` 兼容层或双写路径。

## 决策

### Workspace 拥有 Conversation

Conversation 是 Workspace 一级持久实体，Workspace Home 提供全局最近会话入口，Project Home 只展示归档到该 Project 的过滤投影。Conversation 不以进入 Project 为打开前提。

`ConversationDescriptor` 使用两个可空组织字段：

- `originProjectId`：创建时来源，创建后不可变；没有 Project 上下文时为 `null`；
- `filedProjectId`：当前归档位置，可移动或清空；只影响组织、检索和 Project Home 投影。

两者都不授予文件、目录、Design File 或设计写入能力，也不能生成 Working Set、Mutation Target、Capability 或 Approval。

### Run target 是执行事实

每个 Run 的 `targetSet` 记录真实 `projectId / designFileId / documentId / pageId / baseRevision`。Global Task 保存同一目标投影用于恢复、导航与审计。设计写入和并发校验只信任 Main 已验证的 Run target，不从 `originProjectId`、`filedProjectId`、当前 Project、当前 tab 或当前选区推导。

打开 Conversation 时 Main 按以下顺序解析可用目标：

1. 该 Conversation 的活动 Run；
2. 最近 Global Task 的 primary target；
3. `filedProjectId` 中仍有效的默认 Design File/Page。

解析成功后 Renderer 直接恢复准确 Project、Design File、Page 和 Timeline。解析失败时进入 Timeline-only 视图：历史可读、目标不可用原因可见、Composer 禁用，不创建伪目标或把其他当前画布当作会话目标。

### 删除与审计

删除 Conversation 是产品列表 tombstone，不删除已提交设计、Design File history 或 Global Task 审计。Main 的活动 Run/continuation 查询是删除门禁的唯一活跃事实；Renderer 的任务列表只做提前反馈，不能取代 Main 校验。

活动工作必须先停止。终态 Conversation 删除后从普通列表移除，但关联的 terminal Global Task 保留，可继续解释历史设计变更。

### 迁移

`WorkspaceContract 2` 删除 `homeProjectId`。旧预发布 Conversation/Global Task 表在 schema 不匹配时确定性重建；应用偏好、safeStorage 凭据、字体、外部 Project 目录和设计文件不受影响。不得添加旧字段读取、双写或运行时兼容分支。

## 结果

- 用户可以像通用 Agent 产品一样从 Workspace 直接管理和打开会话；Project 仍可作为可选归档视图。
- 会话组织与真实设计目标分离，减少错误文件打开和隐式授权。
- 目标丢失不会让历史消失，也不会允许用户在未知目标上继续运行。
- 代价是打开会话需要一次 Main-owned 目标解析，Renderer 需要 Editor 与 Timeline-only 两种明确状态。
- 删除不再等价于清理所有关联记录，存储和隐私 UI 必须区分“从列表删除”与未来可能提供的审计清除能力。

## 验证

- Contract/store 测试覆盖 `originProjectId` 不可变、`filedProjectId` 可空/可移动、Workspace 全局排序和旧 schema 重建；
- Main/IPC 测试覆盖活动 Run/continuation 删除门禁、终态删除和 Global Task 审计保留；
- Renderer 测试覆盖 Workspace 直接打开准确 Project/File/Page、Timeline-only 与 Composer 禁用、会话切换和历史隔离；
- 同 Design File 继续通过 `baseRevision` 冲突，不因 Conversation 组织变化建立第二份可写状态。

## 复审条件

引入远程多人 Workspace、跨设备会话同步、审计保留策略或跨文件原子 Run 时，复审 Conversation 生命周期与数据清除语义；不得重新用 Project 归属替代目标、权限或并发事实。
