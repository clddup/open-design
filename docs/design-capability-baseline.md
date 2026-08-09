# OpenDesign 专业设计能力基线

> 本文定义产品必须覆盖的完整专业设计能力，不是按用户反馈逐项追加的愿望清单。实现可以分批交付，但文档协议、事务、引擎适配和 UI 不得把未交付能力永久封死。当前状态以磁盘代码和实际验证为准，宣传页与第三方引擎能力说明不能代替验收。

规范架构见 [ADR-0011](adr/0011-professional-design-capability-architecture.md)，实施顺序见 [`roadmap.md`](roadmap.md)。

## 1. 状态定义

- **已实现**：存在可达产品路径，并有至少一层自动化验证。
- **部分实现**：基础语义或单一路径已存在，但还不能完成正常专业工作流。
- **待实现**：属于产品基线，但当前没有可用产品路径。
- **待实机验证**：代码与自动化测试已存在，但关键渲染或直接操作尚未在本工作区 Electron 中复验。

任何“支持”声明至少要同时回答：公共语义是否可表达、事务是否可撤销、人工 UI 是否可操作、Agent 是否可调用、渲染/导出是否保真、保存重开是否一致。只满足其中一项不得描述为完整支持。

## 2. 固定架构

```text
OpenDesign DesignDocument / DesignTransaction / revision / history
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
       Leafer Adapter   Geometry Service   Layout/Text/Export Services
       场景与直接操作     路径与布尔计算       专业语义计算与格式边界
             │                │                │
             └────────────────┴────────────────┘
                              │
                    唯一 EditorRuntime.apply()
```

- OpenDesign 始终拥有可持久化文档、节点语义、稳定 ID、事务、revision、diff、history、selection 和能力声明。
- `leafer-editor@2.2.9` 是唯一生产画布和直接操作引擎，负责场景、渲染、DPR、命中、viewport、选择、变换和文本内编辑。不得恢复 Canvas2D、手写选择框或双写场景。
- Leafer 是图形与交互底座，不承担组件、变量、自动布局、设计系统、Agent 权限或 OpenDesign 文件格式。
- 路径布尔、专业布局、文字排版、图片处理、导入导出等能力应优先采用经过评估并固定版本的成熟开源库或平台能力，通过窄 adapter 接入；不得再次手搓底层引擎。
- 第三方对象和私有 JSON 不得进入公共文档或 Agent/MCP 工具参数。计算服务只读取版本化输入并返回可验证结果或 `DesignOperation[]`。
- 新依赖必须记录固定版本、来源、许可证、第三方通知、能力基准和失败行为。引擎或公共语义变化必须更新 ADR 和迁移测试。

## 3. 完整产品能力矩阵

