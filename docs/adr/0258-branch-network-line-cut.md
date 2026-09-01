# ADR-0258：Branch Vector Network 拖拽 Line Cut

## 状态

接受。

## 背景

既有有限线 Cut 已能处理开放多交点、闭合区域、孔洞和凹形 component，但入口仍以整网 `topologyEditable` 拒绝 connected/branch network。直接删除门禁并按 path traversal 分配结果会破坏 shared junction：未被切中的 branch path 可能留在 retained layer，而与它共享 junction 的 path piece 已进入 extracted layer，两个输出会各自复制同名 vertex 并丢失真实连接关系。

## 决策

1. Geometry Service contract 26 允许所有 schema-valid、point-editable Vector Network 进入有限线 Cut；模型、Canvas 与 Runtime 继续复用既有 `cut-with-line` / `cut-layers-with-line`，不新增细碎工具。
2. 每个明确 path 仍使用既有 line/cubic transverse crossing、开放 path 分片和闭合 region boundary 重建算法。切线恰好穿过被多个 path 共享的 junction 时失败关闭，要求切过明确 incident edges，不猜测 junction 的多边归属。
3. 分片完成后按两类关系重新计算最终 path component：共享 vertex 连接，以及同一 region 的 loop 归属。未切中的 branch、hole 或其他 path 必须跟随其真实连接 component，不能按原始 path ID 单独留在另一输出。
4. 每个源 connectivity group 独立确定 retained side。包含该 group 首个稳定 retained partition 的一侧继续保留源层；相反侧的完整 connected components 进入同一个 extracted sibling。一个 component 同时跨越切线两侧时结构化拒绝，不静默断开或复制连接。
5. EditorRuntime 继续负责 tight bounds、transform offset、稳定 sibling 顺序、preview/apply、单 revision 与单 undo。Leafer 的 Cut guide 保持 session-only，并对所有可写 Vector edit session 提交同一 document-space 切线；Geometry/Runtime 决定具体 topology 是否可执行。
6. Conversation 是持续 Agent 上下文，Run 只承载本轮执行。一次 branch Cut 的失败、取消或 Provider 异常不得限制下一条消息重新检查当前 Design File 并继续编辑已提交 network。

## 结果

- branch arm 被切开时，未命中的 trunk/branch 会随实际 junction component 一起移动，不再产生跨 layer 的同名孤立 junction。
- closed region 上附着的开放 branch 会跟随包含 attachment vertex 的 divided region。
- 人工与 Agent 共用同一稳定文档事实、结果层创建和恢复语义。
- shared-junction exact hit、切后仍跨越切线的绕行 component、nested/overlapping region 和 self-intersection 继续显式失败；它们不能通过复制 vertex 或丢弃连接来伪装成功。

## 验证

- Geometry：反向 traversal branch、closed attachment、shared-junction exact hit、point editability 与输出 invariant。
- EditorRuntime：branch source/result sibling、tight bounds、单 revision/undo 与 junction degree 保留。
- Leafer：`topologyEditable=false` 的 branch session 仍可提交 drag Cut，read-only session 继续排除。
