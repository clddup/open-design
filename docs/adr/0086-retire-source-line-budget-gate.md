# ADR-0086：退休源码行数预算门禁

- 状态：Accepted
- 日期：2026-08-15
- 取代：ADR-0046 中“默认 800 行与历史逐文件只减不增预算”部分

## 背景

ADR-0046 用源码行数作为模块增长报警器，同时明确真正治理单元是完整业务职责。后续连续垂直切片表明，这个代理指标需要在合法功能提交中反复抬高历史文件预算，无法区分职责耦合、声明式 schema、平台编排和测试支持代码。它还多次让 macOS/Windows workflow 在 lint、typecheck、test 和原生 package 之前共同失败；更新数字不会提高产品或架构质量。

## 决策

`pnpm architecture:check` 保留并继续阻塞以下真实边界：

- Electron Main、Preload、Agent、Shared 与 Renderer 的禁止跨层导入和 builtin 能力；
- 全部 `@opendesign/*` 生产依赖的显式机器基线；
- workspace 生产依赖无环。

删除默认 800 行限制和历史逐文件行数清单，不再在 CI 输出 package/module budget 计数。模块拆分继续按 ADR-0046 的完整业务所有权执行，必须一起迁移状态、异步生命周期、取消、错误恢复和测试；代码评审与 roadmap 负责确认职责收缩，不能以重导出壳、生成文件或互相回调的碎片冒充治理。

改变 workspace 依赖仍必须在所属能力 ADR 中解释并同步机器基线。本次同步 rich-text 既有事实：`@opendesign/figma-interop` 与 `@opendesign/import-export-service` 单向依赖纯函数 `@opendesign/text-service`，复用同一 UTF-16 段落边界与列表语义；核心 Contracts、Runtime 和 Renderer 不反向依赖 adapter，DAG 保持无环。

## 后果

Actions 会更早到达能证明产品可交付性的 lint、类型、测试、构建和双平台 package/smoke。超大聚合模块仍是 roadmap 中的明确技术债，退休噪声指标不表示这些模块已经完成治理。

## 验证

- `pnpm architecture:check`
- 对机器基线制造缺失依赖和循环时，检查必须失败
- macOS/Windows Native desktop workflow 继续执行共享验证、原生 package、内容校验和 packaged Agent smoke
