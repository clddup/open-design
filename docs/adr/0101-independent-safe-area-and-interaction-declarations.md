# ADR-0101：安全区前景与交互命中区独立声明

- 状态：Accepted
- 日期：2026-08-19
- Design Plan：`1`
- Layout Quality：`DesignLayoutQualityReport 5`
- 文档协议：不变
- 取代：ADR-0096 中 `interactiveNodeIds` 必须是 `safeAreaNodeIds` 子集的要求

## 背景

Provider schema 把 `safeAreaNodeIds` 描述为需要留在安全区内的前景内容，把 `interactiveNodeIds` 描述为真实命中区，却没有公开“交互节点必须在两个数组中重复声明”的跨字段约束。生产运行因此出现 schema 合法、运行时仍拒绝的首切片：Provider 连续重试仍只能收到通用参数错误，画布没有任何 revision。

两个数组代表不同质量关注点。强制重复 ID 增加 token、制造隐藏约束，也不能增加确定性；可信宿主可以直接对二者并集执行安全区检查。

## 决策

- `safeAreaNodeIds` 与 `interactiveNodeIds` 分别保持有界、唯一和稳定 ID 校验，不再要求子集关系。
- Layout Quality 对两组 ID 的并集执行存在性、祖先、可见性和安全区 containment 检查；同一 ID 只检查一次。
- 最小命中尺寸、交互重叠与完全遮挡仍只应用于 `interactiveNodeIds`。
- Provider schema 明确说明无需把交互 ID 复制进安全区数组。compact first-slice 的 `safeNodeIds` / `hitNodeIds` 使用同一语义并编译到正式 Plan。
- 不增加兼容分支或第二套质量 profile；这是现有字段语义的破坏性修正。

## 后果

- Provider 按公开 schema 分别声明页面前景与控件命中区即可进入首笔真实写入。
- 交互节点不会因独立声明而逃过安全区检查。
- quality profile equality 仍分别比较两个集合，因此 amendment 与恢复可以区分“前景策略变化”和“交互策略变化”。

## 验证

- contract 与 desktop schema 测试接受不在 `safeAreaNodeIds` 中的独立交互 ID；
- compact first-slice 回归证明独立 `safeNodeIds` / `hitNodeIds` 能编译为有效 Plan；
- EditorRuntime 回归证明只在 `interactiveNodeIds` 声明的命中区仍同时触发安全区和最小尺寸错误，且节点计数按并集去重。
