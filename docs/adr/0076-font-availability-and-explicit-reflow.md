# ADR-0076：字体可用性、显式替换与文字回流

- 状态：Accepted
- 日期：2026-08-15
- 文档协议：不变（`DesignDocument 1.29.0`）
- Text Service：contract v3
- Agent 协议：`3.11.0`
- 关联：ADR-0036、ADR-0070、ADR-0074
- 基线：`@figma/plugin-typings 1.133.0` 的 `FontName`、`hasMissingFont`、`listAvailableFontsAsync()`、`loadFontAsync()` 与 range font API

## 背景

Typography Core v2 已让单样式 Text、Text Style、自动尺寸、截断和段落基础语义进入同一文档、事务和渲染链，但当前字体 fallback 只作为一次 Auto Size 测量 warning 返回。Inspector 无法持续说明当前请求字体是否真正可用，用户不能把一个缺失字体在整个 Design File 中原子替换，字体后来可用时也没有显式、可撤销的 reflow 入口。直接编辑 `fontFamily` 只能修改单个节点，且不能证明使用的是当前 provider 已加载的字体。

Figma 的公共边界把字体身份与当前环境可用性分开：Text 保存 `FontName`，节点与文档报告 missing-font 状态，字体必须先加载才能写入文字属性；缺失字体下改变尺寸可能延迟到字体可用时重新排版。OpenDesign 当前只正式保存 family + numeric weight 子集，因此本切片先建立同样的事实分层和显式回流，不提前宣称完整 `FontName.style`、富文本 range、OpenType 或 variable font 支持。

## 决策

### 字体请求属于文档，可用性属于当前 provider

Text 与 Text Style 继续保存作者请求的 `fontFamily + fontWeight`。本机字体清单、浏览器加载状态、fallback 字体和权限结果不写入 DesignDocument，也不进入 revision/history。Text Service v3 增加有界 `TextFontDescriptor` 与 `available | missing | unknown` inspection；结果必须包含 provider identity/version 和明确说明。

Leafer adapter 使用与真实 Text 测量相同的 CSS descriptor 检查当前字体。浏览器 `FontFaceSet.check()` 的成功结果不能单独证明一个未注册 family 存在；默认 provider 只有在通用字体身份或对多组 fallback 的度量探针能证明目标 face 生效时返回 available，明确未就绪时返回 missing，其余返回 `unknown`。不能把“不知道”冒充 available；明确 missing 时，Auto Size 测量继续保存 fallback 的具体 bounds 并返回 fidelity warning。

### `reflow_text` 是唯一显式批量入口

公共 `DesignOperation` 增加 `reflow_text`：

- 输入稳定、有序且不重复的 Text node IDs；
- 输入每个节点必须仍匹配的 `expectedFont`，防止 stale UI/Agent 覆盖用户并发修改；
- 可选 `replacementFont`。存在时原子替换所有目标的 family/weight；省略时只对当前字体重新排版；
- 任一节点不存在、不是 Text、被自身或祖先锁定、字体身份已变化或 provider 不可用时整笔失败且零 revision；
- Auto Width/Auto Height 通过现有 Text Layout provider 重新测量，并由同一事务末尾的 Auto Layout solver 回流祖先；Fixed 保留作者的权威文字框尺寸；
- 没有任何属性或 Auto Size bounds 变化时返回 no-op，不制造空 revision。

人工 Inspector 的“替换文件中的匹配字体”直接提交该命令；Agent 使用专用 `opendesign_manage_fonts`，避免把已经接近 Provider schema 上限的通用 `apply_transaction` 继续膨胀。两条入口都复用同一 Runtime 命令，替换以一条 transaction/revision/undo entry 完成，不逐节点播放假进度。

### Inspection 与 UI 使用同一可信事实

Inspector 在所选 Text 下显示 available/missing/unknown 文本状态，而不是只靠颜色。缺失时可输入 replacement family/weight，并显示当前文件精确匹配的节点数量；提交前再次由 Runtime 校验 expected font 和锁定状态。

Agent inspection 对当前作用域内的唯一字体请求返回有界 availability 摘要。模型只能使用 inspection 中的稳定 node IDs 发起 `reflow_text`，不能声明系统字体已安装，也不能上传、读取或猜测字体路径。

### Figma interop

Interop 暴露从当前 OpenDesign family/weight 子集生成 Figma `FontName` 的确定性 helper，并明确该映射不证明目标 Figma 环境已加载字体。missing/unknown 状态不写入 Figma payload；真正导入 Figma 前仍需目标宿主调用 `loadFontAsync()`。

## 后果与限制

- 用户第一次能持续看见字体是否真正可用，并以一次可撤销操作替换整个文件中的精确匹配节点。
- 字体加载不再允许偷偷改写 Auto Size 文档几何；需要显式 reflow。Fixed Text 的运行时 glyph 外观仍可能受当前平台 shaping 影响，因此能力保持 degraded。
- 本切片不导入字体二进制，不枚举任意系统路径，不新增远程字体、第三方 parser 或凭据。`DesignAsset.kind=font` 的正式 metadata、Main 授权导入、内容寻址加载和发布许可另立切片。
- `fontStyle`、富文本 runs/range replacement、列表、OpenType、variable axes、text-on-path 和确定性跨平台 shaping 仍未完成。
- macOS/Windows 打包产品必须分别验证相同字体、缺失字体和替换后的 TTF/OTF 行为；自动化 provider 证据不能冒充双平台像素基线。

## 验证

- Text Service：descriptor/result 边界、unknown/missing/available、provider identity、memoized provider 透传。
- Leafer：同一 descriptor 同时驱动 availability 与测量 warning，unknown 不误报 missing。
- EditorRuntime：stale expected font、非 Text、缺失节点、继承锁、provider unavailable、Auto Width/Height 重测、Fixed 保持尺寸、Auto Layout 回流、no-op、preview/apply memoization、undo/redo、保存重开。
- Inspector：三种状态、替换数量、提交、取消/无效输入、键盘与错误状态。
- Agent：专用 `opendesign_manage_fonts` 覆盖合法/非法 reflow 与 replacement；完整和 Bootstrap `apply_transaction` 都不包含 `reflow_text`，inspection 返回有界字体摘要，事务仍经过完整 validator/revision/history。
- Figma interop：family/weight 到 `FontName` 的固定映射及“availability 不随 payload 持久化”边界。
