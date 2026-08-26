# ADR-0161：统一 Provider 直接设计编辑工具

## 状态

已接受。

## 背景

生产 Provider 过去必须在 `opendesign_apply_transaction`、`opendesign_edit_hierarchy` 与 `opendesign_arrange_layers` 之间预先选择。普通设计重构经常同时包含节点属性、层级与布局语义，互斥工具面迫使模型拆成多个调用和 Provider 回合，也会把“选错工具”误报为设计数据错误。内部 planner 与 EditorRuntime 本身并不要求这些操作成为三个 Provider 工具。

## 决策

Provider 只看到 `opendesign_edit_design` 这一直接编辑入口：

1. 一次调用包含 `1..16` 个有序 edit；每个 edit 以外层 `kind=node | hierarchy | arrange` 进入现有权威 Contract。
2. 一次调用至多包含一个 node edit；同一批普通节点 command 应先合并，避免把一项用户操作机械拆碎。
3. hierarchy 与 arrange 继续复用现有 Figma 式 planner、领域校验和稳定 ID，不把 planner 逻辑复制进统一契约。
4. Renderer 每加入一个 edit 后，通过 `EditorRuntime.previewProjectedDocument()` 使用与正式事务相同的 command、Text 与 Auto Layout 流水线生成只读投影；后续 planner 基于该投影继续计算。
5. 完整 command set 最终只执行一次正式 `runtime.apply`，产生一个 revision 和一个 undo step。投影不修改 document、history、selection 或持久化状态。
6. 同一调用只能修改一个 delivery artboard。planned insert 需要基于纯 Frame 平移 rebase 时必须单独执行，不能与依赖旧结构的 hierarchy/arrange 混合。
7. bootstrap 仍只公开紧凑 node edit；材料 revision 后，同一个工具名扩展 hierarchy/arrange schema，不切换工具身份。
8. Component、Style、Variable、Vector、Typography、Image、Page 与 Export 暂时保留专用工具。是否继续合并必须依据真实 Provider turn、错误工具选择率、首次 revision 时间和重构成功率判断。
9. 产品尚未发布，不保留三个旧 Provider 工具的兼容注册或 Main 分发。first-slice、Plan allocation 与 Checkpoint 的宿主组合继续调用明确标记的 internal apply，不对 Provider 暴露。

## 结果

- Provider 公开工具从 28 个降为 25 个，普通节点、层级和布局编辑不再竞争三个入口。
- 一项跨层级/布局的用户操作可以原子提交，不产生中间无效 revision。
- 内部 service、planner、Contract 与测试仍按职责分离，统一的是 Provider 任务入口而不是把实现写成巨型 switch。
- expanded schema 约 96 KB，工具数量下降不等于协议字节同比下降；bootstrap schema 仍保持紧凑。后续不能直接把所有专业工具继续塞进该 union。
- 错误路径以 `/edits/{index}/input/...` 定位到真实 edit 分支；Main 权限、delivery 与 revision guard 仍在原边界执行。

## 验证

- node → hierarchy → arrange 的依赖链逐步投影后一次提交，revision 只增加 1，undo 只需一次。
- 跨 delivery artboard、多个 node edit、非法嵌套字段和不安全 rebase 在正式写入前失败。
- Provider catalog 与 Pi model tools 包含 `opendesign_edit_design`，不包含三个旧工具。
- internal apply 仍支持 first-slice、Plan allocation 与 Checkpoint，不进入 Provider catalog。
