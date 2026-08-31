# ADR-0233：首切片使用真实材料身份并诚实验收视觉结果

- 状态：Accepted
- 日期：2026-08-31
- DesignDocument：不变
- Agent 协议：不变
- 关联：ADR-0098、ADR-0117、ADR-0119、ADR-0127、ADR-0143、ADR-0147、ADR-0230

## 背景

生产日志显示，首个真实 revision 经常不是慢在文档事务，而是慢在模型被要求同时维护两套节点身份：`firstSlice.elements` 创建真实 Frame/Group/Layer，`semanticObjects` 又为同一语义预声明未来 Main、Instance 或 ordinary occurrence。Runtime 随后既禁止 occurrence 复用真实元素 ID，又要求组件检查能够在文档中找到这些身份，导致 `semantic_occurrence_reuses_node_id`、父节点不可用和无 revision 重试。Logo exploration 也把计划 Region 当作概念 root，再要求证据对应真实设计材料，形成相同的计划身份与文档身份混用。

Figma 的 Component authoring 以现有节点为事实：先有真实 Frame、Group 或其他节点，再通过 `createComponentFromNode` 提升为 Component，并从 Main 创建 linked Instance。计划可以决定“这里应复用”，但不需要在绘制前制造一套与文档节点平行的 occurrence 身份。

独立视觉 Critic 的另一条旧规则要求第一张 capture 必须暴露至少两个失败项。即使 exact-revision 截图已达到全部阈值，宿主仍把最低两项伪装成 `failedCriteria`，强制作者执行一次无证据 refinement。该规则增加 Provider、写入和 capture 往返，却没有提高视觉质量，也让用户看到长时间无意义的“修正中”。

## 决策

### 首切片只创建真实命名层级

`opendesign_generate_first_slice` 不再接收 `semanticObjects`。模型只提交当前滚动 target 的真实 `firstSlice.elements`，并使用有意义的 Frame/Group/Layer 名称和稳定节点 ID。Main 为该首切片编译空的 `componentStrategy`；首个材料 revision 成功后，Agent 从 exact-revision inspection 判断：

- 已有 Design File Component 能承担相同语义时，创建指向该 Main 的 linked Instance；
- 当前真实 Frame/Group 具有稳定复用价值时，通过统一 Design System 工具将该节点提升为 Component Main，再创建 Instance；
- 一次性 wrapper、装饰或内容块保持普通 Frame/Group。

普通完整 Plan 仍可表达组件复用决策，但 occurrence 必须对应当前真实节点或后续明确创建的真实节点，不能成为平行文档身份。组件判断继续受当前 Page、Mutation Target、revision、Component Service 与唯一 EditorRuntime 约束。

### Logo 探索引用真实材料

当请求三方向 Logo exploration 时，每个 `rootNodeId` 必须是同一次 `firstSlice` 中实际创建的 Frame/Group；四个 `evidenceNodeIds` 必须是该 root 下真实后代，并按 monochrome、32 px、24 px、16 px 排列。计划 Region 只作为宿主创建的父容器，不再冒充概念根或缩放证据。

每个方向在首切片中必须已有可编辑材料。结构失败返回 `first_slice.logo_root_not_materialized` 或 `first_slice.logo_evidence_not_materialized` 的准确字段路径，不再用隐藏的“root 必须是 Region”关系让模型猜测。

### Critic 按真实结果裁决

独立 Critic 继续检查相同 exact-revision 截图、非补偿阈值和确定性结构门禁，但不再预设第一稿必须失败：

- 所有必需 criterion 达标且平均分达标时，当前 target 可从 `drafted/captured` 直接进入 `verified`；
- 未达标时，只返回真实失败项和可执行 refinement，继续原有修正、重新 capture 与验收路径；
- 通过结果不生成伪造的 `failedCriteria`、refinement 或 legacy `lastReview`；
- exact-revision inspection、Layout Quality Report 与组件结构检查仍是直接通过的必要条件。

这不是取消视觉审查，也不是“首稿免检”。它只取消为满足流程而制造缺陷和无意义改稿。

## 取代关系

- 取代 ADR-0147 中 first-slice 直接提交 `semanticObjects`，以及代表 UI 首稿无条件进入 refinement 的部分；视觉方向、真实首稿和代表 target 独立 Critic 保留。
- 取代 ADR-0117 中 Draft 必须至少返回两条 refinement、Draft scorecard 必然进入 refinement 的部分；无作者上下文、exact revision、宿主阈值与失败后的 refinement 保留。
- 澄清 ADR-0119：compact first-slice 不声明未来 Instance occurrence；只有真实首稿落地后，才可复用 catalog Main 或从 inspected node 提升 Main。

## 后果

- 删除一个高频且自相矛盾的首轮事实源，减少完整 Provider 重试和零 revision 等待。
- 首稿真实达标时省去一次作者 refinement 和一次 capture；首稿不达标时耗时与质量门禁不降低。
- 组件质量来自真实层级、Main/Instance 关系和最终 inspection，不来自绘制前的声明数量。
- 本决策不保证任意模型自动获得优秀审美，也不把静态测试冒充真实 T1 或盲评。仍需用打包产品 Run 记录首次 revision 时间、first-slice 成功率、同 fingerprint 重试和最终样张质量。

## 验证

- Provider first-slice Schema 不再暴露 `semanticObjects`，旧平行 payload 在准确路径失败；
- first-slice compiler 生成空 `componentStrategy`，后续组件化只消费真实 inspection 节点；
- Logo 三方向 root/evidence 均必须来自同次真实 element hierarchy，Region ID 或非后代被拒绝；
- Critic pass 不生成伪失败 review，并在 exact-revision 布局与结构 clean 时直接 verified；
- Critic fail 仍保存真实 review、进入 refinement，并在新 revision 上重新 capture；
- Desktop/Design Skills 类型检查、相关 Contract/Coordinator/Critic 测试与普通 desktop build 通过。

## 参考

- Figma `createComponentFromNode`：<https://developers.figma.com/docs/plugins/api/properties/figma-createcomponentfromnode/>
- Figma `ComponentNode`：<https://developers.figma.com/docs/plugins/api/ComponentNode/>
