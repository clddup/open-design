# ADR-0274：Component Instance 当前投影的破坏性 Flatten

## 状态

已接受。

## 背景

OpenDesign 的 Component Instance 是轻量持久引用；其可见子树由 Component Service 根据当前 Main/Variant、typed properties、stable-source-path overrides、Slot 默认内容或 override 和当前 Style/Variable 定义即时投影。现有 Canvas、SVG、位图和质量检查均消费该投影，但 Flatten 只接受普通 Frame/Group/Boolean/Text/Image/shape，选择 Instance 或包含 Instance 的容器会失败。

Figma 的 Flatten 会把所选对象破坏性转换为一个 Vector Network；Plugin API 同样明确要求 Instance 内部派生子层不能直接重归属，必要时应先复制。OpenDesign 因此不能修改派生投影或 Component Main 来伪造 Flatten，而应只把所选 Instance 当前可见投影物化为一个普通 editable Vector。

## 决策

1. 现有统一 `flatten` action 接受完整 Component Instance root，以及包含 Instance 的既有普通容器；不增加 Component 专用工具、文档字段或 Run 所有权。
2. EditorRuntime 仅在所选 subtree 包含 Instance 或 Component property reference 时调用 Component Service v6 的只读投影；普通 Flatten 不承担全文件 Component 解析成本。
3. Flatten 从投影中读取当前 resolved Main/Variant、typed properties、overrides、nested Instance、Slot 与 Style/Variable 外观，再沿既有 Frame/Slot Fill → children → Stroke、Group child order、ancestor transform、rounded clipping、Text/Image/shape materialization和单一 Geometry 路径生成一个 Vector Network。
4. 只删除用户实际选择的持久 Instance/container subtree；Component Main、其他 Instances、Component/Variant/Style/Variable registry 保持不变。结果与源层同 parent、同最早 sibling index，并进入一条 revision/undo。
5. 派生 projection ID 永不写入事务或文档。缺失 Main、引用循环、非法 override/Slot、不可精确保真的 opacity/effect/blend/mask、缺少可信 Text outline 或 geometry provider 时在产生任何操作前失败关闭。
6. Instance Flatten 是破坏性操作。默认设计和 Agent 仍保留 Instance 的链接语义；只有用户明确执行 Flatten，或把 Instance 纳入明确的整体 Flatten 时才物化。

## 影响

- `⌘E / Ctrl-E`、Inspector/菜单入口与 Agent 继续调用同一个 Runtime planner。
- Instance override 和 Slot 当前外观可进入 editable Vector，但结果不再随 Main、Variant、Style 或 Variable 更新，这是破坏性 Flatten 的预期语义。
- Slice 仍是导出边界，不是可见绘制节点，不参与 Flatten。
- opacity/effect/blend/mask 等像素合成和真实 Figma/像素、macOS/Windows 打包交互证据仍保持独立缺口。

## 公开语义参照

- [Figma：Flatten layers](https://help.figma.com/hc/en-us/articles/30101373312279-Flatten-layers)
- [Figma Plugin API：flatten](https://developers.figma.com/docs/plugins/api/properties/figma-flatten/)
