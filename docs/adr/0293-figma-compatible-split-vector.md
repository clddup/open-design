# ADR-0293：Figma-compatible Split vector

## 状态

已接受并实现。

## 背景

Figma 的公开 Vector 编辑说明把 `Split vector` 定义为将 branching network 拆成独立 path，并将入口放在右键菜单或 Actions 中，而不是继续向矢量次级工具栏增加常驻按钮。OpenDesign 已能在一个 Vector Network 中创作独立 contour 与 shared-vertex branch，但只能通过 Cut 改变拓扑，无法把已有 path runs 一次拆成独立图层。

公开行为参考：

- <https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>
- <https://www.figma.com/blog/introducing-vector-networks/>

## 决策

1. `splitVectorNetwork` 按 Network 中稳定的 `paths` 顺序生成单 path Network；源图层保留第一条 path 与原 node ID，后续 path 由宿主创建相邻 sibling。
2. path 引用的 segment、vertex 与单 path region 保留原稳定 geometry ID。shared junction 在拆分后成为各 sibling 内独立的同坐标 vertex，不再保持跨图层拓扑连接。
3. 每个结果独立做 tight-bounds normalization，并通过原 node transform 补偿 local offset，拆分前后文档坐标下的外观与位置不变。
4. 跨多个 path 的 compound region 无法在独立图层中无损表达，必须在零操作前结构化拒绝；不猜 Fill ownership，不栅格化，也不偷偷丢弃 hole。
5. 人工入口放在统一选区右键菜单，不向 Canvas 次级工具栏增加按钮。操作完成后选中全部结果图层；一次操作只产生一个 revision 与一个 undo。
6. Agent 复用既有 `opendesign_edit_vector`，增加 `split-vector` action。模型只提交检查所得 `pageId/nodeId`；结果 node ID、数量、插入顺序、bounds 与 transform 全部由宿主生成。
7. 拆分不增加 DesignDocument 字段、第二套可写状态或细碎 Agent tool。保存重开、undo/redo 与 Renderer/Main 权限边界继续复用 EditorRuntime。

## 验证

- Geometry：branch path 顺序、shared junction 局部复制、单 path region 保留、单 path no-op、compound region 原子拒绝。
- Runtime：旋转/变换源图层的 tight sibling、稳定 path ID、单 revision/undo、redo 与保存重开。
- Agent：宿主结果 ID、原选区不被读取或改写、结构化结果与单事务。
- UI：右键菜单可用/禁用状态与动作路由，不增加顶部工具栏噪声。

## 非目标

- 把跨 path compound region 自动改写为 Boolean、mask 或栅格图层。
- `Split vector` 后继续保留跨 sibling 的 junction 连接。
- 为该动作新增快捷键或命令面板。
