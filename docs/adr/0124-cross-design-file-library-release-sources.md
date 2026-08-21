# ADR-0124：跨 Design File Library 发布源与消费快照

- 状态：Accepted
- 日期：2026-08-21
- 文档协议：`DesignDocument 1.37.0`
- Component Service：跨文件 imported-source lookup 与 release planner
- 关联：ADR-0066、ADR-0067、ADR-0068、ADR-0070、ADR-0094

## 背景

OpenDesign 已有同一 Design File 内的 Component Main、Instance、Variant、Slot、Style 与 Variable，但跨文件复用不能把远端 Main 塞进普通 `nodesById`。普通节点必须从 Page 可达，创建隐藏 Library Page 会污染 Layers、selection、history 与导出，并把第三方编辑器的内部模型变成 OpenDesign 文档事实。

Figma 的公开 Library 语义也区分源文件发布与消费文件启用：源修改只有重新发布后才成为更新，消费文件 review/accept，禁用 Library 不删除已有实例。

## 决策

### imported source 是正式文档 store

`DesignDocument 1.37.0` 增加 `libraryComponentsById` 与 `libraryVariantSetsById`。每个 imported Component 保存稳定 local `component.id`、不可漂移的 source identity、release ID、完整 source-node bundle、所需 assets 与嵌套 Component dependency closure。

Instance 继续只保存稳定 `componentId`。Component Service 通过统一 lookup 解析 local Main 或 imported source；Renderer、Leafer、SVG、位图、detach 与 inspection 不建立第二条解析路径。Imported source 不进入 Page、Layers、selection 或普通 `nodesById`。

### 发布是不可变快照，接受更新是一笔事务

同 Project 的源 Design File 发布其 Components 与 Variant Sets。Main 将不可变 release 写入：

```text
.opendesign/libraries.json
.opendesign/libraries/<libraryId>/<releaseId>.json
```

release ID 由可发布 Component 内容确定；无关 Page 内容变化不制造新 release。Catalog 只保存有界元数据、latest release、消费 Design File 的显式 enable 状态和 ignored update 状态，大 source snapshot 不进入 Project manifest。

消费文件接受 release 时，通过 `put_library_component_source` / `put_library_variant_set_source` 在一笔 `DesignTransaction` 中更新 imported snapshots。现存 Instance ID 与 Page hierarchy 不变，下一次投影自动解析新 source；diff/history/undo/redo 保存 before/after。除 `releaseId` 外，library、源 Project、Design File、Document 与源实体身份不能在更新中漂移。

### 删除、禁用与失效

禁用只从可插入目录隐藏 Library，不删除缓存 source 或已有 Instance。删除 imported source 前必须证明没有持久 Instance、嵌套 dependency、Component Property 或 Variant 引用。新 release 移除但仍被消费的实体进入 stale diagnostics，不在接受更新时静默删除。

Source bundle 必须是从 Component root 完整可达的单树，节点 parent/child、asset payload、dependency closure 与 Variant membership 均在每个 revision 校验。Library/local ID 冲突、同 asset ID 不同 payload、缺失依赖和身份漂移失败关闭。

## 后果

- OpenDesign 保持唯一文档事实、事务、revision 与撤销语义，不需要隐藏 Page 或渲染后端兼容层。
- 同 Project 跨 Design File 是首个发布/消费切片；Workspace 聚合、团队权限和远端发布在相同 release 契约上扩展。
- Components/Variants 的协议、runtime、projection 与 Main 持久化已形成底座；Assets/Library UI、accept/ignore 操作与 Styles/Variables 跨文件绑定必须继续使用同一 catalog/release，不得另建私有缓存。

## 验证

- `1.36 → 1.37` 迁移只增加两个空 store，当前版本的其他损坏字段仍严格拒绝。
- Runtime 测试覆盖 import、实例解析、release 更新、before/after diff、undo/redo、引用删除保护、off-page source 和 nested dependency closure。
- ProjectHost 测试覆盖不可变 release、catalog-last 原子写入、显式 per-file enable、重复内容去重与旧 release 可读取。