| 领域              | 正常工作必须覆盖的能力                                                                                                                                     | 2026-08-10 当前状态                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 文档与页面        | Workspace → Project → Design File → Page → Frame/Artboard → Layers；多 Page、稳定 ID、保存/重开、revision、冲突、撤销/重做                                 | 多 Page、项目/文件持久化、事务、revision、history 已实现；跨目标冲突 UX 仍为部分实现                                                   |
| 画布与导航        | 大画布、pan/zoom、fit page/selection、框选、多选、组内进入、键盘导航、高 DPI、窄窗口、恢复 viewport                                                        | Leafer 路径已实现主要能力；Agent 渐进更新后的 editBox 刷新修复待实机验证；专业标尺/参考线/像素预览待实现                               |
| 图层与结构        | 创建、选择、重命名、锁定、隐藏、复制、删除、编组/解组、层级移动、跨容器移动、批量操作、搜索                                                                | 通用 insert/update/move/delete/replace 事务已实现；完整人工命令和键盘工作流需逐项审计补齐                                              |
| 基础图形          | Frame、Group、Rectangle、Ellipse、Line/Arrow、Polygon、Star、自由 Path/Vector、Slice/导出区域                                                              | Frame/Group/Rectangle/Ellipse 及 Path 渲染已存在；Line/Arrow/Polygon/Star、Slice 与正式 schema 待实现                                  |
| 矢量编辑          | Pen、节点/手柄编辑、开放/闭合路径、节点类型、路径反转、连接/断开、布尔 union/subtract/intersect/exclude、flatten、outline stroke                           | 待实现；必须接成熟 geometry kernel，不在 React 或 Leafer adapter 中手搓                                                                |
| 精确变换          | x/y/w/h、旋转、倾斜、翻转、原点、等比、批量缩放、对齐、分布、等间距、智能吸附、像素对齐                                                                    | Leafer move/resize/rotate/skew 已接事务；对齐/分布/吸附/翻转等完整命令集待实现                                                         |
| 外观与合成        | 多 fill/stroke、纯色、线性/径向/角度渐变、图片填充、透明度、blend、描边位置/cap/join/dash、圆角、阴影、内阴影、光晕、模糊、灰度、蒙版、clip                | `DesignDocument 1.1.0`、EditorRuntime、属性面板和 Leafer 映射已实现主要语义；复杂组合的视觉与导出保真待实机/基线验证                   |
| 颜色系统          | Color picker、HEX/RGB/HSL/alpha、渐变编辑器、吸色、最近色、共享颜色样式、变量绑定、色彩空间与无障碍对比                                                    | 基础颜色输入和渐变 stop 已实现；专业 picker、吸色、共享样式/变量、色彩空间待实现                                                       |
| 文字              | 文本框、自动宽/高、基础字体属性、段落对齐、文字内编辑、富文本 runs、列表、缩进、装饰、大小写、OpenType/variable font、文本样式、缺失字体替换、text-on-path | 基础单样式文本与 Leafer TextEditor 已实现；其余专业排版和字体资产管理待实现                                                            |
| 图片              | 选择/粘贴/拖放/路径/URL 导入、内容寻址 asset、嵌入画布、fit、crop、焦点、蒙版、替换、滤镜、调整、透明背景、大图资源生命周期                                | attachment、`read_image`、事务化 asset/image node、`place_image` 和基础 fit 已实现；集成测试与实机验证未完成；crop/调整/替换 UI 待实现 |
| 布局与响应式      | constraints、anchor、horizontal/vertical auto layout、wrap、padding/gap、对齐、hug/fill/fixed、min/max、absolute child、layout grid、响应式断点            | 待实现；不能直接把 Leafer Flow 私有状态作为文档事实，需 OpenDesign layout schema + 可替换 solver                                       |
| 组件与设计系统    | Component、Instance、detach、nested instance、property/override、Variant/State、样式、token/variable、collection/mode、alias、发布/更新                    | 文档仅有占位容器，不能描述为已支持；需正式 schema、解析器、事务、检查器和 Agent 工具                                                   |
| 原型与交互        | 页面连接、触发器、动作、overlay、scroll behavior、transition、preview                                                                                      | 文档只有占位容器；待实现，不属于当前渲染画布的隐式职责                                                                                 |
| 资源与字体        | 图片/字体/二进制资源、去重、引用计数、替换、失效恢复、资源浏览器、字体加载与授权                                                                           | 图片 asset 与引用删除保护已实现；字体和资源工作台待实现                                                                                |
| 导入              | OpenDesign native、SVG、PNG/JPEG/WebP/GIF、PDF、剪贴板矢量/位图；后续按明确需求评估 Figma/Sketch                                                           | native 文档和 Agent 图片附件链部分实现；设计格式导入管线待实现                                                                         |
| 导出与交付        | PNG/JPEG/WebP/SVG/PDF、多倍图、选区/Frame/批量导出、透明背景、颜色配置、token、开发检查、资源切图                                                          | 公共接口仅有早期骨架；完整产品路径待实现，不能把画布截图当专业导出                                                                     |
| 历史与恢复        | 原子事务、连续手势合并、Agent 渐进预览、取消回滚、undo/redo、checkpoint、崩溃恢复、版本对比                                                                | 单文件核心已实现；Agent 渐进事务与取消有测试；跨文件与可视化版本对比待实现                                                             |
| Agent 设计能力    | 读取文档、结构化事务、作用域、revision、图片多模态读取/放置、语义化专业命令、预览/审批、进度、取消、审计                                                   | inspect/apply/read_image/place_image 基础路径已存在；专业高层工具、完整 Capability/Approval/Audit/Sandbox、网页 fetch/capture 待实现   |
| 性能与可靠性      | 万级节点、增量投影、资源释放、长任务取消、Agent 并发时画布响应、内存/帧率基准、上下文丢失恢复                                                              | Leafer 增量复用和基础错误路径已实现；正式节点/图片/效果基准与恢复测试待建立                                                            |
| 可访问性与桌面 UX | 快捷键、焦点恢复、菜单、状态不只靠颜色、缩放/主题/语言、键盘操作、可取消长任务                                                                             | 工作台与部分控件已覆盖；所有新增专业命令必须同步补键盘、焦点、错误和窄窗口验证                                                         |

## 4. 协议演进要求

下一次文档协议升级必须是一个完整的“专业基础语义”版本，而不是为单个 UI 控件加字段。至少统一设计并迁移以下内容：

1. 正式 Vector/Path/Line/Polygon/Star 节点，不再用无类型 `JsonObject` 作为长期实现。
2. constraints、sizing、auto layout、grid 与 absolute child 语义。
3. 富文本 runs、paragraph、font axis、text style 与字体引用。
4. 图片 crop/focal/adjustments 和可组合 mask 语义。
5. Component/Instance/Variant/Override，以及 style/token/variable binding。
6. export settings 与可重复的导出目标。
7. 独立版本的 capability manifest，明确每项能力的 `available / degraded / unavailable`、provider、限制和验证证据。

协议升级必须提供确定性迁移、未知版本拒绝、保存重开、undo/redo、Agent schema、Leafer 投影和 fidelity warning 测试。不得为了提前显示 UI 而把未定义结构塞进 `extensions`。

## 5. 交付方式

后续实现仍可按垂直切片推进，但每个切片都必须从上表选择一个完整工作流，并同时打通：

```text
schema → migration → EditorRuntime → human command/UI → Agent tool →
provider adapter → render/export → persistence → undo/redo → tests
```

优先顺序不是用户点名顺序，而是依赖顺序：

1. 稳定 Leafer 画布、图片和当前 `1.1.0` 基线。
2. 建立 capability manifest 与专业节点/服务边界。
3. 图层命令、精确变换、矢量与吸附。
4. 布局/响应式、组件/变量和专业文字。
5. 导入导出、交付、原型与性能门禁。

任何阶段都不得通过恢复旧引擎、建立第二份可写状态或让模型直接控制 Leafer 内存来缩短路径。
