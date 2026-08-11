# ADR-0024：版本化 Line/Arrow 语义与原生端点编辑

- 状态：已接受（contract/runtime/人工与 Agent 入口/SVG 子集完成，双平台产品证据待完成）
- 日期：2026-08-11
- 补充：ADR-0005、ADR-0009、ADR-0010、ADR-0011、ADR-0015、ADR-0023
- 文档协议：`DesignDocument 1.5.0`

## 背景

专业设计平台中的 Line 不是高度很小的 Rectangle，也不是每次修改都要重建的普通 Path。它需要保留方向、开放描边、端点装饰和直接拖动端点的可编辑语义。Arrow 是同一条有向线段的创建预设；若再建立一个 `arrow` 持久节点，会让描边、反转、SVG、Agent schema 和后续 connector 能力形成两套重复状态。

Figma 的公开 Shape 与 Stroke 工作流把 Line/Arrow 作为基本绘制入口，并把起终点、cap、join 和 dash 归入描边语义。Leafer 的 `Arrow` 扩展建立在 `Line` 之上，支持独立 `startArrow` / `endArrow`；`leafer-editor` 对 Line 默认使用 `LineEditTool`。这些产品和引擎能力作为交互与底层投影参考，但 OpenDesign 继续拥有持久文档与事务语义。

## 决策

`DesignDocument 1.5.0` 新增唯一持久节点 `line`。节点在自身局部 bounds 中保存归一化、有方向的 `start` 与 `end`，因此反向、水平、垂直和零宽/零高线段不会因 bounds 规范化丢失方向。节点保存开放描边所需的 strokes、width、center align、cap、join 和 dash；`fills` 必须为空，inside/outside align 明确无效，避免保存渲染器会忽略的假外观。

起点和终点分别使用以下版本化装饰：

- `none`
- `line-arrow`
- `triangle-arrow`
- `reversed-triangle-arrow`
- `circle`
- `diamond`

Arrow 不成为第二个 node kind。工具栏的 Line 与 Arrow 最终都创建 `line`：Line 默认两端 `none`，Arrow 默认终点 `line-arrow`。Inspector 可独立改变两端、反转 start/end，并编辑 stroke width、cap、join 与 dash。人工创建使用 `L` 和 `Shift+L`；Shift 把线段约束到 45 度增量，Alt/Option 从起点中心对称绘制。点击不拖动创建一条确定性默认长度线段，成功插入后选中新节点并回到 Select；取消拖动或事务拒绝不留下部分节点。所有成功创建和端点拖动都各自进入一次普通 `DesignTransaction`，因此复用 revision、保存重开和 undo/redo。

Leafer adapter 把 `line` 投影为官方 `Arrow`，通过 `points`、`startArrow`、`endArrow` 和通用 stroke/appearance 属性渲染。`editable: true` 继续使用 Leafer 默认 `LineEditTool`；拖动任一端点后，adapter 把 Leafer points 重新规范化为一个 `update_properties`，只提交受影响 Line 的 transform、size、start 与 end。Adapter 不把 Leafer Arrow 对象写入文档，也不建立 Renderer 第二份文档状态。

Agent 的 `opendesign_apply_transaction` 接受同一完整 LineNode，并继续由完整 Design Contracts 做最终运行时校验。System prompt 要求 divider、connector、diagram 和 arrow 使用 LineNode，禁止用细 Rectangle 或被扁平化的 Path 冒充。模型不能选择 Leafer endpoint 名称或调用引擎对象，只能使用 OpenDesign 版本化端点枚举。

开放 Line 暂不作为 Boolean operand。把开放线段静默扩成填充轮廓会改变语义；必须等正式 outline-stroke 操作可以显式产生闭合 Path 后再复审。

## SVG 交换

普通外部 `<line>` 在没有 marker 时导入为可编辑 LineNode，保留方向、transform 与受支持的 stroke/appearance。OpenDesign 导出的端点使用标准本地 `<marker>` 引用，并携带固定、可验证的 OpenDesign endpoint 标记。

导入器只接受与当前协议精确匹配的本地 marker 定义。外部 URL、缺失 ID、重复 ID、未知 marker、被修改的 marker attributes/children 或无法解析的引用返回 `line-endpoint-unsupported` error；不会执行外部资源、猜测形状、信任声明或把结果静默扁平化。标准 SVG 无法保证任意第三方 marker 可逆映射到 OpenDesign 端点，因此该限制在 capability manifest 中保持 `degraded`。

## 迁移

读取 `1.4.0` 文档时只把 `schemaVersion` 确定性升级为 `1.5.0`，不发明 Line、Arrow 或端点。`1.0.0` 至 `1.3.0` 继续按既有 appearance、Path、Image placement 与 mask 顺序迁移到当前协议。未知版本继续拒绝。

专业 fixture 的权威生成器同步输出 `1.5.0`；生成文档与 SHA-256 manifest 重新生成，不手工修改派生产物。

## 当前证据

- Design Contracts 校验有向归一化端点、独立端点装饰、水平/反向线段、空 fill、center stroke 与 `1.4.0 → 1.5.0` 迁移；
- Leafer mapping 测试证明 LineNode 投影为 Arrow，并保留 points、端点、cap、join、dash 与 appearance；
- adapter 测试覆盖反向拖动、Shift 45 度、Alt 中心绘制、默认点击创建和 LineEditTool 端点写回单事务；
- Renderer 集成测试覆盖工具栏、`L` / `Shift+L`、Line/Arrow 创建后选中并返回 Select；
- Inspector 测试覆盖独立端点、反转、cap、join 和 dash；
- Agent contract 测试接受合法 Line，拒绝未知 endpoint 和越界归一化坐标；
- SVG 测试覆盖全部端点往返、普通外部 Line 导入、缺失/外部/篡改 marker 拒绝和现有恶意 XML 门禁；
- capability manifest 将 Line/Arrow 标为 `degraded`，没有用自动化结构证据冒充 macOS/Windows 打包产品交互证据。

## 后续门禁

1. 在同一 commit 的 macOS 与 Windows 打包程序中验证鼠标、触控板、快捷键、端点手柄、undo/redo、保存重开和 SVG 文件往返。
2. 建立真实 Leafer 像素 baseline，覆盖全部端点、dash、旋转、缩放、effects 与高 DPI。
3. 在正式 geometry/connector 语义中补 polyline、orthogonal routing、snap、label attachment 和显式 outline stroke；这些能力不能塞入 `extensions` 或用 Path fallback 冒充。

## 参考

- [Figma Shape tools](https://help.figma.com/hc/en-us/articles/360040450133-Shape-tools)
- [Figma Stroke properties](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties)
- [Leafer Line](https://www.leaferjs.com/ui/reference/display/Line.html)
- [Leafer Arrow](https://www.leaferjs.com/ui/plugin/in/arrow/)
- [Leafer editable / LineEditTool](https://www.leaferjs.com/ui/reference/property/editable.html)
