# ADR-0119：有界 Design File 组件目录与计划复用

- 状态：Accepted
- 日期：2026-08-21
- DesignDocument：不变
- Design Plan：契约不变，扩展当前唯一 `componentStrategy` 候选
- 关联：ADR-0006、ADR-0050、ADR-0062、ADR-0072、ADR-0098、ADR-0118

## 背景

OpenDesign 已有 Component Main、linked Instance、Component Set/Variant、Component Properties、Shared Styles、Variables 和人工 Assets 面板，但 Agent 的 Page-scoped inspection 只完整返回当前范围内出现的 Component 定义。组件 Main 位于其他 Page 时，模型最多看到一个无语义的全文件 ID，无法判断名称、用途、变体和属性，经常重新手搓按钮、导航、字段或卡片 primitive，造成大型产品页面风格漂移、组件缺失和重复结构。

Figma 把 Components、Styles 与 Variables 作为设计系统资产；本地或启用 Library 的 Component 从 Assets 面板插入 linked Instance，Styles/Variables 通过属性 picker 应用。组件名称、说明、变体和属性帮助设计者选择正确资产，而 Library 的发布、权限、更新通知与接受更新是另一层生命周期。[Guide to libraries](https://help.figma.com/hc/en-us/articles/360041051154-Guide-to-libraries-in-Figma)、[Assets tab](https://help.figma.com/hc/en-us/articles/360039831974-Explore-the-navigation-bar-and-left-sidebar)、[Component descriptions](https://help.figma.com/hc/en-us/articles/7938814091287-Add-descriptions-to-styles-components-and-variables)。

OpenDesign 当前没有跨文件 Library 发布/消费与更新协议。本切片只让 Agent 可靠发现和复用当前 Design File 已有 Component，不把一个目录摘要包装成完整 Library。

## 决策

### Inspection 投影有界组件目录

Renderer 从当前权威 `DesignDocument` revision 生成 `document.componentCatalog`：

- 最多返回 64 个 Component 且目录 JSON 不超过 12,000 字符，报告真实 `totalCount/truncated`；
- 当前 inspection scope 已出现的 Main、Instance 或嵌套依赖优先，其次按 scoped usage、全文件 usage、名称和稳定 ID 排序；
- 每项只包含 `componentId`、名称、最多 240 字符的可选说明、`current-scope/design-file` availability、全文件/当前范围用量、可选 Variant Set ID、最多 12 项 variant properties 和 Component Property 名称/类型；
- 不返回其他 Page 的完整 Main subtree、source paths、布局、文字、paint 或可写 target；当前 scope 的完整定义仍沿用既有 `componentsById`；
- Styles 与 Variables 不复制进目录，继续使用 inspection 已有 `stylesById/variablesById` 正式定义和作用域解析。

目录经过 Main exact-key、上限、唯一 ID、计数和字段类型校验。它是一次 inspection 的只读、可丢弃投影，不进入 DesignDocument、history、save 或 Conversation 持久事实。

### componentStrategy 支持复用已有 Main

当前唯一 `componentStrategy` 增加 `decision: reuse-component`：

```text
reuse-component
├── decisionId / label / rationale
├── componentId              # 必须来自当前 inspection catalog
└── instances[]              # 交付 target 内计划创建的稳定 Instance ID
```

它与既有语义分工明确：

- `reuse-component`：Design File 已有 Main 服务同一语义工作，计划只声明交付内 linked Instances；
- `component`：本次交付创建或拥有 Main，并可声明 Instances；
- `ordinary`：没有稳定复用价值，保留语义 Frame/Group，不制造 Component。

Main 在接受 Plan 时验证 reuse componentId 仍位于同一 revision 的目录；缺失或被目录上限截断的 ID 失败关闭并要求重新 inspect/选择当前条目。目录不授予写权限，模型不得修改其他 Page 的 Main。实际 Instance 仍通过 `opendesign_manage_components create-instance`、当前 Page Mutation Target、Component Service 和唯一 EditorRuntime 事务创建；最终 exact-revision component quality report 继续验证 linked componentId。

Compact first-slice 只创建真实命名层级，不声明未来 Instance occurrence。首个真实材料 revision 提交并重新 inspection 后，完整 typed component tool 才可复用目录 Main、从 inspected Frame/Group 提升 Main 并创建 linked Instance；不增加目录读取或 skill 工具往返。见 ADR-0233。

## 后果与边界

- Agent 能先看当前文件设计系统再画，避免已有导航、按钮、字段、图标或内容模块被重新拆成 primitive。
- 选择权仍是语义判断：外观相似不等于可复用；不匹配时创建新 Main 或 ordinary 结构。
- 当前只覆盖 Design File-local Component discovery。跨文件 Library 发布、启用、权限、依赖、版本、更新审阅、接受/拒绝、失效引用和循环依赖仍未实现。
- 当前不做普通 Frame/Group 的自动结构相似度聚类，也不把名称相同或出现两次确定为 Pattern；高阶 Pattern discovery 仍需误报基线和人工样张。
- 目录截断时不会偷偷搜索或扩大 Page/Design File 作用域；后续可增加 Main 代理的有界 catalog search，而不是把全部组件塞进首轮上下文。

## 验证

- Renderer 目录覆盖 current-scope 优先、Design File 可用项、属性摘要、确定排序和不暴露 out-of-scope source tree；
- Main validator 覆盖 extra fields、重复 ID、错误 truncation/计数和非法属性；
- 普通/compact Plan schema 覆盖 `reuse-component`，compiler 保留 componentId 与 Instance reservations；
- Plan 注册拒绝不在当前目录的 componentId，接受当前条目；
- linked Instance 的最终结构检查继续复用现有 Component Service 身份；
- compact system+tools 继续低于既有首轮上下文预算，不提高门槛；
- Desktop typecheck、专项测试、完整 verify 与普通 build 继续通过。
