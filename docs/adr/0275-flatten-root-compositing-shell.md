# ADR-0275：Flatten 单根合成外壳与当前外观投影

## 状态

已接受。

## 背景

Figma 的 `flatten()` 返回 `VectorNode`。`VectorNode` 仍属于可合成的 SceneNode，继续拥有 `opacity`、`blendMode`、`effects` 与 mask 语义。因此，把一个根图层 Flatten 成 Vector 时，不需要把根级透明度错误乘入每个 Paint，也不应仅因根级 effect、blend 或 mask 存在就拒绝操作。

OpenDesign 现有 Flatten 已物化 Shared Style，但没有在同一入口解析 Variable 当前值；同时把单根图层的合成外壳和多个根/后代之间的像素合成混为同一个失败边界。这既低估了结果 Vector 可表达的语义，也可能让 Style 与 Variable 当前外观不一致。

## 决策

1. Flatten 的外观解析顺序固定为 Component 当前投影 → Shared Style 当前投影 → Variable 当前模式投影 → Geometry materialization。只检查所选 subtree 的解析问题，无关节点的非法引用不阻塞本次操作。
2. 当选择恰好一个持久根时，结果 Vector 原样继承该根解析后的 `visible`、`opacity`、`blendMode`、`effects`、`maskMode`、`effectStyleId`、`explicitVariableModes`，以及仍适用于结果 shell 的 `visible/opacity` Variable bindings。
3. Paint Variable 在几何 region Paint 中物化为当前值并解除 Paint binding；不得把图层 opacity 乘进每个 Paint，也不得复制与结果 Vector 无关的绑定。
4. Component Instance 先由 Component Service 生成当前 resolved root shell；Instance 与 Main/Variant 的外观合成结果按同一单根规则迁移。只删除用户所选持久 subtree，派生 projection 仍不进入事务。
5. 多根选择中的任一根级 compositing，以及单根 subtree 内任一后代的 opacity/effect/blend/mask，仍要求真实像素合成或隔离层语义，当前失败关闭。不得把这些属性提升到结果根、分摊到 Paint 或忽略绘制顺序。
6. 沿用现有人工快捷键、统一 Agent `flatten` action、Runtime planner、宿主结果 ID 和单 revision/undo；不增加工具、文档字段、产品版本、内容 hash 或数量门禁。

## 影响

- 单个图层、Frame、Group 或 Component Instance 的根级合成外壳可以无损迁移到结果 Vector。
- 多根和后代 compositing、真实像素效果基线、嵌套/重叠 region，以及 macOS/Windows 打包交互证据仍是独立缺口。
- 本决策不升级 DesignDocument 或 Geometry Service contract；仅收敛 EditorRuntime 对既有公共语义的消费顺序与保真边界。

## 公开语义参照

- [Figma Plugin API：flatten](https://developers.figma.com/docs/plugins/api/properties/figma-flatten/)
- [Figma：Flatten layers](https://help.figma.com/hc/en-us/articles/30101373312279-Flatten-layers)
- [Figma Plugin API：SceneNode isMask](https://developers.figma.com/docs/plugins/api/properties/nodes-ismask/)
- [Figma Plugin API：BlendMode](https://developers.figma.com/docs/plugins/api/BlendMode/)
