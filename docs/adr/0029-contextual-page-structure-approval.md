# ADR-0029：按需 Page 结构授权

- 状态：已接受
- 日期：2026-08-11
- 文档协议：不变（`DesignDocument 1.8.0`）
- Agent 协议：不变（`AgentRequest / AgentEvent 3.6`）
- 关联：ADR-0006、ADR-0018、ADR-0020、ADR-0028
- 产品参考：Figma Pages、First Draft 与 Design AI tools

## 背景

旧 Composer 常驻“当前页面 / 设计文件”写入范围下拉，把内部 Mutation Target 直接暴露给每次输入。多数请求只修改当前 Page，用户却必须理解 Design File 权限；需要创建一套多 Page 设计时，又必须在发送前预判 Agent 是否会跨 Page。这个交互既增加负担，也容易把“可读上下文”“计划写目标”和“已经获准的能力”混为一个选项。

底层仍必须区分 Working Set、Mutation Target、Capability 和 Approval。直接删除下拉并让模型自行扩大到整个 Design File，会把 UI 简化变成隐式授权；把当前选区当成写入范围也会重现已经修复的选择漂移问题。

Figma 把 Pages 作为 Design File 内的独立 canvas 和组织层级，并在左侧 Pages 区域创建、复制、重命名、排序和删除；AI 设计能力则从当前设计工作流进入，生成可编辑结果后继续通过 prompt 或属性修改，而不是在每条 prompt 旁常驻文件级写权限开关。OpenDesign 参考这种渐进披露关系，不复制 Figma 的文档、AI runtime 或权限实现。

参考：

