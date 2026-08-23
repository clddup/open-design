# ADR-0145：退休自定义仓库清单门禁

状态：Accepted，取代 ADR-0046、ADR-0086 与 ADR-0141 中关于 `architecture:check` 的执行决策。

## 背景

仓库曾通过 `architecture-policy.json`、TypeScript AST 扫描和 Agent Core 源码正则，在普通 `verify` 中检查 package/process allowlist、源码依赖图、manifest 使用情况和特定实现名称。这些规则与 `package.json`、公共 exports、TypeScript 契约和行为测试重复维护。新增合法依赖或重命名实现时，清单和正则可能先于真实类型、测试与构建失败；通过门禁也不能证明桌面产品可启动、Agent 可运行或设计事务正确。

## 决策

- 删除 `architecture:check` 及其 policy、AST rules、repository scanner 和自测。
- 删除 `agent-core:check` 的源码正则与重复版本比对。
- 根 `pnpm verify` 只执行 format check、lint、typecheck、行为测试与 build。
- macOS/Windows 原生 package、安装包内容校验和 packaged Agent smoke 继续在各自原生 runner 执行。
- package/process 边界继续由窄公共 exports、TypeScript 契约、拥有者行为测试、Electron 安全配置和评审维护；不再创建第二份依赖 allowlist。
- 若某类边界错误在真实代码中复发，在拥有该行为的包或进程增加直接测试；不恢复全仓文件数量、内容 hash、源码命名或依赖库存门禁。
- 设计评测和 fixture/capability generator 保持按需工具，不进入普通 `verify`。

## 后果

- 新依赖只在对应 manifest 和 lockfile 中声明，不需要同步中央 package allowlist。
- 普通 CI 失败将更接近格式、类型、行为或可构建性问题。
- 代码评审仍需遵守 Main、Preload、Renderer、Agent、Shared 和 workspace package 的架构边界；移除机械门禁不改变这些产品安全要求。

## 验证

- `pnpm verify`
- macOS 与 Windows 原生 runner 各自执行 package、安装包内容校验和 packaged Agent smoke。
