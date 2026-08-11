# ADR-0026：版本化可编辑矢量网络与 Pen 创作

- 状态：Accepted
- 日期：2026-08-11
- 文档协议：`DesignDocument 1.7.0`
- 参考：Figma Vector Networks、OpenPencil `449f31dd8b7df12965f65d9da774597332fc153d`

## 背景

`DesignDocument 1.2.0` 的 `path/vector.properties.path` 能精确保留 SVG path 数据并稳定渲染复杂轮廓，但它只有一段不可寻址字符串。人工和 Agent 可以生成有机轮廓，却不能用稳定 ID 指向顶点、边、path run 或填充区域，也无法在不重写整段 path 的情况下建立专业节点编辑。

Figma 的长期模型是 Vector Network：顶点、边和填充区域组成可分叉图，而不是一条顺序 SVG path。OpenPencil 的固定源码则提供了适合作为首个创作切片的状态机证据：click 放点、drag 拖出镜像手柄、点击首点闭合、Escape/Enter 完成开放路径、Backspace 回退，以及一次 history commit。OpenDesign 需要采用这些行为，但不能引入 OpenPencil 文档、renderer 或第二份可写状态。

## 决策

### 唯一文档事实

`path` 与 `vector` 节点在 `1.7.0` 使用严格互斥的几何来源：

- `PathDataProperties`：`path + fillRule + appearance`，用于精确保留导入或尚不能安全反解的 SVG path。
- `VectorNetworkProperties`：`network + fillRule + appearance`，用于可编辑几何。

同一节点不得同时保存 `path` 和 `network`。Leafer Path、PathKit Boolean、SVG export 和诊断都通过 Geometry service 把两种来源解析为低层 path；不得在 renderer、Agent 或 importer 建立第二个几何事实。

### Network 结构

`VectorNetwork` 保存：

- `vertices`：稳定 vertex ID 与局部坐标；
- `segments`：稳定 segment ID、起终点 ID，以及相对对应顶点的 cubic tangent offset；
- `paths`：按方向引用 segment 的有序 path run，并显式标记 open/closed；
- `regions`：引用 closed path loop 的填充区域与 winding rule。

Runtime invariant 除 schema 外还验证 ID 唯一性、有限坐标、segment 顶点存在、无自环、每条边唯一归属、path 连续和闭合关系、无孤立顶点，以及 region 只能引用 closed path。损坏 network 在 transaction、保存重开和导入边界明确失败。

### Pen 创作切片

首个产品切片只生成一个非分叉 contour：

- `P` 或工具栏进入 Pen；
- click 放置 corner vertex；
- click-drag 为当前点建立镜像 incoming/outgoing cubic handles；
- 三点以上点击首点闭合；
- Enter/Escape 完成开放路径；
- Backspace/Delete 删除最后一点，单点再取消；
- 切换工具时，两点以上完成开放路径，否则取消；
- parent 在第一次点击时冻结；
- preview、anchor 和 handle 全部是短生命周期 Leafer scene 元素；
- 完成时归一化 network 和 tight cubic bounds，只提交一次 `insert_element`，因此只有一个 revision 和一个 undo step。

这不是完整节点编辑。已有 network 的 Enter/双击编辑、vertex/handle selection、corner/smooth/asymmetric point type、连接/断开、分支、路径反转、flatten 和 outline stroke 继续作为后续切片。

### SVG 与 Agent

标准 SVG `d` 始终是可交换的渲染几何。OpenDesign 自己导出的 editable network 额外携带有界、版本化 metadata；导入时必须同时通过 network schema、拓扑验证和由 network 确定性序列化所得 path 与实际 `d` 的匹配验证。metadata 缺失的外部 SVG 继续导入为精确 path-data，不猜测为可编辑 network；缺失、损坏或与 `d` 不一致的受控 metadata 明确返回 `invalid-geometry`。

Agent `opendesign_apply_transaction` 同时暴露两种正式语义：新建可编辑有机轮廓优先使用 network；需要精确保留外部数据时使用 path；禁止双写。Agent 和人工 Pen 最终都进入同一 `DesignTransaction`。

## 迁移与失败

读取 `1.6.0` 文档时只把 `schemaVersion` 提升为 `1.7.0`，既有 path 字符串保持 path-data，不自动猜测顶点或丢失 arc/conic 保真。`1.0.0` 至 `1.5.0` 继续先执行既有迁移再进入当前 schema。未知版本继续拒绝。

无效 network 不允许静默回退到空 path、矩形或椭圆。Leafer 投影是当前 revision 的可丢弃结果；callback 被 Runtime 拒绝时删除 preview 并恢复权威投影。

## 后果

- OpenDesign 获得可演进到 Figma 式分叉网络的稳定公共协议，而不是把 Leafer/PathKit 私有对象写进文档。
- 人工和 Agent 首次可以生成同一种可编辑 cubic 轮廓，企鹅、Logo 和有机图标不再被基础几何体限制。
- `vector.path-rendering` 能力仍为 `degraded`：Pen 创作、渲染、Boolean、Agent 和受控 SVG 已有自动化证据，但已有路径节点编辑、完整 Vector Network 操作、像素基线和 macOS/Windows 打包交互证据尚未完成。
