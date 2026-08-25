# ADR-0150：Project 上下文中的直接会话工作台

- 状态：Accepted
- 日期：2026-08-25
- 补充：ADR-0094 的 Workspace 级 Conversation、组织关系与 Run target 决策

## 背景

ADR-0094 已把 Conversation 提升为 Workspace 一级实体，解决了必须先进入 Project 才能查找、打开或删除会话的问题，但当前界面仍把 Project、Conversation 和 Global Task 分别做成入口与卡片。创建 Project 还要求用户在选择目录后重复输入名称；进入设计文件后，没有 Conversation 时又要求先创建会话。Agent Composer 把正文和操作控件放在同一横向布局中，窄 Utility Dock 内会为右侧按钮保留整列空白。

这些步骤与底层资源模型无关，却把“开始一次设计”拆成多个前置操作。用户首先判断的是能否迅速回到最近工作、打开画布并直接表达需求，而不是理解 Workspace 数据结构或任务投影。

## 决策

### Home 以继续工作为主

Workspace Home 只保留两个主要集合：按活动排序的最近 Conversation，以及 Project。Conversation 行显示其归档 Project 和最近任务生命周期；不再另外展示 Global Task 卡片流。Global Task 的持久记录、恢复、删除门禁和审计事实继续由 Main 保留，不因首页合并展示而删除。

Project Home 以可打开的 Design File 和归档到该 Project 的 Conversation 为平级列表，不展示装饰性文件预览、Working Set 说明卡或创建会话表单。Workspace 最近会话仍可跨 Project 直接打开，因此 Project 不是进入 Conversation 的强制层级。

### 创建 Project 不重复索取目录名

“创建 Project”直接打开原生目录选择器。Main 使用用户所选目录的 basename 生成 Project 名称；Renderer 只提交稳定 `projectId`，不接收或提交路径，也不再维护临时名称表单。打开已有 Project 继续使用独立入口。

### 第一次发送惰性创建 Conversation

Project-backed Design File 没有活动 Conversation 时，Agent Composer 仍可输入。第一次发送按以下顺序执行：

1. 用首条 prompt 的有界单行摘要生成会话标题；
2. 通过 Main 创建持久 Conversation；
3. 使用返回的稳定 Conversation descriptor 立即提交同一条 `run.start`；
4. 保留 optimistic 用户消息，不用空 history 回读覆盖首次提交。

显式“新建会话”仍作为开始另一条工作线的快捷操作，但不再是首次设计的前置门槛。Standalone 文件没有 Project/Run target 时继续禁用创建和提交，不伪造组织关系或权限。

### Composer 使用纵向编辑结构

正文 textarea 独占编辑器整行宽度；附件、当前 Page/Selection 上下文和 Send/Stop 位于下方工具栏。Provider/Model 与 reasoning 选择保持独立低权重行。该布局必须在 280–400 px Utility Dock 内保持正文可用，不为按钮预留正文侧列。

## 安全与架构边界

- 本决策不改变 Conversation 的 Workspace 所有权，也不把 `filedProjectId` 当作权限或写目标。
- 首次发送仍从当前 Project/Design File/Page 建立经 Main 校验的 Run target、revision 和能力链。
- Global Task 仍是恢复与审计事实，只改变 Renderer 的首页投影。
- Renderer 不接收所选目录路径；目录名称推导由 Main 在原生选择完成后执行。
- Conversation 创建成功但 Run 提交失败时保留真实会话并显示可重试错误，不回滚或伪装成功。

## 结果

- 用户可以“选择目录 → 打开设计文件 → 直接输入需求”，不再填写重复名称或先创建空会话。
- Workspace 保留跨 Project 最近会话能力，同时减少首页对象和重复状态。
- Composer 在窄面板中优先保证正文输入宽度。
- 代价是首次发送包含一次 Conversation 创建 IPC；Renderer 必须以创建响应作为当前提交的显式目标，正确处理创建失败、提交失败和会话切换竞态。

## 验证

- Renderer 行为测试覆盖首次 prompt 创建 Conversation 后立即发送同一请求，且不会先回读空历史。
- Project IPC 测试覆盖目录 basename 命名、取消选择和 Renderer 不能提交路径/名称。
- Agent Timeline 测试覆盖无 Conversation 时 Composer 可输入，以及 textarea 与底部工具栏的结构关系。
- Workspace 测试覆盖任务生命周期并入 Conversation、跨 Project 打开、删除门禁和 Project 创建错误收敛。
