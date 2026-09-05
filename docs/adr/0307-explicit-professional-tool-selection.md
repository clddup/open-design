# ADR-0307：专业工具 Schema 显式按需披露

- 状态：Accepted
- 日期：2026-09-06
- 关联：ADR-0302、ADR-0304
- 取代 capability discovery 成功后自动进入全目录 `expanded` 的行为。

## 决策

保留已有 `opendesign_get_capabilities`，不新增意图分类模型或另一套工具。查询增加可选 `tools`：

- 指定工具名：在当前 Run 下一轮 Provider 请求中使用这些工具的完整描述和权威 Schema，替换此前的专业工具选择。
- `tools: []`：回到随真实执行阶段提供的基础工具。
- 省略 `tools`：只查询能力和目录，不改变当前选择。
- 基础工具始终按原有 inspection/continuation 事实提供。模型也可以选择基础工具以取得完整参数面，而不是被简化投影限制。

输入 Schema 的工具名 enum 从同一份真实工具 descriptors 自动派生，不维护第二张名称表，不增加人为数量上限。普通用户消息不参与宿主工具选择。

## 唯一边界

查询从 Agent 本地绕行改为 Main 的统一输入、策略和审计入口。Main 解析同一个 Contract。省略 tools 的信息查询返回既有能力 manifest 与紧凑工具目录；显式选择仅返回 selectedTools 确认及顶层 `modelToolSelection`，不重复整份 manifest。该字段由共享 `TrustedToolResult` Schema 贯穿桥接。

Runtime 仅接收成功 capability-discovery 的结构化 selection，不解析 message 或自由文本推断。失败、取消、只读查询均不覆盖先前选择；不无限累加工具。只披露已经注册的工具，选择 Schema 不授予资源、Page、网络或写入权限，原有审批和执行入口不变。

删掉 `expanded` 阶段与“查询成功即打开全部 Schema”的转换，保留真正的 inspection 与材料写入阶段。选择状态为当前 Run 内的执行事实，不新增持久化用户意图状态。

## 模型上下文

目录只使用实际工具描述的首句；完整描述随被选中的工具定义发送。否则完整 manifest 再叠加全部工具说明会触发原有结果压缩，使模型反而看不到完整目录。此处不提高上下文限制，而是减少重复说明。

## 验证

- 真实工具注册表→Main parser/policy→共享 Bridge→Pi Runtime→下一轮 Provider：选择 vector 后只有对应完整 Schema 被加入，字体等未选专业工具不随之加载，基础 edit 的投影不变。
- 从 Provider 实际收到的 tool message 验证完整目录项都在，而不是只检查请求 enum 中出现了工具名。
- 覆盖更换选择、失败与省略保持、空列表恢复基础、已写入设计后的选择，以及非 discovery 结果无法改变选择。
- 取消前不发送查询，非法/重复名称返回同一 Contract 的字段错误。

自动化证明披露和桥接行为，不证明真实模型的视觉质量或首响应耗时已经达标。
