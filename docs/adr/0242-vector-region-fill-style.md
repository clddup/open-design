# ADR-0242：Vector Region Paint Style 引用

## 状态

已接受。

## 背景

OpenDesign 已支持 `VectorRegion.fills` 和 Shared PAINT Style，但 region 只能保存直接 Paint。Figma 的 `VectorRegion` 同时提供 `fills` 与 `fillStyleId`；缺少 Style 引用会迫使人工入口和 Agent 复制 Paint，Style 更新也无法同步到复杂 Vector 的局部区域。

## 决策

1. `DesignDocument 1.49.0` 为 `VectorRegion` 增加可选 `fillStyleId`，只允许引用当前文档可解析的 PAINT Style。文档 Domain、Style Service 与 EditorRuntime 共同维持该引用，不引入第二份渲染状态。
2. Style 绑定与直接 Paint 是明确的编辑操作：绑定 Style 时移除 region-local `fills`；直接设置或清空 Paint 时移除 `fillStyleId`。删除 Style 前先把当前解析 Paint 写入 region，再解除引用，保证外观与单次 undo。
3. Canvas Vector Paint 工具可选择 Direct Paint 或已有 PAINT Style；Agent 继续复用统一 `opendesign_edit_vector`，通过 `set-region-fill-style` 提交稳定 node/region/style ID，不新增独立工具。
4. Leafer 只消费 Style Service 对当前 revision 的解析投影。Style 更新会在下一次投影改变 region 外观，synthetic region Path 仍不进入文档、history 或保存。
5. Flatten 在计算几何前解析节点和 region Style，并把当前可见 Paint 物化进结果。SVG 是独立交换格式，只导出解析后的标准 Paint；受控 metadata 不携带依赖原文档 Style 表的 `fillStyleId`，重新导入后得到可编辑的 direct Paint。
6. Region 与 Style 都是当前 Design File 的普通内容，不归创建它们的 Run 或 Conversation 所有。Conversation 可连续创建多个 Run；任一 Run 的失败、取消或 Provider 中断不得阻止后续 Run 修改既有 region 或 Style。

## 结果

- Figma-compatible region Style 从 Contract、Domain、Style lifecycle、Runtime、人工入口、Agent、Leafer、Flatten 到 SVG 形成一个垂直切片。
- Provider Schema 与 Runtime Contract 继续来自同一 `DesignVectorContract`；没有额外 normalizer、字符串错误分类、内容 hash 或数量门禁。
- SVG 保持可移植外观，但不会伪造跨文档 Style 身份；后续若实现 Library/文件格式级 Style 映射，应在专用导入适配器中处理。

## 验证

- Contract：合法 PAINT Style、缺失/错误类型引用和精确字段路径。
- Style/Runtime：绑定、更新投影、直接 Paint detach、删除前物化、undo 与保存重开。
- Canvas/Agent：Style Paint、Direct Paint、Alt-clear 与统一 semantic planner。
- Flatten/SVG：Style 解析后的颜色保持，结果与重新导入内容不含悬空 `fillStyleId`。
