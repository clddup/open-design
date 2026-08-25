# ADR-0151：Delivery target 是画板，不是文档 Page

状态：Accepted，取代 ADR-0148 中 `pageStrategy` 与 target/Page 数量绑定的部分。

## 背景

OpenDesign 的资源层级中，Page 是 Design File 内的高层组织容器，Frame/Artboard 才是具体界面、流程节点和视觉资产的交付单位。旧 Delivery Scope 同时描述“交付什么”和“如何组织 Page”，并提供 `current-page-artboards` / `separate-pages` 二选一。模型选择 `separate-pages` 后，Main 会把每个 target 强制绑定到不同 Page，并在执行 Plan 前要求先创建对应 Page。

这会把“24 个产品界面”错误执行成“24 个文档 Page”。审批卡只显示 target 列表，用户无法看到或理解隐藏的 Page 组织后果；大量 Page 也会破坏同套设计的整体浏览、对比、组件复用和画布操作习惯。

## 决策

Delivery Scope 只描述可独立验收的交付 target，不再包含 `pageStrategy`，也不触发 Page structure access。Target 默认映射为当前 mutation target Page 下的一个稳定 Frame/Artboard：同一产品、同一平台、同一流程或同一资产套件，无论 target 数量，都保持一个 Page、多画板。

审批卡明确显示“将在当前 Page 创建 N 个画板”，但不增加新的审批步骤。Executable Plan 继续保持已确认 target 的数量、顺序、稳定 ID、label、objective 与 brief fidelity；不再校验 target 数量与 Page 数量的对应关系。

Scope 确认后的文本事实由 Main 直接写入 canonical executable Plan：整体 objective、target label/objective、required content、exclusions 与 assumptions 不依赖模型逐字回传。Main 仍拒绝 deliverable、target 数量、顺序或稳定 ID 漂移，因此该绑定消除的是同义改写失败，不会允许模型缩小或替换交付范围。

Page 生命周期保持独立：只有用户明确要求按产品域、平台、交付阶段或其他高层组织边界创建、重命名、删除或跨 Page 操作时，Agent 才能调用 `opendesign_request_page_structure_access`，并经既有 Main capability/approval 执行。Target 数量、用户文字中的“页面/界面”或 Delivery Scope 不能隐式授予该权限。

## 后果

- 长 brief 的 1..N 个 target 会先在当前 Page 分配 1..N 个真实 Frame/Artboard 根，随后优先完成第一个 target。
- 用户可在一个画布中连续查看、比较和操作完整产品套件，组件与视觉系统也不被无意义的 Page 边界切散。
- 真正需要多 Page 的任务仍受独立 Page lifecycle 工具、整文件 inspection、显式授权和 mutation target 约束。
- 这是开发期破坏性契约更新，不保留 `pageStrategy` 兼容字段、双写或迁移 fallback。

## 验证

- Delivery Scope schema 拒绝未知 `pageStrategy`，Provider 与 Runtime 使用同一结构契约。
- 24 个确认 target 可合法绑定为当前 Page 下的 24 个画板，并且不会返回 `request-page-structure-access`。
- Coordinator 仍拒绝未获 Page structure access 的跨 Page executable Plan。
- 显式 Page lifecycle approval 不再被误当成“必须创建与 target 等量 Page”的交付事实。
- 模型改写 objective/label 或压缩 required content 时，Main 以已确认 scope 生成 canonical Plan，不产生 `delivery_scope_mismatch`；target 数量、顺序、ID 或 deliverable 漂移仍失败。
