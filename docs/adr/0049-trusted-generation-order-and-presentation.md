# ADR-0049：可信生成顺序、画布 chrome 与真实过程投影

- 状态：已接受
- 日期：2026-08-13
- 文档协议：不变（`DesignDocument 1.11.0`）
- Agent 协议：不变（3.8）
- 取代：ADR-0028 的 accepted-plan skeleton 与固定 100ms 阶段延迟
- 关联：ADR-0018、ADR-0028、ADR-0047

## 背景

生产截图与本机诊断暴露了三种不可信体验：Run 的“正在处理设计”排在触发它的用户消息之前；Leafer 全局 hover box 在复杂画面上表现为不完整的灰色方框；accepted plan 的紫色 skeleton 长时间占据画布，但它不进入文档、revision 或 history，且可能与真正提交到另一位置的设计同时存在。

两条 macOS 打包产品单 target 样本还证明固定 progressive delay 是真实成本而非推测：Renderer 每 Run 7 次工具总计约 3.8–4.0 秒，其中配置的固定 delay 累计 1.8–2.1 秒；但端到端 `T1` 为 167.7–201.1 秒，Provider 总时间为 270.0–292.8 秒。固定 delay 不是主要瓶颈，却占 Renderer apply 的显著部分，也没有提供新的设计事实。

## 决策

### 用户意图先于执行状态

新 Run journal 先写 `message.user`，再写 `run.state(started)`；二者继续使用同一原子 sequence allocator。Renderer 对历史 journal 增加同 Run 兼容排序：即使旧数据先保存 run，再保存 user message，也始终把用户消息显示在 Run 活态之前。不同 Run 仍严格按 Run 顺序，其他 tool/message 仍按 durable sequence。

### 普通悬浮不绘制编辑器方框

生产 Leafer Editor 关闭全局 hover chrome。点击选中、选框、edit box、resize/rotate、Vector/Pen overlay 和图层树定位不变；因此状态仍通过选择与直接操作明确表达，但仅移动鼠标不会在设计内容上叠加无来源的灰框。

### accepted plan 不再冒充画布内容

桌面 App 与 Canvas 不再向生产 Leafer sync 输入传递 `generationSkeleton`。Plan 的 target/frame/region 语义、Main 校验、交付账本和 amendment 全部保留；变化仅是删除这层可丢弃紫色展示。

Agent activity/cursor 只有在计划 Frame 已真实存在于权威文档、位于正确 Page root、保持计划尺寸和仅平移 transform 时才可投影。其后位置由真实 Frame 和已提交 revision/reveal focus point决定；计划尚未形成真实 Frame 时，画布保持诚实空态，Timeline 仍显示可信运行状态。

### progressive apply 不再人为减速

合法 progressive stage 之间继续等待两个 animation frame，让浏览器有机会绘制每个真实 revision；默认固定 delay 从 100ms 改为 0。显式测试仍可注入 delay。阶段仍由 `EditorRuntime.preview()` 找到合法前缀、共享一个 history group，并在取消/失败时整体回滚；本决策不放宽事务、撤销或并发语义。

## 结果

- 会话因果顺序稳定，旧 journal 无需迁移。
- 鼠标悬浮不再出现半框；选中和编辑反馈仍在。
- 用户只看到真实文档提交产生的设计/reveal，不再把紫色骨架误认为 Agent 正在绘制。
- Renderer 单 Run 可直接减少实测约 1.8–2.1 秒人为等待；端到端主要瓶颈仍是 Provider 串行 turn，不能把该优化宣传成整体生成已解决。
- 多目标 `allocated` 真实 Frame、T0、首 target 优先和目标级恢复仍是后续独立协议切片。本决策不创建空 Frame，也不把 pending 提升为 drafted。

## 验证

- Pi journal 测试证明新 Run 的首两项为 `message.user → run.state`。
- Timeline 投影测试证明旧 `run.state → message.user` 数据也呈现为 user → run。
- Leafer adapter 配置测试证明 hover 关闭，selected box 配置保持。
- App 测试证明 accepted plan 在真实设计落地前不产生 skeleton/activity；真实 Frame 存在后 activity 可定位。
- Progressive apply 测试继续覆盖多 revision、单次 undo、取消回滚和绘制等待统计。
