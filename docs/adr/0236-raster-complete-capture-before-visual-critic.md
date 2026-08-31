# ADR-0236：图片主体补全后再启动独立视觉审查

- 状态：Accepted
- 日期：2026-08-31
- DesignDocument：不变
- Agent Plan / Review 契约：不变
- 关联：ADR-0095、ADR-0104、ADR-0117、ADR-0127、ADR-0233、ADR-0235

## 背景

Compact first-slice 会在首个材料 revision 后立即 capture。需要真实人物、活动、地点、商品或环境证据的任务则必须在首切片之后调用图片服务，再把已声明的 raster role 放入画板。旧流程在这两个步骤之间已经启动独立 Visual Critic；Critic 只能看到尚未放置主体图片的半成品，并按 Graphic Skill 必然报告素材缺失。

这不是有效的质量审查：它额外消耗一次 Provider 请求，先制造一个预知会失败的 Review，再要求模型穿过 review/refinement 门禁补上原本就已计划的图片。用户看到的是画布长时间不变和重复错误，而不是专业设计步骤。

## 决策

### 权威 inspection 决定审查资格

Main 在 exact-revision capture 后记录权威 inspection，并从当前 delivery target 的真实后代节点判断 Plan 已声明的可放置 raster role 是否完成：

- 只接受真实 `Image` 节点；
- role 来自节点持久 `extensions.designRole`，不从名称、文本或模型声明猜测；
- 图片仍必须通过既有 asset 授权、placement、revision、target 与 EditorRuntime invariant；
- `reference` 只用于 Critic 参考图，不是必须放进画板的交付素材。

Inspection hierarchy contract 保留 Image 的 `assetId` 与 `extensions.designRole`；Coordinator 只消费经过该 Contract 解析的当前 revision 投影，不读取 Leafer 私有对象，也不建立第二份文档状态。

### 缺少已声明图片时不调用 Critic

若当前 target 仍缺少任一可放置 raster role：

- capture 与确定性 layout/structure 检查仍保留；
- 不创建 Visual Critic Provider 请求；
- target 保持 `captured`，返回 `nextAction: place-required-raster-assets`、准确的 `pendingRasterRoles` 与 `reviewEligible: false`；
- 模型继续使用现有 `generate_image` / `place_image` 补全初稿，图片事务使旧 capture 失效；
- 图片实际进入当前 target 后重新 capture，才允许一次独立 Critic。

手动提交 Review 也复用同一门禁，并返回现有 `material_write_required` 恢复类型，不增加新的工具、错误分类或字符串特判。

## 后果

- 真实素材型任务不再审查一个已知未完成的半成品，减少一次无意义的视觉模型往返和随后的错误恢复；
- 首个可编辑 revision 与首张 capture 仍可尽早出现，图片生成失败时也保留已提交画布，而不是回滚到零内容；
- 该变更只修正执行顺序，不证明图片构图、素材选择或最终审美已经达标；最终质量仍由 exact-revision Critic 和固定样张盲评负责；
- Plan 当前仍以 delivery 级 `rasterAssetRoles` 表达素材策略；若未来同一 Plan 的不同 target 需要不同素材角色，应单独演进为明确的 target-role 关系，不能靠图层名称或自由文本推断。

## 验证

- 夏令营首稿声明 `hero` 但未放置图片时，capture 返回待放置角色且不生成 Critic context；
- 尝试手动 Review 返回 `material_write_required`；
- 当前 target 出现带 `designRole: hero` 的真实 Image 后，exact-revision capture 才获得 Critic context；
- 无 raster role 的 UI、existing-artboard 和非 UI skill 绑定流程保持原行为；
- Coordinator、inspection hierarchy、capture/review handler 定向测试及 Desktop 类型检查通过。
