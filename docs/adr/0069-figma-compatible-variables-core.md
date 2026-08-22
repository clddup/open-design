# ADR-0069：Figma-compatible Variables Core v1

- 状态：已接受
- 日期：2026-08-14
- 文档协议：`DesignDocument 1.26.0`
- Variable Service：contract v1
- Figma compatibility baseline：`@figma/plugin-typings 1.133.0`，commit `83bfe81d9616ab759702f657eb18ef153f83e8ae`
- 关联：ADR-0011、ADR-0015、ADR-0045、ADR-0063～0068

## 背景

文档中的 `tokenCollectionsById/tokensById` 只是无类型 JSON 占位，没有 collection、mode、alias、scope、binding、解析或 UI/Agent 行为。继续在占位 map 上增加字段会让 Variables、Design Tokens、Library 与导入导出形成互不兼容的补丁集合。

Figma 当前公开模型包含 Variable Collection、稳定 mode/default、每 mode value、同类型 alias、scope、code syntax、发布可见性，以及 Page/SceneNode 的显式 mode 和节点/paint bindings。官方类型目前包括 BOOLEAN、COLOR、EASING、FLOAT、STRING、TIMING 六类；mode 从消费节点向祖先与 Page 继承，未显式选择时使用 collection default。

## 决策

### 正式 Variables 文档事实

`DesignDocument 1.26.0` 删除无类型 token 占位，增加：

- `variableCollectionOrder`
- `variableCollectionsById`
- `variablesById`

Collection 持有稳定 `id/key`、名称、发布可见性、有序 modes、default mode 和有序 variable IDs。Variable 持有稳定 `id/key`、名称/说明、collection、六类 resolved type、完整 `valuesByMode`、Figma-compatible scopes、WEB/ANDROID/iOS code syntax、发布可见性和 extensions。名称中的 `/` 是 group 路径语义，不建立第二份 group registry。

Alias 使用公开 `{ type: "VARIABLE_ALIAS", id }` 形状，只能指向同类型 Variable；可以跨同一 Design File 的 Collection。每条解析按消费节点为 alias 链中的每个 Collection 独立选择 mode。missing collection/mode/value/alias、类型不匹配和 cycle 返回结构化 issue，不能无限递归或回退到任意值。

解析与投影语义位于独立、无状态的 `@opendesign/variable-service` 包。该包只依赖 `@opendesign/design-contracts`；EditorRuntime、生产 Leafer 投影与桌面端消费服务结果，不能把 Renderer、引擎对象或 Figma adapter 反向引入协议层。`scripts/architecture-policy.json` 将其分类为 service，并由 layer direction、manifest import 和 cycle 门禁校验。

### Mode 与绑定

Page、SceneNode 使用 `explicitVariableModes`；子节点优先自己的显式 mode，其次最近祖先、Page，最后 collection default。删除 mode/collection 时 Runtime 必须在同一事务清理或迁移所有显式 mode，不能留下悬空引用。

节点使用 Figma-shaped `boundVariables`：v1 支持 BOOLEAN→`visible`、FLOAT→`opacity`、STRING→Text `characters`；SolidPaint 支持 COLOR→`color`。字段与 variable resolved type 是 Runtime 与文档 invariant 的硬约束；`scopes` 与 Figma 一致，只影响 Human/Agent picker 的推荐和指导性 warning，不阻止 Plugin/事务显式绑定，也不使文档失效。权威节点继续保存具体 fallback 值；Variable Service 只生成当前 revision 的可丢弃 resolved projection，Canvas、Component projection、SVG 与位图消费同一结果。mode/alias 变化不反写节点值，也不建立第二份历史。

COLOR raw value 使用 Figma 公开的 RGB/RGBA `0..1` 通道形状；投影到 SolidPaint 时转换为 OpenDesign color，并将 RGBA alpha 与 Paint 自身 opacity 相乘。FLOAT 绑定 opacity 使用 Figma/Plugin API 的 `0..1` 属性单位；超出该字段范围的已解析值返回结构化 projection issue 并保留节点 fallback，不做静默百分比猜测或夹取。

TIMING/EASING 在 v1 中可创建、分 mode、alias、编辑、持久化、检查和通过 Library/DTCG 后续 adapter 交换，但在正式 Motion/animation 文档模型落地前没有可绑定设计字段；UI 与 Agent 必须明确显示该限制。

### Runtime、Human 与 Agent

Collection/Mode/Variable create、rename、reorder、value/alias、scope/code syntax、delete、binding 与 explicit mode 都由 EditorRuntime planner 生成一个正式 DesignTransaction，复用 base revision、preview、diff、history、undo/redo、autosave 和保存重开。

Variables 使用独立工作台视图管理 Collection、mode 列和 Variable 行；选中节点的 Inspector 只展示与当前字段类型/scope 匹配的变量，并显示 resolved mode/value、alias chain、clear binding 和 explicit mode。键盘提交、空态、错误、窄窗口和长名称必须可用。

Agent 使用独立 typed Variables tool，只能提交 inspection 返回的稳定 Collection/Mode/Variable/Page/node ID；模型不能通过通用 apply 写 Variables registry，也不能传任意 JSON value 绕过 resolved type。inspection 返回定义、raw/resolved value、mode 来源、alias chain 和 bindings。

## 迁移与兼容

`1.25.0` 及更早文档只有在旧 token maps 为空时迁移为空 Variables registry；非空占位内容没有已接受语义，必须拒绝而不是猜测。`1.26.0` 缺少正式字段或带旧占位键时严格拒绝。

核心协议不依赖 Figma 私有 `.fig`。隔离 interop 包只验证公开 Plugin API 形状；未来 REST/Plugin 与 DTCG adapter 负责 ID/key、RGBA、group path、远程 Library 和保真报告转换。

## 验证

自动化覆盖 schema/migration、六类值、collection/mode/value 完整性、alias type/cycle、mode inheritance、四类真实绑定、Component Main/Instance 投影、Canvas/SVG/位图、create/edit/delete planner、单 revision/diff/undo、保存重开、Variables UI、Inspector、Agent strict schema/execution/inspection，以及当前 capability/fixture/verification facts。

## 后果

Variables 成为 OpenDesign 自有设计系统事实和后续 Library/DTCG 的依赖基础，不再是 token JSON 占位。能力仍为 `degraded`：Timing/Easing binding、更多 FLOAT/COLOR scopes、gradient stop/effect/style/component-property binding、prototype variables、extended collections、跨文件 Library、REST/Plugin/DTCG import-export 与双平台打包 GUI 实机证据仍待完成。

参考：

- https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes
- https://help.figma.com/hc/en-us/articles/15145852043927-Create-and-manage-variables-and-collections
- https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables
- https://developers.figma.com/docs/rest-api/variables/
