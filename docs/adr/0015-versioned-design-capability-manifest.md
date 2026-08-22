# ADR-0015：版本化专业设计能力事实清单

- 状态：已接受（生成文档漂移门禁由 ADR-0141 退休）
- 日期：2026-08-10
- 关联：ADR-0003、ADR-0009、ADR-0010、ADR-0011、ADR-0012、ADR-0014
- Capability Manifest：`1`

## 背景

OpenDesign 已有 Path、渐变、效果、图片和 Agent 工具，但 schema、Renderer、Agent prompt 与文档此前分别描述能力。占位字段可能被误读为完成，Agent 也可能因 hard-coded prompt 落后于 Runtime，进而声称支持尚不存在的 Pen、布尔、Auto Layout、组件、变量或导出。

Figma 的专业能力并不是“能画一个相似结果”这一件事：Vector Networks 包含 Pen、节点和分支路径；布尔运算是保留源图层的非破坏性 group；Auto Layout 会随内容变化确定性重排；Component/Instance/Variant、Variable/Collection/Mode 分别有独立语义；Effects、Mask/Crop 与 Export 也不是画布截图的别名。参照：[Vector Networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)、[Boolean Operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)、[Auto Layout](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)、[Components](https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma)、[Variants](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants)、[Variables](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes)、[Effects](https://help.figma.com/hc/en-us/articles/360041488473-Apply-effects-to-layers)、[Masks](https://help.figma.com/hc/en-us/articles/360040450253-Masks)、[Crop](https://help.figma.com/hc/en-us/articles/360040675194-Crop-an-image)、[Export](https://help.figma.com/hc/en-us/articles/360040028114-Export-static-designs-from-Figma)。

## 决策

### 单一事实源

`packages/design-capabilities/src/manifest.json` 是当前产品能力状态的唯一事实源。`@opendesign/design-capabilities` 在加载时校验版本、字段、稳定 ID、分类、所有表面、证据和派生状态，并导出不可变快照。未知字段、重复 ID、未知版本或状态与证据不一致都会使验证失败。

Agent system context 与只读 `opendesign_get_capabilities` tool 读取同一 manifest。用户帮助文档与发布摘要可以按需生成；ADR-0141 已退休生成文档内容漂移的普通提交门禁，真实 schema/行为继续由类型和测试验证。

能力状态不是用户偏好，不能作为设置页顶级入口。设置只承载可配置项；将来若需要应用内查看能力，应进入帮助、关于或诊断信息架构，并继续读取同一 manifest。

### 六个产品表面

每项能力必须记录：

- `contract`：公共文档/命令是否可表达。
- `runtime`：EditorRuntime 或专业 service 是否可确定性执行。
- `human`：用户是否有可达、可恢复的人工工作流。
- `agent`：Agent 是否有语义化、受校验的工具入口。
- `render`：生产渲染后端是否保真显示。
- `export`：交付产物是否由正式导出链保真生成。

每个表面使用 `available / degraded / unavailable`。总体状态由该能力声明的 required surfaces 和证据确定：所有必需表面均为 `unavailable` 才是 `unavailable`；任一必需表面不完整、缺自动化证据或缺实机证据就是 `degraded`；只有必需表面全部可用且两类证据都存在，才允许标记 `available`。

schema 占位、第三方引擎说明、Agent 文本、单元测试或一张截图都不能单独证明完整支持。当前没有实机证据的能力不会标为 `available`。

### Agent 查询不授予权限

`opendesign_get_capabilities` 是 utility process 内的纯只读元数据查询，不访问 Main、Renderer、凭据、网络或 DesignDocument，也不扩大 Run 的 Working Set、Mutation Target 或 Capability。它只帮助模型在规划前识别降级和不可用工作流。

系统提示词包含由同一 manifest 生成的摘要；模型必须说明 degraded 限制，不能把 unavailable 能力伪装成可用。后续真正增加能力时，先完成垂直链路与证据，再修改 manifest；不能只改状态解锁宣传或 Agent 声明。

### 图片生成、处理与编辑分离

读取参考图、确定性图片处理、生成新图和 AI 编辑原图是不同能力。当前只实现参考图读取、独立全局新图生成和图片放置。crop/adjustment 属于未来 Image service；inpainting/outpainting、背景替换、重打光和风格统一属于未来独立编辑 adapter/tool。编辑必须产生带来源关系的新 asset，禁止覆盖原图。

## 验证与后续

- manifest 单测覆盖严格校验、唯一 ID、不可变快照、状态派生和 Agent 有界投影。
- Agent 测试覆盖 system summary、只读 tool schema、本地执行且不向 Main 发消息。
- 生成器同时维护帮助文档和发布摘要，CI/本地 verify 拒绝漂移。
- P0-C 后续仍需固定企鹅/海报样张、渲染诊断和 macOS/Windows 实机证据；取得证据前清单保持 degraded/unavailable。
- P1 再把当前构建时 manifest 提升为 Main/MCP 可查询的公共只读契约，并为未知能力、fidelity warning 与 provider adapter 增加跨进程协议。
