# ADR-0140：Renderer feature 所有权与语言 catalog

- 状态：已接受
- 日期：2026-08-22

## 背景

ADR-0046 已确立 Renderer feature controller 模式，但后续项目、Conversation、图片、画布和诊断能力继续直接进入 `AppContent`。到本决策前，`apps/desktop/src/renderer/App.tsx` 已达到 3404 行，同时拥有工作台布局、资源导航、Conversation 生命周期、Agent event/history、图片编辑、文档命令、诊断和 view composition。文件长度不是根因；真正问题是多个独立状态机共享一个组件生命周期，导致修改任一功能都需要理解整个应用入口，测试也只能依赖巨型 App 集成 fixture。

`apps/desktop/src/shared/i18n/messages.ts` 同时包含完整英文和简体中文 catalog，也让语言、业务域、key 类型与运行时插值混在一个模块。新增 feature 文案没有明确 owner，容易产生重复 key、漏翻译和无关冲突。

## 决策

### App 只负责顶层组合

`App` / `AppContent` 最终只保留：

1. Workspace shell 与顶层 view composition；
2. 当前 Workspace/Project/Design File/Page/Conversation 的活动身份；
3. feature controller 的依赖接线；
4. 必须跨 feature 协调、且不能归属单一业务的少量应用生命周期。

以下状态和流程必须归属对应 feature controller，而不是继续加入 App：

- Image：替换、AI 编辑、pending/cancel、stale 校验、来源切换、滤镜与 placement；
- Workbench：面板可见性、宽度持久化、窄窗口策略和 tab；
- Conversation：列表、打开/删除、history sync、Agent event projection 与 Run binding；
- Project navigation：最近项目、Project/Design File 打开创建重命名和 autosave 协调；
- Canvas workspace：viewport 命令、session controller 与工作台快捷键；
- Diagnostics：订阅、作用域投影、dismiss 与恢复入口。

controller 可以组合纯 helper 和子 controller，但必须拥有完整业务生命周期、明确 input/output contract 和定向测试。不得为了缩短文件把同一状态机拆成互相回调的 `utils`，也不得复制 `DesignDocument`、selection 或 revision 到新的 React store。每次读取和写入仍以唯一 `EditorRuntime` snapshot/transaction 为准。

代码行数只作为职责失控的信号，不设置任意 500/800/1000 行验收数字。验收标准是模块所有权、依赖方向、可独立测试性和单一事实状态。

### i18n 分离 registry、语言和 feature

`shared/i18n/messages.ts` 只保留 catalog registry、`MessageKey` / parameters 类型和插值函数。英文与简体中文必须位于独立语言 catalog；中文 catalog 继续通过 `satisfies Record<MessageKey, string>` 保证缺 key 和多余 key在编译期失败。

新增或实质修改的业务文案应进入对应 `catalogs/features/<feature>/<locale>.ts`，由语言 catalog 聚合。既有 core 文案按后续业务切片迁移，不做一次高风险大爆炸重写。语言 catalog 不得导入 Renderer view、Main 实现或 Runtime。

### 渐进迁移顺序

本决策首个切片抽出 Image workflow 与 Workbench layout controller，并建立分语言 catalog 和 Image feature 文案。后续按以下顺序继续：

1. Conversation lifecycle/history；
2. Project/Design File navigation 与 autosave；
3. Canvas viewport/session/shortcut；
4. Diagnostics；
5. 将剩余 core catalog 按上述 feature 所有权迁移。

每个切片保持产品行为，补定向 controller 测试和少量 App 接线测试。需要改变产品契约时单独记录 ADR，不借架构迁移静默改变行为。

## 后果

- `App.tsx` 会随完整职责迁移逐步收缩，而不会通过机械切文件制造新的耦合。
- feature 可以独立测试取消、异步竞态、stale、错误恢复和 shell 状态，不再完全依赖巨型 App fixture。
- 新能力有明确落点，后续图片功能不会再次回填 App。
- catalog 变更减少中英文无关冲突，并保持编译期翻译完整性。
- 迁移期间 App 和 core catalog 仍然偏大，不能把首个切片描述为全仓架构治理完成。

## 验证

- Desktop typecheck、lint 与 architecture check。
- Image workflow 定向测试与 App/PropertiesPanel relight 集成测试。
- Workbench 面板持久化、窄窗口与快捷键集成测试。
- i18n 中英文 key 完整性、插值和现有 Timeline/Main 翻译测试。
