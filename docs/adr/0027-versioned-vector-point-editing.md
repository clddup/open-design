# ADR-0027：版本化矢量节点与贝塞尔手柄编辑

- 状态：Accepted
- 日期：2026-08-11
- 文档协议：`DesignDocument 1.8.0`
- 关联：ADR-0009、ADR-0012、ADR-0026
- 参考：Figma Vector Networks / Edit vector layers、OpenPencil `449f31dd8b7df12965f65d9da774597332fc153d`

## 背景

`DesignDocument 1.7.0` 已拥有稳定 vertex/segment/path/region ID 和 Pen 创作，但完成后的 network 只能整体选择与变换。用户不能继续选中已有节点、移动贝塞尔手柄或明确控制手柄耦合方式；普通 Leafer selection chrome、Pen preview 与未来路径编辑 overlay 也缺少互斥生命周期。

Figma 把普通图层选择和 vector edit mode 分离：Enter 进入，节点拥有独立选区，Bézier 手柄支持 no mirroring、mirror angle、mirror angle and length。OpenPencil 的固定源码把 path overlay、anchor/handle hit、bounds refit 和 history commit 分离。OpenDesign 采用这些产品行为，但继续使用自己的 network、Runtime 与 Leafer adapter。

## 决策

### 持久点语义

`VectorVertex` 在 `1.8.0` 增加可选 `handleMode`：

- `corner`：没有活动手柄；
- `smooth`：两侧手柄保持反向共线，长度独立；
- `mirrored`：两侧手柄反向、共线且等长；
- `independent`：各手柄独立移动。

旧 `1.7.0` network 确定性升级但不猜测或写入 `handleMode`；编辑器在缺失时从当前 tangent 几何推断。新 Pen 和节点编辑会持久化明确模式。segment tangent 仍是对应顶点的局部 offset，公共协议不保存 Leafer 控件或屏幕坐标。

受控 SVG editable-network metadata 升级为 v2 并写出 `handleMode`；读取端继续接受 v1，且不为旧 metadata 发明模式。标准 SVG `d` 仍是交换和渲染几何，metadata 继续通过 schema、topology 和 `d` 一致性三重校验。

### 单轮廓编辑工作流

首个已有节点编辑切片支持一个非分叉 path run：

- 选中 network Path/Vector 后按 Enter 或双击进入；Done、Escape 或切换工具退出；
- 普通 Leafer selection/hover chrome 在 edit mode 隐藏，只显示独立 trace、anchor 和 handle overlay；
- 点击节点单选，Shift 点击增删多选；拖动任一已选节点会以相同局部 delta 移动全部已选节点；
- 仅选中节点显示其活动手柄；拖动按持久 `handleMode` 更新对侧手柄；
- 上下文控制可把已选节点改为 corner、smooth、mirrored 或 independent；
- Delete/Backspace 删除已选节点并重建单轮廓连续边；不足以形成合法开放/闭合轮廓时删除整个节点；
- 锁定节点仍可进入和检查内部点选区，但所有几何操作与 point mode 控制只读；
- pointer move 只更新 Leafer 的短生命周期预览；pointer-up、point mode 和删除分别生成一条候选写入，并经当前 revision 的唯一 `EditorRuntime` 事务提交；失败恢复权威投影。

完成编辑后，Geometry service 用 cubic tight bounds 归一化 network。节点 transform 组合归一化 offset，保证旋转、缩放和倾斜节点的世界几何不跳动。每个完成动作只产生一个 revision 和一个 undo step；进入、点选和退出不修改文档。

### 状态与边界

内部 vertex selection 是 Renderer session state，不进入 `DesignDocument`、Conversation 或 Agent 工具。Agent 仍通过完整 network 的 typed transaction 修改同一公共几何；人工编辑不建立第二份 durable state。

当前交互切片明确拒绝分支和多轮廓写入，但可只读显示。单轮廓开放/闭合与 reverse 后续已由 [ADR-0037](0037-versioned-vector-topology-operations.md) 完成；connect/disconnect、路径切断、套索、多点变换框、flatten、outline stroke 和 Slice 继续后续实现，不能通过隐藏 fallback 或重建 SVG path 字符串冒充完成。

## 迁移与失败

- `1.7.0 → 1.8.0` 只提升文档版本并保留全部 network 数据；缺失模式按需推断。
- 无效 topology、缺失节点/手柄、非有限坐标和不支持的分支/多轮廓返回结构化失败，不提交 revision。
- 编辑期间同一节点被新的权威 revision 修改时，丢弃临时预览并重建 overlay；无关节点的相邻增量更新不打断手势。
- 锁定、节点删除、Page/Design File 切换或工具切换会结束 edit mode 并清理 overlay；不得等待下一次全量刷新清理蓝色 chrome。

## 后果

- 已创建的企鹅、Logo 和自由轮廓可以继续人工精修，不需要删除并重建整个 path。
- 普通 selection、Pen authoring 和已有 path editing 成为互斥画布状态，蓝色只表达当前真实选择或路径编辑控制。
- `vector.path-rendering` 与 `vector.pen-node-editing` 仍为 `degraded`：单轮廓编辑已有自动化证据，但分支、多轮廓、高级路径命令、像素基线和 macOS/Windows 打包实机交互证据尚未完成。
