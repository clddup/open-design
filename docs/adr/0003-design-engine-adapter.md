# ADR-0003：设计引擎隔离边界

- 状态：被 ADR-0005、ADR-0009、ADR-0141 取代
- 日期：2026-08-07
- 保留：OpenDesign 自有 Design Contracts、事务、查询、能力声明和导入导出边界
- 删除：独立 `DesignEngineAdapter` 文档生命周期门面

## 背景

早期方案希望用一个 `DesignEngineAdapter` 同时承载创建、打开、保存、恢复、事务、撤销、重做、渲染、导出和关闭。后续实现已经证明这会在唯一 `EditorRuntime` 之外形成第二份文档生命周期，并诱导 Agent、MCP 或格式适配器绕过 Workspace/Project resource identity、Main capability 和 revision 约束。

ADR-0005 已确定 OpenDesign 拥有文档、事务、revision、history 和持久化事实；ADR-0009 已确定 Leafer 只是当前 revision 的可丢弃投影。仓库中的 `@opendesign/design-engine`、`@opendesign/mcp-host` 和 `@opendesign/mcp-server` 没有生产调用者，因此不存在需要保留的兼容边界。

## 最终决策

- 删除独立 `DesignEngineAdapter` 及其 `create/open/save/restore/apply/undo/redo/close` 门面，不提供兼容 re-export 或 fallback。
- UI、Agent、导入器和未来 MCP 写入全部进入唯一 `EditorRuntime`/Design Transaction 路径；任何写入都必须携带稳定资源身份、当前 revision 和 Main 已解析的 capability。
- Leafer adapter 只负责场景投影、坐标、命中测试和直接操作，不拥有可持久化文档。
- 未来 MCP 只能由 Main 组合窄 `DesignReadPort` 与 `ToolInvocationPort`：调用方获得稳定 resource handle，不获得任意 `filePath`、原始凭据、Renderer 对象或独立 open/save 生命周期。
- 当前没有生产 MCP 集成时，不保留空 host/server 包占位。真正接入外部 MCP 时再以 Main port、策略、审批、审计和取消链为验收条件建立实现。

## 保留原则

Design Contracts 继续围绕可观察行为定义：稳定节点 ID、Design Transaction、base revision、结构化冲突、预演、原子提交、撤销历史、查询摘要、能力声明和导入导出。高级能力优先扩展通用设计语义，不把第三方引擎对象或私有序列化泄漏到公共契约。

## 验证

- Workspace 中不存在 `@opendesign/design-engine`、`@opendesign/mcp-host` 或 `@opendesign/mcp-server` package。
- 生产 import graph 不包含 `DesignEngineAdapter`、`McpHost` 或 `createReadOnlyDesignTools`。
- `architecture:check` 从实际 manifest 和源码推导 package DAG、公开 exports、未声明/未使用依赖和 Electron 进程边界。
- 唯一可写设计事实仍由 `EditorRuntime` 持有，Main design tools 继续通过同一事务入口执行。
