# ADR-0009：采用 LeaferJS 作为渲染与画布交互引擎

- 状态：已接受
- 日期：2026-08-09
- 取代：ADR-0005 中由 OpenDesign 自行实现 viewport、输入、命中测试、选择、变换控制框与 Canvas2D 生产渲染后端的决定
- 保留：ADR-0005 中 OpenDesign 拥有文档协议、事务、revision、diff、history 与持久化事实的决定

## 背景

ADR-0005 正确拒绝了把完整第三方编辑器作为第二份产品事实状态，但候选调研只比较了 OpenPencil 完整编辑器与原生 Canvas2D，没有评估“成熟图形与交互引擎 + OpenDesign 自有文档事务”的中间方案。结果是首个 Canvas2D 后端虽然依赖少，却迫使 OpenDesign 自行实现 viewport、坐标转换、命中测试、框选、多选、移动、缩放、旋转、文本内编辑、编组与高频交互预览。真实产品验证已经证明该路径难以达到 UI、海报和通用设计所需的专业编辑质量。

LeaferJS 2.2.9 是 MIT 许可的 Web 图形与交互引擎。其场景树与官方 Editor、Viewport、Resize、TextEditor 等插件覆盖 OpenDesign 当前缺失的高风险画布基础能力，同时允许 OpenDesign 保持独立的文档、事务、Agent 与安全边界。

## 决策

OpenDesign 使用固定版本 `leafer-editor@2.2.9` 作为 Renderer 中唯一的生产画布渲染与直接操作引擎，并通过 `@opendesign/leafer-engine` 适配包隔离所有 Leafer 类型和 API。

职责划分如下：

- OpenDesign `DesignDocument` 是唯一可持久化设计事实。
- `EditorRuntime` 继续拥有事务校验、单调 revision、diff、history、undo/redo、checkpoint、dirty state 与冲突行为。
- Leafer 场景树是活动 Design File 当前 revision 的可丢弃投影，不写入项目文件，也不成为第二份 durable state。
- Leafer 负责图形渲染、DPR、资源生命周期、viewport、坐标转换、命中测试、hover、选择器、框选、多选、变换控制框、移动、缩放、旋转、倾斜、组内进入和文本内编辑。
- React 工作台只挂载 Leafer host、显示产品状态和调用 OpenDesign 命令，不再实现 canvas pointer/wheel 几何。

### 人工编辑进入事务的方式

Leafer Editor 在手势期间可以临时修改其活动场景，以保持逐帧响应。适配器在交互开始时记录当前 OpenDesign 节点状态，在交互结束时读取稳定 ID 对应元素的最终属性并生成候选 `DesignOperation[]`。受信任 Renderer 使用当前 `documentId` 与 `baseRevision` 创建一条 `DesignTransaction`，交给唯一 `EditorRuntime.apply()`：

- 成功：用新 revision 快照重新同步 Leafer 投影；一次手势只产生一条撤销记录。
- 冲突、取消或失败：丢弃 Leafer 临时状态并从权威 OpenDesign 快照恢复。
- 选择、hover、tool 与 viewport 继续属于 session state，不增加文档 revision。

文本内编辑、编组/解组、层级调整和画布创建工具遵循同一规则，不能直接持久化 Leafer JSON。

### Agent、MCP 与进程边界

Agent、MCP、skills、Main 和 utility process 不获得 Leafer `App`、`UI` 或场景树句柄。它们继续生成或转发版本化 `DesignTransaction`；成功应用后，Renderer 仅把新的 OpenDesign 快照投影到 Leafer。Leafer 不增加文件、网络、凭据、IPC 或路径能力。

### 节点与能力映射

首个映射至少覆盖：

- `frame` → Leafer `Frame`
- `group` → Leafer `Group`
- `rectangle` → Leafer `Rect`
- `ellipse` → Leafer `Ellipse`
- `text` → Leafer `Text` + TextEditor
- `image` → Leafer `Image`
- `vector` / `path` → Leafer `Path`

