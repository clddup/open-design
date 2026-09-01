# ADR-0267：设计 skill 高显著注入与证据优先视觉审核

## 状态

已接受。

## 背景

生产登录页在 Plan 中声明避免 HUD 与无意义科技装饰，实际仍生成大面积青绿光柱、弧线和低对比文字。`ui-visual-direction` 与 `ui-capture-critic` 已明确把这类输出列为模板症状，但 planning skill 位于长执行契约之前；独立 Critic 又接收作者生成的 visual thesis、signature motif 与 visualSystem，最终复述“进入核心空间”的故事，为截图中的装饰主导和可读性问题提供了错误合理化。Critic 在列出四项实质 refinement 的同时仍给出平均 4.22 并通过。

继续增加特定图形禁令、按错误文本降分或为每类丑图增加宿主判断都会形成不可维护的审美补丁，也不能提升新题材的设计能力。

## 决策

1. 不新增 Provider 回合、不复制 skill 内容。compact 与 general 生成提示把现有 deliverable-scoped skill bundle 移到执行契约之后，使视觉方向成为工具调用前最后的设计约束。
2. 独立 Critic 的普通视觉证据只包含用户请求、目标、brief fidelity、surface calibration、授权参考图和 exact-revision capture；不再发送作者自述的 visual thesis、signature motif 与 visualSystem。Logo 的明确方向与小尺寸证据继续保留，因为它们本身是用户要求的交付契约。
3. 分数语义固定为：1 不可用、2 重大缺陷、3 连贯但未达到交付、4 无需实质修改即可交付、5 优秀。所有 required criteria 都是非补偿标准，低于 4 即失败，平均分不得覆盖单项缺陷。
4. `refinement` 只表示阻塞交付的实质修改，不承载可选 polish。任一 criterion refinement 或顶层 refinement 存在时，宿主不得同时判定通过。
5. Draft 与 Final 使用同一 readiness 语义。真正达到交付的首稿可以直接通过；失败稿进入既有有界 refinement，不增加仪式性轮次或无限审核循环。

## 结果

- 作者不能再用命名和设计故事替像素缺陷辩护。
- 审核指出“文字低对比、装饰抢夺任务、模板化几何”等实质问题时，状态必然保持未完成。
- 系统仍依赖视觉模型判断开放式审美，不增加按圆、渐变、斜线或某个题材编写的确定性垃圾规则。
- Provider 延迟与工具数量不增加；变化只影响现有提示顺序、Critic 输入证据和宿主通过推导。

## 验证

- 得分为 4 但仍附带实质 refinement 的 verdict 必须失败。
- 无 refinement 且全部 criterion 为 4 的真实首稿可以通过。
- Critic 请求不再包含普通 UI 作者的 designIntent/visualSystem，仍包含用户 brief、校准、参考图和 exact capture。
- 既有 Logo 单方向、多方向、品牌色、App Icon 与 reference-adherence 非补偿测试继续通过。
