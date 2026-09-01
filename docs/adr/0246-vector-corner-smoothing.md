# ADR-0246：Editable Vector 圆角平滑

## 状态

已接受。

## 背景

Figma 的 `CornerMixin.cornerSmoothing` 是节点级 `0..1` 数值：`0` 保持 circular corner，`0.6` 对应 iOS 风格 squircle；它不属于单个 `VectorVertex`。OpenDesign 已有 vertex `cornerRadius` 与节点 fallback，但缺少同一权威投影中的平滑曲率过渡。

## 决策

1. `DesignDocument 1.52.0` 只为 editable `VectorNetworkProperties` 增加可选 `cornerSmoothing: 0..1`；默认 `0`。raw SVG path-data 与 `VectorVertex` 不接受该字段，规则图形留待独立切片。
2. Geometry Service contract 18 保留 authored network，按 Figma 公开构造使用 `p=(1+ξ)q` 的边长消耗、两段 cubic curvature ramp 与固定圆心 circular middle 生成 disposable topology。边长不足时先降低 smoothing，再按既有规则 clamp radius。
3. smoothing 为 `0` 时必须复用原 circular cubic 语义；正 smoothing 仍只适用于闭合、非分支、相邻均为直线的可圆角顶点。synthetic entry/ramp/arc 节点不得进入文档、selection、history 或 metadata。
4. Inspector 以百分比编辑节点级值；Agent 复用 `update_properties`，不新增专用工具。Provider refinement 拒绝在 raw path-data 上提交 `cornerRadius/cornerSmoothing`。
5. Leafer region/stroke 投影、Outline Stroke、Flatten 与 SVG 都消费统一序列化。受控 SVG metadata 升至 v6，保存 authored network、radius fallback 与 smoothing；v1–v5 继续读取并默认 smoothing 为 `0`。
6. 本切片实现 Figma 公开字段语义与公开曲线构造；真实 Figma 导出路径和双平台像素基线仍是独立验收证据，不用实现自测冒充外部像素等价。
7. 该外观属于 Design File 内容，不属于创建它的 Run。失败、取消或 Provider 异常只结束当前 Run，同一 Conversation 的后续 Run 可继续编辑。

## 结果

- Vector corner smoothing 从 Contract、Geometry、Runtime、Inspector、Agent、Leafer、Outline/Flatten 到 SVG 共用一个事实源。
- `0` 保持旧圆角路径；正值生成可丢弃曲率 ramp，不污染 authored topology。
- Frame/Rectangle/Polygon/Star 等规则图形 smoothing 与真实 Figma/像素 baseline 继续保持明确缺口；dash + vertex override 后续已由 ADR-0247 完成。

## 验证

- Contract/迁移：`1.51 → 1.52`、`0/0.6/1`、越界与 raw path/vertex 拒绝。
- Geometry：circular 零回归、0.6 ramp/arc、full smoothing、边长耗尽、反向与凹角、源 network 不变和 synthetic ID 唯一。
- Runtime/UI/Agent：百分比、`update_properties`、单 revision/undo 与后续 Conversation 可继续编辑。
- 消费者：Leafer、vertex stroke、Outline/Flatten、metadata v6 与 v1–v5 默认零。
