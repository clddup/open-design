# ADR-0244：Vector 顶点级描边外观

## 状态

已接受。

## 背景

OpenDesign 已支持 Vector 节点级 `strokeCap` 与 `strokeJoin`，但 Figma 的 `VectorVertex` 允许单个顶点覆盖端帽和转角。缺少这层语义时，同一开放路径无法表达不同端点或局部转角，人工编辑、Agent、Leafer、Outline/Flatten 与 SVG 也会各自猜测外观。

## 决策

1. `DesignDocument 1.50.0` 为 `VectorVertex` 增加可选 `strokeCap` 与 `strokeJoin`。有效外观按“顶点覆盖 → 节点 fallback”解析；`null` 编辑输入只表示移除覆盖，不进入持久文档。
2. Geometry Service contract 16 提供唯一解析与 stroke-part 投影，把 topology 确定性投影为 segment、join 和 endpoint cap。Leafer、Outline Stroke、Flatten 与标准 SVG 复用该投影，不分别维护外观判断。
3. 人工入口沿用 Canvas 的 session-only 顶点选区。Inspector 对单值、Mixed 与 Inherit 提供明确控件，并通过 `planVectorSemanticEdit` 生成一次 `EditorRuntime` 事务；选区不写入 `DesignDocument`、history 或保存。
4. Agent 继续复用统一 `opendesign_edit_vector` 的 `set-vertex-stroke-appearance` action，不增加专用工具。Provider Schema 与 Runtime 从同一 Contract 派生。
5. 受控 SVG metadata 升级为 v4。标准 SVG 使用独立 stroke-part `<path>` 表达各局部 cap/join，隐藏 metadata source 只负责恢复单个 editable Vector；synthetic parts 不导入为文档节点。
6. dash 与顶点覆盖的组合当前不能精确保真：Outline、Flatten 与 SVG 显式失败；Leafer 给出 fidelity warning 并保留节点级可见 fallback，不静默宣称支持。
7. 顶点外观属于当前 Design File 的普通可编辑内容，不归创建它的 Run 或 Conversation 所有。Run 失败、取消或 Provider 中断只能结束本轮；同一 Conversation 的后续 Run 仍可继续修改已有顶点和设计。

## 结果

- Figma-compatible 顶点描边从 Contract、Geometry、Runtime、人工入口、Agent、Leafer 到 SVG 形成同一垂直切片。
- 普通无覆盖 Vector 保持原单 Path 快速路径，不为未使用能力增加投影成本。
- `cornerRadius`、更多 cap 形态、dash + override 保真与分支网络继续作为独立切片，不在本决策中伪造支持。

## 验证

- Contract/迁移：1.49 → 1.50、合法枚举、未知值与精确字段路径。
- Geometry/Runtime：解析优先级、Mixed override、清除继承、单 revision、undo/redo、Outline 与 Flatten。
- Canvas/Inspector/Agent：session-only 顶点选区、单值/Mixed/Inherit、统一 action 与失败归因。
- Leafer/SVG：segment/join/cap 投影、metadata v4 round-trip、synthetic parts 不进入文档，以及 dash 组合的明确降级/失败。
