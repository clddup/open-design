# ADR-0213：Agent Request、Event 与 Timeline 独立 Owner

## 状态

已接受。

## 背景

ADR-0211 与 ADR-0212 已统一 Initial Inspection、Agent Request 解析入口和跨进程 Tool Wire，但 `@opendesign/agent-contracts/src/index.ts` 仍同时定义附件、模型选择、Request、Event、Durable Timeline 与 Session Timeline，超过 1100 行。Agent Request 还复制了一份 Model Selection Schema，与 `@opendesign/model-gateway` 的权威 Provider wire 结构并存；两者的 provider/model ID 约束已经漂移。

## 决策

1. `agent-request.ts` 唯一拥有 Agent attachment、Model Context、generation mode、delivery scope review 与 Request Schema/Contract；Request union 按 `type` 选择真实分支，Attachment union 按内容寻址 ID family 选择真实分支。
2. Agent Request 直接复用并重新导出 `@opendesign/model-gateway` 的 `ModelSelectionSchema` 与 `ResolvedModelIdentitySchema`，不再维护 Agent 私有副本。Model Gateway 的 canonical selection 在 owner 处要求非空 `modelId`。
3. `agent-timeline-schema.ts` 唯一拥有 assistant block、Session Timeline 与 Durable Timeline wire schema；`agent-timeline.ts` 唯一拥有 selection、run failure、compacted range 与 workflow failure refinement。
4. `agent-event.ts` 唯一拥有 Agent Event schema、按 `type` 的 branch selection、failure/history correlation 和窄 identity 提取。
5. 根 `index.ts` 只保留稳定公共 re-export、协议常量与 JSON-RPC 通用类型；不保留 schema、normalizer、validator 或 domain refinement 实现。
6. 现有公共导入路径继续由同一 package 根导出，但没有旧 schema 副本、双 parse 或兼容 fallback。

## 结果

- Agent Contracts 根入口从 1194 行收缩为约 57 行；所有新增 owner 与测试文件均低于 500 行。
- Model Selection 在 Provider 配置、Model Gateway、Agent Request、durable history 与 Agent Event 中使用同一 schema 对象。
- Attachment mime/ID family、Request revision/scope、Event union、Timeline selection/failure/compaction 的错误继续返回准确 code/path。
- 本切片只收口 Agent wire owner，不声称 DesignDocument/transaction 最终迁移或双平台产品 smoke 已完成。
- 不增加产品版本、内容 hash、源码/fixture 数量门禁或旧数据迁移。

## 验证

- Model Selection schema identity与非空 model ID；
- Image/document/SVG attachment family、mime、大小与未知字段；
- Run start、continuation、Initial Inspection revision、Page scope 与 Model Context；
- Durable Event、Session Timeline、Agent Event union 和跨字段 domain issue；
- Agent Contracts、Model Gateway、Agent Runtime、Desktop typecheck 与相关 owner tests；
- Desktop production build。