稳定 OpenDesign `node.id` 必须保留在 Leafer 元素 ID 与适配器索引中。fills、strokes、opacity、corner radius、transform、size、visibility、lock、clip 与文本属性进行显式映射；未验证语义返回 fidelity warning 或 `unsupported`，不得静默丢失。

锁定采用层级语义：节点自身或任意祖先锁定时，该节点在画布中的有效状态均为 locked。锁定节点仍可被命中并加入单选选区，用于检查属性和作为 Agent 上下文，但不得直接变换、文本编辑或作为新建图层容器。图层导航同样可选中锁定节点；自身锁定可直接解锁，纯继承锁定必须从对应祖先解除。相邻 revision 改变锁定或父子关系时，只增量重投影受影响子树，并取消其中正在进行的直接操作。

相邻 revision 的正常同步必须消费 `DesignChangeSet`，保留未变投影 spec 与 Leafer 元素 identity，只 reconcile affected nodes、变更父子关系和引用变更 asset 的节点。选区 bounds 只对与变化存在祖先/后代关系的选中元素失效；不得以 revision 变化为理由隐藏 Editor、重放全部 `set()` 或无条件刷新 tree bounds。首次挂载、Design File/Page 切换、revision 断档和交互失败恢复允许从权威快照全量重建，作为可验证的正确性回退而不是常规更新路径。

复杂外观与图片能力不以 Leafer 私有 JSON 进入公共契约。渐变、图片 Paint、光晕、阴影、模糊、混合模式与蒙版采用 ADR-0010 的 OpenDesign `1.1.0` 语义，再由本适配器投影到 Leafer。

Leafer Flow 自动布局当前不能与 Editor 元素直接混用，因此不把其作为本次迁移已完成能力。OpenDesign 布局语义必须在独立兼容性验证后再进入公共契约。

## 迁移与删除门禁

代码迁移已经完成且不保留 fallback 或双写路径：

1. 建立 `@opendesign/leafer-engine`，禁止 Leafer 类型越过该包的公共边界。
2. 用 Leafer host 替换 Renderer `Canvas` 中的 `<canvas>`、`Canvas2DRenderer` 和手写 pointer/wheel/selection overlay。
3. 选择、viewport 和手势事务桥通过行为测试后，从 Desktop 依赖图移除 `@opendesign/render-canvas2d`。
4. 删除不再执行的 Canvas2D 产品包、测试和基线项；不得保留隐藏开关或兼容 fallback。
5. 更新固定版本、锁文件、第三方声明、产品架构与打包验证。

上述代码与依赖图门禁已经落地；复杂效果、图片、Agent 渐进 revision 与高频 viewport/editBox 的真实 Electron 视觉验证仍按 `docs/roadmap.md` 和 `docs/verification.md` 持续执行。

## 风险与缓解

- Leafer 是引擎而不是完整设计产品；属性面板、资源、组件、设计 token、Agent 工作流和文件格式仍由 OpenDesign 实现。
- Leafer 插件版本需要保持完全一致。使用集成包 `leafer-editor@2.2.9` 并禁止浮动版本。
- 文本编辑依赖 Web DOM overlay；必须验证中文输入法、组合事件、缩放、字体缺失和焦点恢复。
- SVG/PDF、富文本、路径布尔、专业吸附和自动布局不能按宣传页推断完成；分别通过能力协商和兼容性测试进入产品。
- 第三方场景树临时可写；适配器必须抑制投影同步产生的回流事件，并在事务失败时权威回放。

## 验证

- 当前文档投影、增量同步、删除与重建保持稳定 ID 和图层顺序。
- 选择、框选、移动、缩放、旋转、锁定、编组与文本编辑从一次手势生成一次事务。
- wheel、触控板、空格拖拽、fit page/selection 和高 DPR 下 viewport 与画面一致。
- UI、Agent 和 undo/redo 修改都通过同一快照投影得到相同视觉结果。
- 保存、关闭、重开后文档结构与视觉基线一致，不需要 Leafer 私有序列化。
- 事务冲突、取消、Agent 渐进修改和渲染异常不会留下未提交的 Leafer 状态。
- 运行节点数量、复杂文本、图片、蒙版与效果基准，并记录 Electron 固定 Chromium 下的结果。
