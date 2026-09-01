# ADR-0273：Line/Arrow endpoint 共享几何与精确 Flatten

## 状态

已接受。

## 背景

OpenDesign 已保存有向 Line 的独立起止点和五种端点装饰，但画布依赖 Leafer 内置 Arrow，SVG 使用另一套手写 marker，Flatten 则直接拒绝端点装饰 Line。同一个文档语义因此有三种不同结果，用户也无法把箭头和其他 SceneNode 一起破坏性转换为 editable Vector。

## 决策

1. Geometry Service contract 31 增加 OpenDesign-owned `line-endpoint` 定义，统一 `line-arrow`、`triangle-arrow`、`reversed-triangle-arrow`、`circle` 与 `diamond` 的 normalized path、填充方式、描边和缩放。
2. Line 的起止方向由真实 local endpoint 向量确定；起点使用反向向量，终点使用正向向量。零长度 Line 无法确定方向，必须在生成局部几何前失败关闭。
3. Leafer 继续投影为 `Arrow`，以保留 LineEditTool 端点拖动，但 `startArrow/endArrow` 改为消费共享 path 的 adapter 数据，不再使用 Leafer 内置端点名称。
4. 受控 SVG marker 使用同一 path、cap/join 和 stroke-relative scale。导入只恢复几何、cap/join 与元数据完全一致的受控 marker；普通或被修改的 marker 继续明确拒绝，不猜测语义。
5. 现有 Flatten 先独立 outline 中心线，再把不继承 dash 的端点可见几何合并，最后沿原有 transform、clip、Paint、tight bounds、单 revision/undo 与保存重开路径生成一个 editable Vector。
6. 不增加文档字段、产品版本、专用 Agent tool 或 Run 所有权。Line 默认保持可编辑；只有用户明确要求 Flatten 或把 Line 纳入明确的整体 Flatten 时才进行破坏性转换。

## 影响

- Leafer、SVG 与 Flatten 不再分别维护端点比例和方向。
- 双端点、反向斜线、dash、round/square/butt cap 和 miter/round/bevel join 都走同一几何定义；dash 只作用于中心线。
- 已完成的 `DesignDocument 1.56.0` Line 语义不变；这次只提升 geometry contract 与派生能力。
- 真实 Leafer 像素 baseline 和 macOS/Windows 打包产品直接操作仍需独立证据，不能由单元测试代替。

## 公开语义参照

- [Figma：Shape tools](https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools)
- 固定 `@figma/plugin-typings 1.133.0` 的 `StrokeCap`：`ARROW_LINES`、`ARROW_EQUILATERAL`、`TRIANGLE_FILLED`、`CIRCLE_FILLED`、`DIAMOND_FILLED`
