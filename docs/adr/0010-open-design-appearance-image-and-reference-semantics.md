# ADR-0010：开放复杂外观、图片资源与多模态引用语义

- 状态：已接受
- 日期：2026-08-09
- 关联：ADR-0006、ADR-0009
- 文档协议：`1.1.0`

## 背景

仅把 Canvas2D 替换为 LeaferJS 仍不足以形成通用设计平台。原 `1.0.0` 文档协议只定义纯色 Paint、统一描边宽度和节点 opacity；即使 Leafer 支持渐变、阴影、光晕、模糊、混合、蒙版与图片填充，Agent、属性检查器和保存格式也无法表达这些能力。原附件链可以把选择器选中的图片发送给多模态模型，但不能从剪贴板/拖放导入，模型也没有按需读取用户明示路径或 URL 的工具，更不能把已读图片作为 durable asset 放入设计图。

## 决策

### 复杂外观属于 OpenDesign 协议

`DesignDocument 1.1.0` 增加引擎无关的外观语义：

- Paint：纯色、线性/径向/角度渐变、项目图片填充；多色标、独立透明度、可见性与 paint blend mode。
- Effect：投影、内阴影、外发光、内发光、图层模糊、背景模糊与灰度。
- 节点：blend mode 与 alpha、luminance、clipping、outline mask mode。
- 描边：align、cap、join 与 dash pattern。

这些字段通过 `update_properties` 进入唯一 `EditorRuntime`，Leafer 只负责投影和绘制。属性检查器与 Agent 使用相同字段，不保存 Leafer JSON。`1.0.0` 文档在读取/normalize 时确定性升级到 `1.1.0`；未知旧版本拒绝，迁移不会静默改写源文件，直到用户正常保存。

### 图片是事务化 DesignAsset

文档事务增加 `put_asset` 与 `delete_asset`。导入图片和插入 image node 可以位于同一事务、revision 与撤销记录。删除仍被节点或 image paint 引用的 asset 必须失败。图片进入 durable Design File 时使用 `assetId` 和受支持的数据源；节点不保存原始本地路径，移动或重开项目不依赖原文件位置。

模型不能在通用 `opendesign_apply_transaction` 中自行提交 asset 数据。图片导入使用专用 `opendesign_place_image`：Main 验证 run 授权的 attachment，读取内容寻址存储，构造受信任的内部 asset + node 事务，再交给 Renderer 的同一 `EditorRuntime`。内部事务入口不注册给模型。

### 路径、URL 与剪贴板统一为 Reference

用户选择、粘贴或拖入的文件先成为内容寻址 attachment。用户在当前 prompt 中明示的绝对本地路径、`file:` URL、HTTP(S) 图片 URL，以及当前 run 的 attachment ID，可以由模型按需传给 `opendesign_read_image`：

1. Agent 决定何时调用工具，不由 Main 预先替模型读取或识别。
2. Main 只接受当前 run 用户 prompt 中精确出现的 source 或当前 run 已批准的 attachment ID；不得枚举目录、猜测相邻文件或扩大 root。
3. 本地读取限制为单个支持的图片；远程读取不携带 Cookie、认证头或用户凭据，并限制协议、重定向、超时与 16 MB 大小。
4. 结果写入内容寻址 attachment store。durable tool result 保存 attachment metadata；Model Gateway 在下一轮为具体 provider 解析成真实多模态图片块。
5. 工具读取成功不等于图片已进入设计文档；只有 `opendesign_place_image` 成功事务才改变画布。

网站视觉参考后续使用同一 Reference 模型增加受控 `fetch_reference` 与隔离的 `capture_reference`。HTML fetch 与网站截图必须区分；前者不能被描述为已经看见页面设计。

## 安全与开放性的平衡

开放的是设计语义和显式授权的引用能力，不是裸文件系统、浏览器登录态或通用网络执行权。Main 继续拥有路径规范化、内容读取、网络代理、attachment 完整性校验和审计；Renderer、Agent Runtime、skills 与 MCP 只接触稳定 ID、用户明示 reference 和 typed tools。

## 验证门禁

- 契约接受复杂 Paint/Effect，拒绝越界 stop、opacity、radius 和未知字段。
- `1.0.0 → 1.1.0` 迁移可重复且不接受未知旧版本。
- 渐变、光晕、模糊、混合与蒙版投影到固定 Leafer 2.2.9 数据并保留透明度。
- asset + image node 原子应用、undo/redo、保存/重开与被引用 asset 删除失败均有测试。
- 未在 prompt 明示的路径/URL 读取失败；本地和远程图片读取成为内容寻址 attachment。
- tool 返回图片在下一模型轮次表现为多模态 image block，而不是只有文件名或 base64 JSON 文本。
- 剪贴板和拖放导入不向 Renderer 暴露文件系统读取能力。
