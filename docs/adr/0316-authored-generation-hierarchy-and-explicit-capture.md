# ADR-0316：生成只维护作者层级，审核由显式 capture 触发

- 状态：Accepted
- 日期：2026-09-08
- 关联：ADR-0310、ADR-0315

## 问题

ADR-0315 的内部 handler 已允许连续材料写入，但生产 Main 分发入口仍把生成与 capture/独立审核串成一个工具调用。首次写入后，模型尚未决定实现已经就绪，宿主就提前推进审核；审核不可用还会使已经提交的生成调用返回失败。

模型同时编写区域列表和元素父子树也是重复事实源。区域容器由 Main 预建、绑定和重写，既增加参数错误，又可能改变 Group 类型、兄弟顺序与后续编辑语义。仅删除公开区域字段并从元素中反推区域，仍保留了这些问题和隐藏的区域数量限制。

## 决策

1. `opendesign_generate_design` 只生成、授权并原子提交一个有意义的材料批次，立即返回真实 revision。生产分发器不隐式 capture、不等待 Critic，也不合成模型未请求的工具调用。
2. 模型只提交一份按父节点在前排列的元素树。顶层元素省略 `parentId`，Main 绑定画板身份；嵌套元素引用此前声明的 Frame/Group。不推导区域列表，不添加透明内容根，不更改作者的 Group、Frame、外观和顺序。
3. 新生成的内部 Plan 使用空 `composition.regions`。Plan 继续保存目标和执行证据，不能拥有第二份设计层级。历史已保存 Plan 的区域记录继续按既有格式读取，本次不重写用户文件、历史 revision 或旧会话记录，也不新增旧生成工具入口。
4. 元素类型分支是字段、必填项和未知字段规则的事实源；模型和内部结构从同一组分支派生。元素父子关系在 Contract refinement 中校验，错误指向原始 `/designGeneration/elements/<index>/parentId`。生成 refinement 与 Main 共用同一可见材料判定，空容器、透明内容和零宽描边不会先通过 Contract 再被宿主拒绝。Main 继续校验当前目标、权限和 revision，EditorRuntime 保证事务原子性。
5. 元素上限为共享事务上限减一，只为真实画板分配预留一条操作。没有区域配额，也没有宿主额外注入的容器操作。
6. capture 仍是显式的实现/审核边界。独立审核不可用时遵循 ADR-0310：当前 capture/Run 返回结构化终态失败，保留已经成功的生成工具结果、画布和截图；未完成的审核步骤不变绿，不用“允许完成”绕过账本。下一条消息可继续同一 Conversation。

## 版本与迁移

Main 绑定后的生成输入版本从 1 升为 2，移除内部 `targets[].regions`；模型输入不携带此宿主版本。Provider 始终取得当前 Contract 投影，旧区域字段按未知字段返回结构化错误，不静默修复或重放旧生成请求。历史工具消息保留为 Conversation 事实，不作为新版可执行输入重新解析。

DesignDocument、DesignTransaction、Agent IPC 以及已持久化 Plan 的版本保持不变；Plan 的区域列表允许为空，旧非空列表继续合法。这是生成入口的收敛，不代表所有历史 Plan 区域机制或整个 Agent 契约链已经完成迁移。

## 验证

自动化覆盖平铺图形、混合顶层 Group/形状、超过原区域配额的结构、前向/自身/非容器父引用、共享事务预算及 Provider/Runtime 一致性。真实 Main→Renderer 工具执行→EditorRuntime 回归验证同一 revision 原子提交、类型和顺序保留、后续编辑及逐批撤销。Runtime 回归验证生成成功事件先于显式 capture，审核失败不重放写入、不污染下一条消息；完成门禁仍拒绝未完成账本。

以上证明执行语义，不能替代真实 Provider 生成样张的耗时、视觉盲评及 macOS/Windows 原生产品验收。
