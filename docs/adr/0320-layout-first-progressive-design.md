# ADR-0320：由 Agent 判断渐进设计的批次边界

- 状态：Proposed（本地实现候选，讨论中）
- 日期：2026-09-09
- 关联：ADR-0316、ADR-0318
- 取代首批必须已有完整实质内容、UI 首次可见 revision 必须完成视觉细节的要求。

## 提案

渐进式的目标是尽早呈现足以判断方向的成果，不固定设计工序。模型根据任务选择整体布局、代表性区域或完整简单设计作为初始批次。整体布局可用具有名称、位置、比例和可见外观的模块 Frame 表达；当只有框架不足以判断风格时，可先做出有代表性的内容。每批工具调用返回后立即形成真实 revision，模型可在同一 Run 继续普通编辑、细化已有模块或回头调整整体结构，无需用户额外发送继续。框架先行和逐模块设计都是可选方式，不是强制流程。

生成契约和 Main 的首次写入检查共用可见进展判断，允许带可见填充或边框的 Frame；隐形节点和完全空白的画板不冒充可见进展。最终实质内容判断保持原规则，Frame 框架不会自动获得已完成或已验证状态。若图片直接决定当前批次的设计方向，模型可先取得图片；否则可先提交有价值的布局。预留区域不能冒充完成的素材，Logo 每个方向的空 master Frame 也不能通过最终实质内容检查。

不增加工作流阶段、模型 Plan 字段、固定模块数量、宿主消息分类或强制重试。批次与模块次序由模型根据设计判断，每批继续复用唯一事务、revision、撤销和渲染路径。内置设计指导保留模型对顺序与批次的判断，最终视觉与可用性标准不降低。

## 验证

真实 Main → Renderer 工具 → EditorRuntime 回归首先只创建三个可见模块 Frame，确认第一份 revision 已存在而模块内容为空、Plan 仍在实现且未 verified；后续三次编辑分别填充模块，模块 ID 和其他区域位置保持稳定，每次都产生独立 revision，并能逐次撤回到框架和初始空画布。

使用单 worker 定向测试、Desktop 类型检查与变更文件静态检查；不运行全量测试或启动 Electron。本次证明工具链支持框架先行，不把提示词约束当成所有真实模型都会遵循的保证，也不宣称已经测得首屏耗时改善。

本地候选验证（2026-09-09）：

```sh
pnpm --filter @opendesign/desktop exec vitest run src/main/agent/progressive-design-layout.integration.test.ts src/main/agent/design-inspection.test.ts src/shared/design-generation-tool.test.ts src/agent/system-prompt.test.ts --maxWorkers=1
pnpm exec vitest run packages/design-skills/src/index.test.ts --maxWorkers=1
pnpm exec eslint --max-warnings=0 apps/desktop/src/agent/system-prompt.ts apps/desktop/src/shared/design-agent-tool-catalog.ts apps/desktop/src/shared/design-generation-tool-schema.ts
git diff --check
```

上述定向测试共 51 项通过；执行链回归证明允许框架先落地，不代表模型必须选择该顺序。

## 本地实现状态

已按本提案落地的实现：

- 生成契约的批次判定改为可见进展：`isVisibleDesignProgress` 允许带可见填充或描边的 Frame，仍拒绝隐形、透明、零尺寸和零宽描边节点。`design-generation-refinement` 与 Main 首次写入门禁（`assertInitialArtboardProgress`）共用该判定。
- 最终交付判定不放宽：capture 的交付结构校验与 Logo master 校验仍要求真实内容层，只有 Frame/Group 容器时分别返回 `delivery_structure_incomplete` 与 `logo_exploration_incomplete`，并给出填充现有模块、保留已提交 ID 的恢复动作。
- 子树内容判定收敛为 `@/shared/design-material` 的唯一 `subtreeHasContentLayer`，删除 `design-inspection` 与 `design-plan-registration` 中两份等价实现。
- Provider 可见的执行策略、生成工具 schema、工具目录描述以及 ui-ux-structure、ui-visual-direction、graphic-visual-direction、logo-visual-direction 四个 skill 已改为由模型判断批次边界，不强制框架先行。

已知边界与未验证项：

- Frame 先行是可用方式而不是保证；真实 Provider 是否会选择该顺序、是否改善首个可用 revision 时延均未测量。
- `instance` 与 `slice` 仍不计为可见进展；`subtreeHasContentLayer` 仍按节点 kind 判断，不检查可见性。
- 既有画板恢复（`recoverDeliveryTarget`）继续使用内容层判定，本次未改为可见进展语义。
- 未启动 Electron，未做 macOS/Windows 产品验收，也没有真实模型样张的时延与审美证据。

复验（2026-09-22）：

```sh
pnpm --filter @opendesign/desktop exec vitest run --maxWorkers=1
pnpm exec vitest run packages/design-skills/src/index.test.ts --maxWorkers=1
pnpm --filter @opendesign/desktop exec tsc --noEmit
pnpm exec prettier --check <changed files>
pnpm exec eslint --max-warnings=0 apps/desktop/src/main/agent/design-inspection.ts apps/desktop/src/main/agent/design-plan-registration.ts apps/desktop/src/shared/design-material.ts apps/desktop/src/shared/design-material.test.ts apps/desktop/src/shared/design-generation-hierarchy.test.ts apps/desktop/src/main/agent/global-task-coordinator.ts apps/desktop/src/shared/design-generation-refinement.ts apps/desktop/src/agent/system-prompt.ts
git diff --check
```

结果：桌面包 224 个测试文件、1656 项通过；design-skills 5 项通过；类型检查、格式检查、静态检查与 diff 检查无错误。此前按 ADR 原记录执行的定向集合（51 项）与新增 `design-material.test.ts`（10 项）也分别通过。`design-generation-hierarchy.test.ts` 中原先断言“裸 Frame 被拒”的用例已按本提案改为：无填充 Frame 仍被拒，带可见填充的模块 Frame 通过契约解析。
