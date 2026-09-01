# ADR-0245：Vector 顶点圆角

## 状态

已接受。

## 背景

Figma 的 `VectorVertex.cornerRadius` 允许闭合 Vector 轮廓中的单个直线交点覆盖节点级 `cornerRadius`。OpenDesign 此前只能保存规则图形圆角，editable Vector 仍必须把圆角永久改写成额外 Bézier 节点，既丢失原始顶点语义，也让人工编辑、Agent、Leafer、Outline/Flatten 与 SVG 各自维护不同结果。

## 决策

1. `DesignDocument 1.51.0` 为 `VectorVertex` 与 editable `VectorNetworkProperties` 增加可选非负 `cornerRadius`。有效值按“顶点覆盖 → 节点 fallback”解析；显式 `0` 可覆盖非零 fallback，编辑输入 `null` 只表示删除顶点覆盖。
2. Geometry Service contract 17 保留权威 authored topology，并把圆角确定性投影为可丢弃的 entry/exit 顶点、直线裁切段和 circular cubic。投影按相邻边半长 clamp，不把 synthetic ID 写回文档。
3. 当前只支持闭合、非分支轮廓中相邻两段均为直线的顶点。开放路径、单段描边、曲线手柄交点和 corner smoothing 不猜测语义；正半径在统一 Geometry 边界结构化拒绝，清除覆盖仍允许执行。
4. Inspector 复用 session-only 顶点选区，提供单值、Mixed、Inherit 与节点 fallback；人工与 Agent 都经 `planVectorSemanticEdit` 生成一个 revision/undo。Agent 继续复用 `opendesign_edit_vector` 的 `set-vertex-corner-radius` action，不新增工具。
5. Leafer、region path、stroke-part、Outline Stroke、Flatten 与 Boolean/path 消费者统一使用同一圆角序列化。顶点描边覆盖与圆角共存时，stroke-part 消费 disposable rounded topology；dash + vertex override 的既有限制不被掩盖。
6. 受控 SVG metadata 升级为 v5，保存 authored network、节点 fallback 与 vertex override。标准 SVG `d` 保存投影后的可见路径；导入必须验证 metadata 与该路径一致，synthetic 圆角节点不进入恢复后的文档。v1–v4 继续读取并默认节点 fallback 为 `0`。
7. 顶点圆角属于当前 Design File 的普通可编辑内容，不归创建它的 Run 或 Conversation 所有。任一 Run 的失败、取消或 Provider 错误只能结束本轮；同一 Conversation 的后续 Run 可继续修改既有圆角和设计。

## 结果

- Figma-compatible circular vertex radius 从 Contract、Geometry、Runtime、Inspector、Agent、Leafer、Outline/Flatten 到 SVG 形成一个完整垂直切片。
- 文档保持少量语义顶点，渲染投影可随半径、节点 fallback 与后续几何编辑重新生成。
- corner smoothing、开放路径圆角、分支网络和 dash + vertex override 精确保真继续作为独立能力，不在本切片伪造支持。

## 验证

- Contract/迁移：`1.50 → 1.51`、非负小数、顶点 override、节点 fallback 与准确字段路径。
- Geometry：凸角、凹角、反向 traversal、半边长 clamp、显式零覆盖、synthetic ID 唯一、源 network 不变且投影 network 通过拓扑校验。
- Runtime/Agent/Inspector：单值、Mixed、Inherit、非法开放/曲线顶点、单 revision、undo 与 Provider/Runtime 同一 Contract。
- Leafer/Outline/Flatten/SVG：统一圆角路径、vertex stroke override 共存、metadata v5 往返、旧 metadata 兼容且 synthetic topology 不持久化。
