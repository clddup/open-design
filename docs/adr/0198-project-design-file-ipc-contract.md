# ADR-0198：Project 与 Design File IPC 单一契约

## 状态

已接受。

## 背景

Project 与 Design File 的 Renderer→Preload→Main IPC 仍在 `desktop-api.ts` 中手写对象判断、精确字段、名称和 Document/Descriptor 关系。Main 与 Preload 分别调用这些布尔 guard，响应只验证“看起来像一个合法对象”，没有关联原请求的 Project、Design File、名称或 revision。这样既让桌面 API 入口继续膨胀，也允许结构规则与 Workspace/DesignDocument 的权威 Contract 漂移。

## 决策

1. Desktop shared 新增独立的 Project/Design File IPC schema 与 Contract 模块，统一 Project identity、recent/open list、Create/Read/Save/Rename 请求及 ProjectDesignFile/Manifest 响应。
2. 结构直接组合 `@opendesign/workspace-contracts` 的 Stable ID、Descriptor、Manifest、名称与时间 Schema，以及 `@opendesign/design-contracts` 的 DesignDocument Schema；不再维护 `hasExactKeys/isDisplayName/isDesignDocument` 组合判断。
3. Workspace Descriptor 与 DesignDocument 导出各自 domain refinement，组合 Contract 在完成一次结构解析后直接复用这些 refinement，避免对大型 DesignDocument 再做第二次完整结构遍历。
4. Main 和 Preload 都通过同一 Contract 解析请求与响应。Recent Project 响应关联请求 Project ID；Create/Read/Save 响应关联 Design File ID，Create/Save 继续关联 Document ID 与 revision；Rename 响应关联 Design File ID 与请求名称。
5. Project/Recent 列表拒绝重复 Project ID；Renderer 仍只传稳定 ID，不获得目录路径。原生目录选择、路径解析和 Project 持久化继续只属于 Main。
6. `desktop-api.ts` 只重导出稳定 facade 与类型；Contract schema、domain、Main Project File service 和 Preload Project API 分别放在窄模块中。原本继续膨胀的 Preload 入口同时改为组合既有 Provider/Media 业务模块，入口文件与本切片实质修改文件均保持在架构上限内。

## 结果

- Project/Design File IPC 不再维护手写结构事实源。
- 错误具有稳定 `code/path/expected/actual/recovery`，不再只有通用 `Invalid design file request`。
- 错配或迟到的 Project/File 响应不能被 Renderer 接受。
- 大型 DesignDocument 在每个 IPC 边界只做一次结构解析，不因组合 Contract 重复遍历。

## 验证

- Project identity 的未知字段与稳定 ID 路径。
- Descriptor/Document 身份、Create/Save revision 与 Read/File ID 关联。
- Rename trim、响应名称和 Design File ID 关联。
- Manifest/Recent list 重复 ID、Workspace 名称控制字符。
- Main ProjectIpcService、Preload 共享 parser、Desktop API facade、Workspace/DesignDocument Contract 回归。
