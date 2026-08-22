# ADR-0124：跨 Design File Library 发布源与消费快照

- 状态：Accepted
- 日期：2026-08-21
- 文档协议：`DesignDocument 1.37.0`
- Component Service：跨文件 imported-source lookup 与 release planner
- 关联：ADR-0066、ADR-0067、ADR-0068、ADR-0070、ADR-0094、ADR-0126

## 背景

OpenDesign 已有同一 Design File 内的 Component Main、Instance、Variant、Slot、Style 与 Variable，但跨文件复用不能把远端 Main 塞进普通 `nodesById`。普通节点必须从 Page 可达，创建隐藏 Library Page 会污染 Layers、selection、history 与导出，并把第三方编辑器的内部模型变成 OpenDesign 文档事实。

Figma 的公开 Library 语义也区分源文件发布与消费文件启用：源修改只有重新发布后才成为更新，消费文件 review/accept，禁用 Library 不删除已有实例。

## 决策

### imported source 是正式文档 store

`DesignDocument 1.37.0` 增加 `libraryComponentsById` 与 `libraryVariantSetsById`。每个 imported Component 保存稳定 local `component.id`、不可漂移的 source identity、release ID、完整 source-node bundle、所需 assets 与嵌套 Component dependency closure。发布器把每个 Component Main 规范化为 `parentId = null` 的离页 bundle root，不能把源 Page/Frame 的父级关系带入消费文件。

Instance 继续只保存稳定 `componentId`。Component Service 通过统一 lookup 解析 local Main 或 imported source；Renderer、Leafer、SVG、位图、detach 与 inspection 不建立第二条解析路径。Imported source 不进入 Page、Layers、selection 或普通 `nodesById`。

### 发布是不可变快照，接受更新是一笔事务

同 Project 的源 Design File 发布其 Components 与 Variant Sets。Main 将不可变 release 写入：

```text
.opendesign/libraries.json
.opendesign/libraries/<libraryId>/<releaseId>.json
```

release ID 由可发布 Component 内容确定；无关 Page 内容变化不制造新 release。Catalog 只保存有界元数据、latest release、消费 Design File 的显式 enable 状态，以及 accepted/ignored review 结果，大 source snapshot 不进入 Project manifest。accepted 与 ignored 分开持久化，因此即使新 release 删除了所有可更新 Component，保存重开后也不会重复提示同一次更新。

消费文件接受 release 时，通过 `put_library_component_source` / `put_library_variant_set_source` 在一笔 `DesignTransaction` 中更新 imported snapshots。现存 Instance ID 与 Page hierarchy 不变，下一次投影自动解析新 source；diff/history/undo/redo 保存 before/after。除 `releaseId` 外，library、源 Project、Design File、Document 与源实体身份不能在更新中漂移。

### 删除、禁用与失效

禁用只从可插入目录隐藏 Library，不删除缓存 source 或已有 Instance。删除 imported source 前必须证明没有持久 Instance、嵌套 dependency、Component Property 或 Variant 引用。新 release 移除但仍被消费的实体进入 stale diagnostics，不在接受更新时静默删除。

Source bundle 必须是从 Component root 完整可达的单树，节点 parent/child、asset payload、dependency closure 与 Variant membership 均在每个 revision 校验。Library/local ID 冲突、同 asset ID 不同 payload、缺失依赖和身份漂移失败关闭。

### 当前用户流程

Project-backed Design File 的 Assets 面板提供同一条主流程：当前文件先保存再发布；其他文件显式启用 Library 后浏览其 Component/Component Set；首次放置把 release source 与 Instance 合并为一笔 `DesignTransaction`，因此只有一个 revision 和一个 undo。已经消费旧 release 的文件继续浏览旧 release，不会因放置组件暗中升级；源文件重新发布后显示更新入口，用户可接受或忽略。接受时所有 source 更新仍是一笔事务，并按“Runtime 提交 → 明确保存消费文件 → catalog 记录 accepted”的顺序推进；保存失败不能把 catalog 提前标为已接受。禁用只隐藏可插入目录，缓存 source 和已有 Instance 保留。

本 ADR 的原始范围只覆盖同 Project 的 Component/Variant 发布与消费。Shared Styles 已由 ADR-0126、Variables 已由 ADR-0128 在相同 release/catalog/事务边界上扩展；Workspace 聚合、远端团队 Library 和发布权限仍不在当前实现中。

## 后果

- OpenDesign 保持唯一文档事实、事务、revision 与撤销语义，不需要隐藏 Page 或渲染后端兼容层。
- 同 Project 跨 Design File 是首个发布/消费切片；Workspace 聚合、团队权限和远端发布在相同 release 契约上扩展。
- Components/Variants/Styles/Variables 的协议、runtime、projection、Main 持久化和 Assets/Library 用户流程共用同一 catalog/release，不建立私有缓存。

## 验证

- `1.36 → 1.37` 迁移只增加两个空 store，当前版本的其他损坏字段仍严格拒绝。
- Runtime 测试覆盖 import、实例解析、release 更新、before/after diff、undo/redo、引用删除保护、off-page source 和 nested dependency closure。
- ProjectHost 测试覆盖不可变 release、catalog-last 原子写入、显式 per-file enable、重复内容去重与旧 release 可读取。
- Main/IPC/Preload 使用同一严格共享契约，不接受 Renderer 提供的路径；accepted/ignored review 只接受 catalog 中存在的 release，任一决策都会清除同一 Library 的相反状态。
- 产品流测试覆盖发布、启用、按已接受 release 浏览、单事务插入、更新审阅、忽略、保存重开和现有 Instance 重新解析。
