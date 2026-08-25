# ADR-0148：长 brief 的用户确认交付范围

状态：Accepted；其中 Delivery target 与 Page strategy 的绑定已由 ADR-0151 取代。其余范围确认、Plan/ledger 绑定与完成门禁继续有效。

## 背景

当前 executable Design Plan 和 completion guard 能证明模型已经声明的 target 是否完成，却不能证明模型是否从长 PRD、文档附件或多页面 brief 中声明了全部 target。模型若只把首页或一个代表页面写入 Plan，后续 ledger 可以在这个缩小后的范围内自洽地达到 verified，最终错误地向用户报告完成。

对所有请求都增加 Plan 审批会直接拖慢单页设计、小修改和 Logo/Icon 等明确任务。反过来，只依赖模型在内部自行列计划，用户直到几十分钟后才发现页面遗漏，返工成本远高于一次范围确认。范围确认必须只解决“交付什么”，不能成为新的设计解释作文、权限授予或视觉质量自评。

## 决策

### 普通请求继续直接执行

Main 根据可信 `run.start` 输入决定本 Run 的 `deliveryScopeReview`：

- 自动 continuation 始终沿用已有交付恢复语义，不重复确认；
- 文档附件、至少 2000 字符的长 brief、至少四条结构化列表，或明确要求至少四个页面、界面、画板、方向时要求确认；
- 其他聚焦请求保持 direct，不披露 scope review 工具，不增加 Provider turn 或用户操作。

该策略只选择交互路径。Renderer 不能提交或覆盖该字段，模型、附件内容和 skill 也不能改变 Main 的判断。

### 先确认用户可见 Delivery Plan，再建立 executable Plan

需要确认时，初始模型工具面只包含：

- `opendesign_review_delivery_scope`；
- `opendesign_inspect_document`，仅用于恢复或核对当前文档。

模型提交一份短、可读的 Delivery Plan：deliverable、整体 objective、按顺序排列的稳定 target ID/label/objective、每个 target 的 required content、exclusions 与 assumptions。每个 target 必须是可独立验收的界面画板、流程、视觉方向或资产，不能把一个画板内的标题、卡片和装饰拆成 target，也不能把用户要求的产品区域折叠成一个代表画板。Target 与文档 Page 的组织关系由 ADR-0151 单独定义。

Agent Timeline 显示真实 target 列表，并使用“确认并开始 / 调整计划”而不是通用权限文案。确认只表示用户接受本次交付范围；它不授予 Page、Design File、路径、网络或其他 capability。拒绝会以 cancelled 结束当前 Run，且在拒绝前不允许创建 Page、Plan、图片或画布 revision；用户通过下一条消息修订后开始新 Run。

确认成功后，scope 工具从模型面消失，恢复当前任务原本的 compact first-slice 或通用执行工具。一个 Run 只能消费一次确认；authorization 在成功消费后立即删除，不能重放或静默 amendment。

### Main 绑定 scope、Plan 与 ledger

Main 保持两层不同职责：

1. 用户确认的 Delivery Plan 是交付范围事实；
2. executable typed Design Plan 是布局、视觉系统、组件、Frame 和质量 profile 的执行事实。

executable Plan 必须保持确认过的 deliverable、target 数量、顺序和稳定 ID。确认后的整体 objective、target label/objective、required content、exclusions 与 assumptions 由 Main 作为可信宿主事实直接绑定到 canonical executable Plan，不再要求模型跨 Provider 往返逐字复制；模型同义改写或压缩 required content 不得制造一次恢复请求。Delivery Scope 不再声明或授予 Page 生命周期操作。

Coordinator 在注册 executable Plan 时执行绑定；completion guard 再将确认 target 与持久 delivery ledger 对齐。模型不能通过少报 target、换 ID、换顺序或代表页替代来获得完成状态。Scope approval 不扩大 Run `targetSet`，需要创建或跨 Page 操作时仍走既有 Page structure approval。

## 性能与体验后果

- 聚焦任务没有新工具、审批或 Provider 往返。
- 广泛 brief 在首次画布写入前增加一次模型 scope 输出和一次用户确认。这会推迟长任务的 T1，但避免模型按错误范围执行几十分钟；确认后仍使用真实 Frame allocation、首 target 优先和既有首切片路径。
- Scope 输出只描述交付 target，不要求解释每个圆、渐变、图层或坐标存在的原因。ADR-0147 的简短视觉方向仍与真实 first-slice 同一次调用提交，不增加用户审批或 Plan-only turn。
- 本决策防止“少做却完成”，不证明审美质量。视觉方向、独立 Critic 和固定样张盲评继续由 ADR-0147 与质量路线负责。

## 当前边界

- 确认 scope 是 Run 内可信状态；确认后、executable Plan 前若进程崩溃，当前不跨重启恢复该确认，用户需从新 Run 重新确认。
- 当前不支持同一 Run 内 amendment。用户选择“调整计划”后通过下一条消息生成并确认新范围；已进入材料阶段的 Plan amendment 继续遵循既有稳定 target/Page/Frame ID 规则。
- 自动 continuation 不重复 scope review，但必须从持久 delivery ledger 恢复未完成 target，不能借 continuation 改写根 Run 的交付范围。

## 验证

- Main policy 覆盖聚焦请求、文档附件、长文本、四项列表、明确多交付和 continuation。
- required Run 首轮 Provider 只看到 scope review 与 inspect；direct Run 看不到 scope 工具；确认成功后 scope 工具消失并恢复正常工具面。
- 动态审批卡显示实际 target 列表；拒绝终止 Run 且不执行 tool；确认只允许 call-scoped `allow_once`。
- Main 拒绝未确认的 Plan/写入，拒绝 deliverable 漂移、target 缩减、替换和重排；已确认文本由 Main canonical binding，不做脆弱的字符串相等校验。Authorization 一次消费并在所有 Run 终态清理。Page 生命周期与跨 Page 操作继续使用独立 capability/approval。
- completion guard 在 scope 缺失或 ledger 不匹配时拒绝完成，在全部确认 target verified 后才允许完成。
