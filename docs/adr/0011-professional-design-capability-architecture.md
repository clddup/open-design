# ADR-0011：专业设计能力由开放语义与可替换成熟服务承载

- 状态：已接受
- 日期：2026-08-10
- 补充：ADR-0005、ADR-0009、ADR-0010
- 取代：把所有未覆盖专业能力继续塞入 Renderer/Leafer adapter，或为补齐能力恢复旧编辑器/旧渲染后端的隐含路径

## 背景

将生产画布迁移到 LeaferJS 解决了手写 viewport、命中、选择器、变换框和基础绘制的问题，但 Leafer 是图形与交互引擎，不是完整的 Figma/Canva 类设计产品。专业设计还需要路径布尔与节点编辑、吸附、布局、富文本、组件/变量、图片处理、导入导出和交付能力。

如果每次只在现有 schema 中为用户点名的效果增加一个字段，产品会形成不可组合的补丁集合；如果由 React、Leafer adapter 或 Agent 各自实现计算，又会产生第二份事实状态、重复算法和不可验证结果。恢复 OpenPencil、Canvas2D 或其他完整编辑器作为 fallback 同样会重新引入双写和产品边界冲突。

## 决策

### 完整能力基线先于单项实现

[`../design-capability-baseline.md`](../design-capability-baseline.md) 定义 OpenDesign 必须覆盖的完整专业设计能力。交付可以分阶段，但公共协议不得把尚未交付的能力永久封死，也不得把单个已投影效果描述成完整专业支持。

OpenDesign 建立独立版本的 capability manifest。每项能力记录稳定 ID、状态（`available`、`degraded`、`unavailable`）、provider、限制和验证证据。UI 与 Agent 只执行当前可用能力；产品规划仍能看到完整必需范围。

### OpenDesign 拥有语义，成熟服务负责专业计算

职责固定如下：

- **OpenDesign Contracts/EditorRuntime**：文档 schema、节点语义、资源引用、事务、revision、diff、history、selection、迁移和能力声明。
- **Leafer adapter**：场景投影、绘制、DPR、viewport、坐标、命中、选择、变换控制与文本内编辑。
- **Geometry service**：正式路径数据、节点/手柄计算、布尔运算、flatten、outline stroke 与几何诊断。
- **Layout service**：constraints、auto layout、grid、sizing 和响应式求解；输出确定性布局结果或事务。
- **Text/font service**：富文本、字体解析、shaping/metrics、缺失字体与字体资产生命周期。
- **Image service**：解码、crop、调整、滤镜、资源变体和导出准备。
- **Import/export services**：格式解析、保真报告、批量导出和交付产物。

路径布尔、专业布局、文字 shaping、图片处理和格式转换优先采用经过维护、许可和兼容性评估的成熟开源库或平台能力，通过窄 adapter 接入。不得在 React 组件、Agent prompt 或 Leafer adapter 中重新手写底层引擎。

### 单一写入面保持不变

所有服务只接收版本化、可序列化输入，并返回纯结果、诊断或候选 `DesignOperation[]`。它们不持久化第二份设计文档，不直接修改 Leafer 场景作为最终状态，也不获得项目路径、凭据或 Agent 权限。

人工 UI、Agent、MCP、导入器和专业计算服务产生的设计变更全部进入唯一 `EditorRuntime.apply(DesignTransaction)`。第三方私有对象、内存句柄和私有 JSON 不进入公共文档、工具 schema 或持久化文件。

### 旧迁移已经关闭

OpenPencil、旧 Canvas2D 产品包和手写 React 画布交互已经从可执行依赖、构建入口和发行资源移除。未完成的专业能力通过上述服务边界继续实现，不再与旧编辑器移除门禁绑定，也不能成为恢复 fallback、双写或隐藏入口的理由。

## 协议演进

下一次文档协议升级应作为一个完整的专业基础版本，至少共同设计：正式 Vector/Path/Line/Polygon/Star、layout/constraints、rich text/font、image crop/adjustments、Component/Instance/Variant、style/token binding 和 export settings。

升级必须包含确定性迁移、未知版本失败、保存重开、preview、undo/redo、Agent schema、provider 映射和 fidelity warning。`extensions` 只用于真正的 namespaced 扩展，不能作为未设计公共语义的长期后门。

## 结果

### 正面结果

- 产品能力由完整基线和依赖关系驱动，不再由零散反馈决定 schema。
- OpenDesign 保持唯一事实状态，同时可以组合成熟图形、布局、文字、图片和格式生态。
- 引擎或算法 provider 可以替换，不改变设计文档、事务或 Agent 工具边界。
- 能力状态和保真证据可被 UI、Agent、测试和发布说明共同使用。

### 代价与风险

- 需要维护多个窄 adapter、版本兼容和跨 provider 基准。
- 专业语义必须在接入具体库之前设计清楚，前期成本高于直接泄漏第三方对象。
- 不同库的坐标、文字、颜色和格式语义可能不一致，必须显式归一化并返回 fidelity warning。
- 新依赖扩大许可证、包体积、原生构建和跨平台验证成本。

## 验证

- capability manifest 与实际可达 UI/Agent/adapter 行为一致，未知能力拒绝且降级有说明。
- 每个专业垂直切片覆盖 schema → migration → runtime → human UI → Agent → provider → persistence/export → undo/redo。
- 同一输入在固定 provider 版本上产生确定性结构结果；升级必须通过 fixtures、视觉/格式回归和性能基准。
- 依赖审计证明第三方类型只存在于对应 adapter/service 包，Renderer、Agent 和公共 contracts 不泄漏私有对象。
- 仓库、构建图和发行资产不包含 OpenPencil、旧 Canvas2D 或手写选择框 fallback。
