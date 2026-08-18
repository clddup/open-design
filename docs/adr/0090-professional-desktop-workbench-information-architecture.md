# ADR-0090：专业桌面工作台的信息架构与画布优先体验

- 状态：Accepted
- 日期：2026-08-18
- 文档协议：不变
- 关联：ADR-0028、ADR-0050、ADR-0080

## 背景

现有编辑器已具备大量专业语义，但工作台入口随能力增长平铺：左侧把 Layers、Assets、Styles、Variables 四个同级入口压入窄面板，非 Assets 视图仍占用不可用搜索栏；右侧 Agent/Properties 平均分配整行标签，会话、运行状态和消息形成多层 Chrome；顶部 Titlebar、Toolbar、文件标签和底部状态栏共同侵占画布。功能存在不等于高频工作流容易使用。

产品继续采用跨平台 Electron 客户端和 Web 画布。视觉可以参考 Figma 等现代专业设计工具的轻量 Web 技术表达，但信息架构必须保持桌面工作台特征：稳定空间、紧凑面板、直接操作、键盘与画布优先，而不是后台网站、营销页或卡片集合。

## 决策

### 画布是固定中心

工作台维持 Title/command chrome、左 Navigator、中央 Canvas、右 Utility、底部状态的稳定关系。顶部各层缩短但不合并事实职责；左右面板可从 Titlebar 独立显隐，隐藏时同时移除 splitter 并把空间完整交还 Canvas。面板显隐是 Renderer session state，不修改设计文档、history 或 revision。

### 左侧按用户对象而非底层 registry 分组

一级入口固定为：

1. Layers：Page 与当前 Page 图层树；
2. Assets：图片和 Component 资产；
3. Library：Styles 与 Variables 的二级视图。

Layers 与 Assets 都提供真实搜索；不再展示“搜索暂不可用”的占位控件。Library 负责后续跨文件发布/消费入口，Styles/Variables 不再与文档导航争夺一级宽度。

### 右侧按工作模式切换

Agent 与 Properties 保持两个模式，不同时挤压 Canvas。标签左对齐、内容优先；Agent 的 Conversation、可信运行状态、真实设计步骤、消息和 Composer 保持清晰层级。模型等待、真实 revision、自动修正和最终 delivery 由可信事件投影，不能由聊天文案冒充。

活动 Run 的主状态在当前可见空间中只出现一次：Utility 打开且 Agent tab 可见时，由右侧详细状态区承载；Utility 隐藏或切到 Properties 时，Canvas 右上显示紧凑状态卡作为回退。基于真实 revision 的 cursor/reveal 继续留在 Canvas，因为它表达实际变更位置而不是重复状态。两种状态视图消费同一纯投影，不建立第二份 Run 状态。

Properties 不为未实现能力保留禁用的一级标签。当前选区身份固定在 Inspector 顶部，高频 Layer、Component identity、Auto Layout、Layout、Typography 与 Appearance 在前；普通对象的组件创建以及 Effects、Styles、Variables 和 Export 使用可访问的折叠分组。分组开合是 Renderer 展示状态，不进入 DesignDocument、revision 或 history，也不改变现有语义事务回调。

### 面板键盘与窄窗口策略

Navigator 与 Utility 分别使用 `Cmd/Ctrl+Shift+1` 和 `Cmd/Ctrl+Shift+2` 切换；Titlebar 按钮通过 `aria-keyshortcuts` 暴露相同命令。快捷键在 input、textarea、select、contenteditable 和组合框内不执行，避免破坏画布文字编辑或 Inspector 输入。

显隐偏好保存在 Renderer 本地工作台状态，不属于项目或设计文件。窗口从宽布局跨到 960px 时一次性收起 Navigator，跨到 760px 时再收起 Utility；在同一窄窗口区间内用户手动重开后保持其选择，不以每次 resize 强制覆盖。自动收起不覆盖持久偏好，扩大窗口也不擅自打开用户已隐藏的面板。

### 客户端密度与反馈

Titlebar、Toolbar、文件标签和 Statusbar 使用一致的紧凑尺寸、细分隔和有限强调色。普通控件不使用营销式卡片、巨型圆角、装饰渐变或大面积阴影。hover、selected、focus、running、error 和 hidden 必须同时有结构或文字信号，不能只靠颜色。

### 画布直接操作优先于全局命令入口

当前选区在 Select 工具下提供贴近画布底部的紧凑上下文操作条，包含复制、编组/解组、前后层级、打开 Properties 和删除。裁剪、矢量节点与 Boolean 编辑期间隐藏该操作条，避免与精密编辑模式争夺输入；所有写操作继续调用既有 EditorRuntime 命令，不建立第二份状态。Navigator/Utility 的拖拽与键盘调整宽度保存在 Renderer 本地工作台状态，不修改文档 revision。

本阶段不增加全局命令面板。现有顶部工具、对象就地操作、Properties 和键盘快捷键已覆盖当前高频路径；在没有可证明的跨功能检索需求前，命令面板只会增加入口和维护成本。

## 当前切片与后续

本 ADR 的前三个切片已完成一级 IA、Layers 搜索、Library 二级切换、紧凑 Utility tabs、面板显隐、Shell 密度、可信 Agent 状态、Properties 渐进披露、面板快捷键/偏好、窄窗口画布优先策略、Canvas 选区就地操作和面板宽度持久化。第四个视觉收口切片已根据打包产品的浅色/深色证据消除 Agent 面板与 Canvas 状态卡的重复：当前可见空间只保留一个主状态入口，真实 cursor/reveal 不受影响。后续仍需完成窄窗口、触控板缩放和选区 editBox 的打包产品人工验收；不得重新把能力平铺为更多一级标签。

## 验证

- Sidebar 测试覆盖三入口 IA、Library 二级切换、真实 Layers 搜索与空结果；
- Titlebar 测试覆盖可访问的左右面板显隐控制；
- App 交互测试覆盖键盘显隐、输入焦点保护、偏好写入与窄窗口跨阈值行为；
- Properties 测试覆盖无效 Prototype 入口移除、高频分组默认展开与高级分组渐进披露；
- Canvas 交互测试覆盖选区操作、编辑模式互斥、Properties 直达和重复 accessible name；
- App 交互测试覆盖面板宽度读取、边界约束、键盘调整与本地持久化；
- Agent/Utility 测试覆盖键盘 tab 切换、运行状态、Conversation 与停止；
- App 交互测试覆盖 Agent tab、Properties tab 和隐藏 Utility 三种空间状态下只有一个可见的 Run 主状态；
- Desktop 类型、交互测试与 Vite build 验证 CSS Modules 和 Renderer 集成；
- macOS/Windows 原生 Action 继续阻塞发布，自动化不能替代打包产品的宽/窄窗口人工视觉 smoke。