- [Create and manage pages](https://help.figma.com/hc/en-us/articles/360038511293-Create-and-manage-pages)
- [Use First Draft with Figma AI](https://help.figma.com/hc/en-us/articles/23955143044247-Use-First-Draft-with-Figma-AI)
- [Use AI tools in Figma Design](https://help.figma.com/hc/en-us/articles/23870272542231-Use-AI-tools-in-Figma-Design)

## 决策

### Run 默认只绑定当前 Page

Renderer 创建每个 Run 时始终提交发送时活动 Page 的 `mutationTarget`。Composer 不再显示“当前页面 / 设计文件”下拉，只显示低权重的当前 Page 或选区上下文。选区仍只是模型上下文，不授予也不缩小写权限。

原始 Run binding 在整个 Run 内保持不变。用户切换 Page、Design File、选区、pan、zoom 或窗口尺寸不会改变该 binding，也不会影响 Agent 对后台目标文件的权威数据更新。

### Page 结构和跨 Page 工作按需申请

新增生产工具 `opendesign_request_page_structure_access`。只有以下工作需要调用：

- 创建、复制、排序或删除 Page；
- 重命名 Run 绑定 Page 之外的 Page；
- 计划或修改当前 Design File 中另一个 Page 的内容。

重命名 Run 绑定 Page 仍属于原 Page 目标，不需要额外审批。普通当前 Page 设计不得调用该工具。

工具输入只接受有界的动作枚举和理由，不接受路径、Project、Design File ID、Page ID 或模型自选 scope。目标 Design File 始终来自 Main 已注册的可信 Run binding。

### Approval 由 Main 精确绑定

该工具标记为 `design_write + approval: required`。Pi adapter 先产生 `tool.requested`，再产生带专用说明的 `approval.requested`；utilityProcess 中的 `UserApprovalController` 只保存可取消的待决 Promise，不授予能力。

Main 从已观察到的 `tool.requested` 关联真实工具名、风险和输入；发放 Page 结构能力前重新验证 `design_write` 风险与完整业务参数，并只接受同时匹配以下字段的 Renderer 决定：

```text
runId + toolCallId + approvalId
```

用户只有“允许本次”和“不允许”。Page 结构授权拒绝 `allow_session`，不得持久化为 Conversation、Project 或应用级权限。发送决定失败时，Main 回滚待决状态和已经准备的临时授权。

### 授权形成显式、可回收的执行投影

批准后，Global Task Coordinator 为该 Run 记录一个只指向当前 Design File 的临时 Page 结构访问记录。原始 Page binding 不被改写；Main 仅在执行受信任设计工具时，从“原始 binding + 当前 Run 的已批准记录”解析 effective document execution context，并把这个窄上下文发给 Renderer 或 SVG host。

因此：

- Working Set 仍来自检查结果；
- 原始 Mutation Target 仍可审计为发送时 Page；
- effective Design File 写目标只来自本次显式申请与批准，不从可读上下文、选区或 Project 归属推导；
- Capability 只覆盖同一个 Run 和 Design File，不扩展到其他文件、Project、目录、MCP 或 shell；
- Renderer、Agent Runtime 和模型都不能自行签发或扩大该记录。

授权时必须删除该 Run 旧的 document inspection。模型随后重新调用 `opendesign_inspect_document`，Main 才接受跨 Page plan、Page lifecycle 或其他 Page 的 typed design transaction。这样旧的 Page-only 检查不能在扩大范围后冒充全文件事实。

### 生命周期与失败恢复

Run 完成、取消、错误、进程退出或发送批准失败时回收临时访问。能力不从 journal 恢复；持久时间线只保留审批事件用于解释和审计。新 Run 重新从当前 Page 开始。

拒绝审批是可恢复工具结果，不是应用崩溃或文档错误。模型可以说明被阻塞的跨 Page 部分，但不得重复申请、拆分调用绕过拒绝或声称已经修改。Page 工具在没有授权时返回稳定的 `design_workflow.page_structure_access_required` 恢复指令；授权后未重新检查则返回 `inspection_required`。

### UI

审批以内联 Agent activity 呈现，不使用遮挡画布的模态层，也不在 Composer 保留权限控件。它显示当前 Design File 名称、授权效果、Run 结束自动失效，以及“允许本次 / 不允许”两个键盘可达按钮。长文件名截断，窄 Utility Dock 中按钮可换行；pending、disabled 和 resolved 状态同时依靠文案与结构表达，不只依赖颜色。

旧 Run 的 pending approval 只作为历史 activity，不可操作。决定发送期间两个按钮都禁用；发送失败恢复可操作状态并产生关联诊断。

## 当前实现

- `run.start` 始终携带当前 Page Mutation Target，Composer 只显示上下文。
- 十六个生产 typed tools 中新增 Page 结构申请工具；`opendesign_manage_pages` 和 system prompt 明确要求申请、等待、重新 inspect、再执行。
- AgentHost、utilityProcess approval controller、Main coordinator 与 Renderer inline approval 已打通精确决定和回收链。
- 当前授权粒度是“本 Run、当前 Design File 的 Page 结构与跨 Page 设计”。按动作、按 Page 的更细能力，以及跨 Design File/Project 多 Mutation Targets 仍属于 ADR-0006 后续工作，不在本 ADR 中冒充完成。

## 验证

- 工具 contract 覆盖动作枚举、重复/未知动作、理由预算、required approval 和自定义审批文案。
- Pi adapter 覆盖自定义审批文案、拒绝工具结果和后续模型回合。
- utilityProcess 与 Main 覆盖精确 `runId/toolCallId/approvalId`、未知或重复决定、取消、发送回滚和进程清理。
- Coordinator 覆盖默认 Page 拒绝、绑定 Page rename、批准后 document execution context、旧 inspection 失效、重新检查后的跨 Page plan、Run 终态回收。
- Renderer 覆盖无常驻 scope 下拉、默认 Page `run.start`、允许/拒绝决定、发送中禁用、resolved 收口、旧 Run 不可操作、长资源名称和窄面板不溢出。
- 完整 `pnpm verify` 继续作为合并门禁；本变更不以启动 Electron 或操作用户当前窗口代替自动化证据。

## 结果

### 正面结果

- 普通设计请求不再要求用户理解内部 Design File scope。
- 一套多 Page 设计仍能在同一 Run 内完成，并在真正需要扩大影响时只询问一次。
- 作用域扩展可解释、可审计、可取消、到期明确，不依赖模型自律或用户预先猜测。
- Page 生命周期、跨 Page plan 和后台文件更新继续复用唯一 EditorRuntime、revision、history 与 autosave。

### 代价与风险

- Main 需要同时维护原始 binding 和短生命周期 effective execution context，所有新增工具必须明确使用哪一层。
- 批准后强制重新 inspect 增加一次工具调用，但避免用过期 Page-only 数据修改全文件。
- 当前批准覆盖同一 Design File 内全部 Page 结构/跨 Page 操作；更细动作粒度需要新的 capability selector 与 UI，不应通过模型理由字符串假装实现。

## 复审条件

如果引入同 Run 多 Design File/Project、多人协作、远程权限、可持久 Capability、按动作组织策略或外部 MCP 写入，应复审 effective target、审批摘要、撤销和审计模型。不得把本 ADR 的单文件临时授权直接扩展成目录、Project 或 Workspace 权限。
