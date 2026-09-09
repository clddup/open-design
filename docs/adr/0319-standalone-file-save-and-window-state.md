# ADR-0319：独立文件保存保护与原生窗口状态

- 状态：Accepted
- 日期：2026-09-09

## 决策

独立打开的设计文件保留显式保存语义。关闭窗口或替换未保存文件前，由原生对话框提供保存、不保存、取消；保存失败或取消保留内容。不保存只确认当时的 revision，等待期间产生的新修改仍需处理。

手动保存和关闭保存共用每个 EditorRuntime 的在途队列，在实际轮到保存时读取最新快照。只有成功写入的 revision 仍等于当前 revision 才 checkpoint，避免保存期间的新修改被错误标记为已保存，也避免较早保存覆盖较新保存。

Main 按 documentId 记录用户明确选择过的路径。只有一个路径时复用该路径；同身份出现多个副本时走已有原生保存框，由用户决定位置。路径不进入 Renderer 协议或 Agent 工具，不增加隐式文件权限。

macOS 关闭全部窗口后，设置与导入菜单创建窗口并等待相应 Renderer 订阅就绪，再交付该命令。Windows 最大化按钮订阅原生 maximize/unmaximize 状态，显示正确的最大化或还原操作；晚到的初始查询不得覆盖新事件。

## 验证与范围

定向测试覆盖关闭取消、保存失败、保存期间继续编辑、重叠保存顺序、同 documentId 副本的路径选择、菜单延迟交付和最大化事件竞态。新窗口 payload 复用共享 window contract 在 Main 与 Preload 校验。

这些自动化验证不替代 macOS/Windows 原生构建、安装和产品 smoke；本次未启动 Electron，也不是桌面发布验收。

### 实际执行的验证命令

```sh
pnpm --filter @opendesign/desktop exec vitest run src/main/desktop-window-host.test.ts src/main/standalone-design-file-ipc.test.ts src/renderer/features/project/standalone-unsaved-changes.test.ts src/renderer/features/project/project-autosave.test.ts src/renderer/components/app-window/WindowControls.test.tsx src/renderer/components/app-window/HomeTitlebar.test.tsx --maxWorkers=1
pnpm --filter @opendesign/desktop exec vitest run src/renderer/App.test.tsx -t 'blocks standalone window close|saves the structured document|keeps dirty state when saving fails|uses the preload platform' --maxWorkers=1
```

六个相关测试文件共 40 项通过；App 只运行关闭、保存和平台相关的 4 项，未运行其余用例。Desktop 类型检查及变更文件 ESLint、Prettier、git diff --check 通过。
