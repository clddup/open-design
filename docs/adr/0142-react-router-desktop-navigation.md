# ADR-0142：React Router 桌面导航与资源提交协调

- 状态：已接受
- 日期：2026-08-23
- 取代：ADR-0141 的 Renderer `AppNavigator` destination store 决策
- 保留：ADR-0141 的 latest-wins 资源提交、活动资源单 owner 与 Editor route 生命周期边界

## 背景

ADR-0141 用自有 `AppNavigator` 修复了 Project、Conversation 和 Design File 异步打开时的迟到提交，但它同时持有当前 destination、Settings return、订阅和页面分发。Renderer 因此仍由 `App.tsx` 根据 `destination.kind` 手动选择整页，返回栈、未知目标和 route boundary 也继续由产品代码重复实现。

Electron `loadFile(index.html)` 确实不适合直接采用依赖服务器 fallback 的 Browser Router，但这不构成拒绝路由层的理由。当前产品已经存在 Workspace、Project、Conversation、Editor 与 Settings 多个稳定应用页面，正式 route boundary 的收益已经超过依赖和迁移成本。

## 决策

Renderer 使用固定 `react-router-dom@7.18.2` 作为唯一页面 destination 和历史栈 owner。安装后的 Electron 客户端使用 `createHashRouter`，因为 Renderer 由 `file://.../index.html` 加载，hash 之后的 route 不会被操作系统解析成本地文件路径；测试使用 `createMemoryRouter`，避免修改进程级 `window.location.hash`。生产与测试复用同一份 `RouteObject[]`，不存在第二套业务路由。应用 route 为：

```text
/
/projects/:projectId
/conversations/:conversationId
/editor/:fileKey
/settings
/invalid
```

Project ID、Conversation ID 和 Workspace file key 以编码后的稳定资源身份进入 route。文档内容、revision、selection、tool、viewport、panel、modal、表单、Run、Capability 和凭据不得进入 route。

`RouterProvider` 与嵌套 route object 唯一决定页面挂载；Editor-only Canvas、Inspector、Image edit、Import/Export 和 Workbench controller 只在 Editor route 下建立。Settings 使用 Router history 返回，未知路径确定性回到 Workspace。资源不存在或打开失败进入 `/invalid`，具体错误和原请求只通过受验证的内存 route state 携带，不拼接到路径。

异步资源打开仍需要递增 epoch，但该能力缩为 `AppNavigationCoordinator`：它只判断 begin/commit/fail/cancel 是否属于最新意图，并通过窄 Router port 提交结果。它不保存当前 destination、不提供订阅、不拥有历史栈，也不参与页面渲染。

当前不使用 Browser Router：安装包没有 Web 服务器为任意 history path 提供 `index.html` fallback。Hash route 只表达当前 UI destination，不是 Project、Design File、Run、Capability 或权限事实；窗口重启恢复和外部协议打开仍必须由 Main 解析稳定资源并重新校验，不能直接信任 hash。

## 结果

- Renderer 不再维护自写页面 store，返回栈和 route matching 交给成熟路由实现。
- latest-wins 与页面导航分离，异步资源协调不能演化成第二套路由。
- 页面边界可独立挂载、释放和测试，Editor controller 不泄漏到 Workspace、Project、Conversation 或 Settings。
- 生产 Hash Router 与测试 Memory Router 复用同一 route objects；差异只在 history adapter。
- 新增一个固定生产依赖及少量路由编码/不可信 state 校验代码。

## 验证

- route contract 覆盖稳定 ID 编码往返、invalid state 校验和未知路径；
- coordinator 覆盖 latest-wins、active failure、cancel 和 Settings history；
- Project/Conversation controller 测试只断言 Router port 提交，不再读取自有 destination store；
- App 集成测试覆盖 Workspace、Project、Conversation、Editor、Settings 返回和资源错误页面；
- Desktop typecheck、lint、format、architecture check 和 production build 验证依赖与进程边界。
