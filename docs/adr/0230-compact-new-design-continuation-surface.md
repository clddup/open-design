# ADR-0230：新建设计续接阶段保持紧凑 Provider 工具面

## 状态

已接受。

## 背景

`ModelToolDisclosurePhase` 已经区分 bootstrap、host-inspected、inspected、continuation 和 expanded，但 continuation 在生成 Provider 定义时被错误地强制使用 `general` surface。于是一个新建设计在首次真实材料 revision 之后，会从首轮的紧凑工具面直接暴露几乎完整的专业 catalog。模型此时本来只需要继续当前 target、捕获检查、执行 checkpoint、补充图片或组件，却同时看到矢量、字体、富文本、图片编辑、页面生命周期和导入导出等互斥入口，增加工具选择和参数错误概率。

这不是删除内部能力，也不是按总工具数量设置门禁。已有服务、事务、权限和完整 Runtime validator 仍保留；需要既有设计重构、显式 Page 生命周期或高级资产编辑的 Run 仍进入 `general` surface。

## 决策

1. `continuation` 继续使用当前 Run 的 `ModelToolSurface`；只有 `expanded` 才强制使用 `general` surface。
2. 新建设计的 continuation surface 只披露当前阶段必要的公共入口：真实首稿/下一个 target、inspect、capture、图片读取/生成/放置、统一普通设计编辑和设计系统管理。`checkpoint` 保持为 general Run 的组合入口，因为它嵌套完整 Apply schema，会把大体积互斥参数重新带回模型上下文；新建设计用普通编辑后再 capture 完成同一条可信链路。
3. Vector、Text Range、Font、Image Update/Edit、SVG Import/Export、Raster Export、Page access/lifecycle、Capabilities 和 legacy Visual Review 不进入新建设计 continuation；它们仍存在于完整 catalog，并在 general Run 或明确的后续编辑 Run 中可用。
4. `surfaces` 只控制 Provider 看到的定义，不改变执行注册、权限、schema、Main 路由、EditorRuntime 事务或历史事实。未声明 `surfaces` 的工具保持 general-only，避免隐式把高级能力带入紧凑流程。
5. 不以“必须是 X 个工具”、schema hash、源码数量或 fixture 数量作为质量门禁。验证只证明阶段语义：当前阶段入口存在，高级互斥入口未被无条件披露；真实 Provider turn、首个 revision 时间和历史修改成功率继续用打包产品样本评估。

## 结果

- 新建设计在首稿之后不再因为 `continuation → general` 的实现错误一次性看到完整专业工具面；当前静态 catalog 审计从 21 个 continuation 定义收敛到 8 个阶段相关定义，且移除了包含完整 Apply schema 的 checkpoint。
- 普通已有设计 Run 不变，仍可在材料 revision 后使用完整专业 catalog。
- 内部工具数量、模块 owner 和执行语义不变，不新增兼容 alias、第二份文档状态或模型往返。
- 若新建设计确实需要高级矢量、字体、导出或页面操作，应通过明确的后续编辑意图进入 general surface，而不是把所有能力预先塞进首个 Run。普通编辑与 capture 仍可在当前 Run 内完成；checkpoint 只在 general Run 中可见。

## 验证

- `packages/agent-runtime/src/tool-disclosure.test.ts` 验证 continuation 尊重 surface；
- `packages/agent-runtime/src/pi-tool-adapter.test.ts` 验证真实 revision 后保留下一 compact stage；
- `apps/desktop/src/shared/design-agent-tool-aggregation.test.ts` 验证生产 catalog 的新建设计 continuation 入口与高级入口分离；
- Agent Runtime typecheck、Agent Runtime disclosure/Pi 回归与 Desktop catalog 回归通过。
