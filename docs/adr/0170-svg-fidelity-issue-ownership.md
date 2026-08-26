# ADR-0170：SVG Fidelity Issue 所有权

## 状态

已接受。

## 背景

`svg-issues.ts` 已定义公开 issue code、结构和边界 validator，但 Parse、Normalize、Appearance 与聚合 `svg.ts` 仍各自创建相同形状的对象，聚合文件还私有维护 error 检测和 unsupported attribute 扫描。

这使“结构化 fidelity report 是唯一错误事实”只停留在类型层。新增字段或错误分类时仍可能出现 family 之间的对象形状、severity 或上下文差异，也会诱导调用方重新解析 message。

## 决策

1. `svg-issues.ts` 是 SVG fidelity issue 的唯一结构 owner，同时提供：
   - `createSvgIssue()` 创建稳定 code/severity/message/context；
   - `svgIssuesHaveErrors()` 判断阻塞错误；
   - `reportUnsupportedSvgElementAttributes()` 报告事件属性与 unresolved class selector；
   - `isSvgInterchangeIssue()` 继续作为跨进程边界 validator。
2. Parse、Normalize、Appearance 与聚合 orchestration 全部使用同一 issue factory，不保留局部 factory 或手写 issue object。
3. Mask/Clip、Filter、Text、Vector 等既有 family 继续拥有各自领域判定，但返回同一公开 issue 结构；unsupported attribute 扫描不重复 Mask policy。
4. Failure result 的 SVG version 包装仍由公开 import/export orchestration 负责；fidelity owner 不依赖版本常量，也不创建第二种 Result。
5. 不改变公开 issue code、severity、message、验证上限、错误/警告阻塞语义或 Agent/Main 可见结果。

## 结果

- SVG 所有主 family 使用同一 issue 创建和 error classification 入口。
- `svg.ts` 不再私有维护 fidelity factory、error scan 或 attribute reporter。
- Timeline/Main/Agent 可以继续只依赖稳定结构，而不解析 message。
- Phase 9 的 fidelity family 收口完成；完整 root serialization 与剩余 orchestration 仍未完成。

## 验证

- 独立测试覆盖 issue 创建、边界 validator、warning/error classification 与 unsupported attribute 报告。
- Parse、Normalize、Appearance 和完整 SVG 回归验证既有 code、severity 与失败结果不变。
- Import/export package typecheck、定向 ESLint、Prettier 与 Desktop build 通过。
