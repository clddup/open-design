# ADR-0143：宿主拥有的层级首切片区域

- 状态：Accepted
- 日期：2026-08-23
- DesignDocument / transaction / revision：不变
- 取代：ADR-0028、ADR-0103、ADR-0125 中 create target 的 planned region 必须由模型创建并直属画板，以及首切片合计 32 个模型元素的限制
- 关联：ADR-0028、ADR-0080、ADR-0103、ADR-0125、ADR-0127

## 背景

生产 Run `run_1787465422807_1` 请求一个登录注册页。首次 compact call 提交 35 个合理元素，被固定 32 元素上限拒绝；修正调用又把已声明的 `footer_region` ID 用作 Text，并把 `form_region` 放在 `auth_region` 内。Provider 看到的设计层级合理，但当前宿主同时要求模型声明 region、再次创建同 ID 容器，并要求所有 region 都是画板直属 Group/Frame。事务因此在任何设计 revision 前失败，恢复过程中又只报告累计候选的最后一个索引错误。用户等待约 316 秒后画布仍为空。

根因是同一结构事实由 Plan 与模型元素重复持有，并且扁平 region 契约无法表达常规 Frame/Group 父子关系。提高一个常量或针对 footer ID 放宽校验都不能解决这类失败。

## 决策

### Region 是有父级的可信结构

`DesignPlanRegion` 可以声明 `parentId`。省略时父级是 target artboard；声明时必须引用同 target 中更早出现的 region。region 按 parent-first 顺序排列，`x/y/width/height` 始终是父级局部几何，并且必须落在父级 bounds 内。

General Plan 保留顶层 region 的简写；compact first-slice 要求每个 region 显式声明 `parentId`，避免模型猜测坐标系。create target 的结构检查、可信几何编译、capture 门禁和 skeleton 投影都消费同一父级关系。existing target 的 region 仍只用于逻辑规划和审查，不强迫现有文档仿造容器。

### Compact 模型不再创建 region 容器

compact `firstSlice.elements` 不得复用任何 planned region ID，也不得把 region ID 用于 Text、装饰或普通内容。模型只把真实 editable element 的 `parentId` 指向 planned region 或更早的普通 element。

可信 Main 在每个 semantic stage 首次引用 region 时，按父级优先顺序注入真实无装饰 Frame 容器。该入口同时服务 compact first-slice、continuation 和普通 create-target apply。只创建被真实内容使用的 region 及其祖先；未使用 region 不写入文档，不制造空 Group。容器与同 stage 的内容一起进入既有 progressive transaction、history group、revision、rollback 和一次 undo。Main 从注册 Plan 绑定 Page、parent、transform 与 size，模型不能覆盖这些结构事实。

### 首屏只服从共享事务安全边界

首切片不再维护 32、48 或 1–3 stage 等产品私有数量门禁。模型可以按当前目标需要提交语义 stage 和可编辑内容，最终编译结果只服从公共 `DesignTransaction` 的 500-command 资源安全上限。该上限来自所有写入路径共用的事务契约，不是设计质量指标；超限时按完整编译命令数返回准确字段路径，并在一个连贯视觉边界后继续。

首屏不能为了满足固定元素配额退化成占位稿。模型应优先提交具有真实层级、内容和视觉命题的可编辑画面；只有真实依赖未知或达到公共事务安全边界时才 continuation。

### 渐进失败返回最早语义边界

Renderer 可以尝试更长的 semantic step 前缀以满足跨步骤文档 invariant；若所有候选均失败，返回最短候选的首个确定性错误及其实际命令集合，不再用最后一个累计候选的索引错误覆盖根因。已提交阶段仍按既有 history group 回滚。

## 后果

- 普通 `auth → form`、品牌方向子区和内容模块可以保持 Figma 式父子结构，不再被强制铺平到 artboard。
- Plan 是 region 身份和几何的唯一结构事实；模型输出更短，也不会因同 ID 的 kind、parent 或 bounds 重复抄写失败。
- 所有真实 region 和内容仍通过唯一 EditorRuntime 事务进入文档，没有第二份可写状态或直接 Renderer mutation。
- 首稿没有独立元素配额；真实收益继续以 Provider 首事件、首 Assistant 可见内容、首 material revision、视觉审查与最终完成时间测量。
- Agent 时间线可以汇总同一未提交恢复链的中间失败，但不得隐藏最终根因或把零 revision 显示为设计进展。

## 验证

- compact schema/normalizer 拒绝模型元素复用 region ID，并接受 region parent-first 层级；
- 35 个及超过历史 48 配额的模型内容、`auth_region → form_region` 与独立 footer 可在一个 compact call 中编译为父级优先真实 Frame 和内容命令；
- Main write/capture 门禁接受嵌套 region，拒绝错误父级、越界 region 和空 region；
- skeleton 把嵌套 parent-local 几何累加到 artboard-local 展示坐标；
- semantic transaction 在所有候选失败时报告最短候选的首个错误；
- 打包产品记录 `T_provider_first_event`、`T_assistant_visible`、`T_first_material_revision` 和 `T_all`，并区分 Provider 等待与本地恢复循环。
