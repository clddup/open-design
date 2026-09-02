# ADR-0287：Figma-compatible 测量式 Vector 新锚点创建

## 状态

Accepted

## 背景

ADR-0283 已完成 Vector edit 中现有锚点之间的 `Option/Alt` 双轴距离测量，但把“测量到画布候选位置并点击创建新锚点”误归为后续 Pen authoring。

Figma 当前公开文档明确把两种 target 放在同一 Vector edit 测量流程中：既可以悬停现有锚点，也可以测量到一个新的锚点位置并点击画布在该位置加点。它同时把 Pen 沿现有 vector path 加点列为另一项独立操作：

- <https://help.figma.com/hc/en-us/articles/360039956974-Measure-distances-between-layers>
- <https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>

新锚点不能成为无绘制意义的孤立节点，也不能由 Renderer 直接改 Leafer 场景。它必须进入 OpenDesign 权威 Vector Network，并继续经过现有 EditorRuntime 事务、revision、undo 与保存链。

## 决策

### 1. Geometry Service 提供单一自动连接语义

Geometry Service contract 40 增加 `appendVectorPoint(network, sourceVertexId, point)`：

- source 是一个开放 path 的唯一端点时，保留原 path ID 并按 traversal 顺序延续该 path；
- source 不是唯一开放端点时，创建一条与 source 共享顶点的真实 branch path；
- 新 vertex、segment 与必要的 path ID 由可信宿主按现有稳定 ID 规则生成，调用方不能提交结果 ID；
- smooth/mirrored 开放端点延续时镜像已有切线，端点 cap 转移到新端点；内部 junction 转为 independent 并清除不再成立的 corner radius；
- 非有限 point、缺失 source、重合 point 与非法 network 显式失败，不修改输入。

该纯函数不读取 Page、viewport、selection、Leafer 对象或 revision，也不保存第二份 Vector 状态。

### 2. 候选测量保持 document-space

Vector edit scope 合计恰好选中一个 anchor、工具为 Move 且目标可写时，鼠标在画布、当前 path 或 region 上的位置成为 prospective anchor。按住 macOS `Option` 或 Windows `Alt` 后，现有 `DistanceMeasurementOverlay` 从已选 anchor 显示到该 document-space 候选点的水平与垂直距离。

悬停现有 anchor 时仍优先使用现有 anchor 身份，不把它降级成候选点；handle、selection box、resize/rotate control 不提供创建候选。

### 3. 点击只提交一次现有 Vector edit

`Option/Alt` 点击候选位置时，Leafer 把 document point 通过当前 path element 的坐标边界转换成 node-local point，调用 `appendVectorPoint`，再通过既有 `onVectorEdit` 提交完整结果。成功后新 anchor 成为唯一选中点；callback 拒绝或 stale revision 时恢复权威投影且不改变 selection。

一次点击只有一次 Vector transaction/revision/undo。pointer move、测量和候选状态不写入文档、history、capture 或 export。

### 4. 不扩大工具面

本切片不新增 Agent tool、DesignDocument 字段、偏好项或第二套 Pen 状态。Agent 仍通过现有 Vector 语义工具操作权威 network。

Pen 在已有 path 的 `segment + t` 位置无损插点、点击拖拽创建 Bézier 新点，以及 path/handle 测量和吸附继续作为独立后续切片；不能用当前自动连接动作冒充沿曲线拆分。

## 验证

- Geometry：开放 path 首尾延续、smooth/mirrored 切线、cap 转移、内部节点真实 branch、稳定 ID、非法/重合输入零修改。
- Leafer：旋转 Vector 的 document-space 候选测量、node-local 新点写入、一次 callback、新点 selection、只读失败关闭与 redline 清理。
- 回归：已有 anchor-to-anchor 测量、节点拖动/吸附、Cut/Bend/Lasso/Paint、scope 与 revision 清理行为不变。

## 后续

- Pen 沿现有 line/cubic segment 无损插点与继续绘制。
- path 最近点及 Bézier handle 的测量/吸附。
- macOS/Windows 打包产品的真实指针、键盘、HiDPI 与视觉证据。
