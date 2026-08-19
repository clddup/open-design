# ADR-0097：基于生产文字布局证据的截断质量门禁

- 状态：Accepted
- 日期：2026-08-19
- Text Layout Quality Evidence：`1`
- Layout Quality：`DesignLayoutQualityReport 4`
- 文档协议：不变
- 关联：ADR-0034、ADR-0074、ADR-0082、ADR-0096

## 背景

Text 节点矩形完全位于交付 Frame 内，不代表用户能看到完整文字。Fixed Text 可以在 `textOverflow=clip` 且没有 ending truncation 时静默隐藏 canonical content；显式 `textTruncation=ending` 又可能是列表摘要、卡片标题等有意设计，不能与无声明裁剪一律作为 error。

字符数、字号乘积、节点名称或截图 OCR 都不能确定 shaping 后的真实占用。OpenDesign 已经由固定 Leafer 文字 provider 负责普通 Text，由 text-run provider 负责 rich text、段落和列表。capture 若再使用另一套估算器，会形成与生产渲染漂移的第二份布局事实。

## 决策

### 离屏 capture 产生版本化文字证据

Frame capture 创建生产 Leafer adapter 后，使用该 adapter 的 plain-text provider，以及与 rich-text projection 相同的 composed text-run provider，遍历目标 Frame 的 Text 后代并生成 `TextLayoutQualityEvidence v1`。证据绑定 `documentId/revision/pageId`，每个 node 记录：

- provider 与 provider version；
- 权威 Text box 尺寸；
- 禁用 truncation 后的完整内容尺寸；
- 按当前 ending/maxLines 策略得到的显示内容尺寸；
- horizontal/vertical overflow 与是否实际发生 ending truncation。

普通 Text 的 `none` wrap 用 Auto Width 测完整内容，word/character wrap 用相同权威宽度的 Auto Height 测完整高度。Rich Text 使用生产 text-run provider 的 `contentBounds`，不按 base font 猜测。证据只是一份 exact-revision 可丢弃投影，不写入 `DesignDocument`、history 或 save。

### Layout Quality Report v4 判定

Renderer 把证据与同一不可变文档交给确定性布局质检：

- visible Fixed Text 的完整内容超过 box，且 `textOverflow=clip`、`textTruncation=disabled`：`text-content-clipped` error；
- visible Text 的 provider 证据丢失、过期、box 不匹配或与当前 resize/truncation 语义矛盾：`text-layout-evidence-unavailable` error；
- Fixed Text 明确使用 visible overflow 且内容越过 box：`text-content-overflow` warning；
- 明确 `textTruncation=ending` 且 provider 证明内容实际被缩短：`text-ending-truncation-active` warning。

Error 阻止 refined target 进入 verified。Ending warning 不表示失败；模型只在交付语义受损时改写文字、扩大 box 或调整布局。隐藏 Text 不要求证据，也不计入 `checkedTextNodeCount`。

不新增 Plan 版本。是否允许 ending、clip 或 visible overflow 已由持久 Text 属性显式表达；本切片验证这些声明是否真的隐藏内容，不让模型另交一份可能冲突的文字策略。

### 失败关闭与边界

Rich Text ending truncation 当前不是 text-run provider 的受支持能力，因此证据返回 unavailable 并阻止交付，不能退回字符估算或把 base-style fallback 冒充 rich-text 质量。证据和 issue 列表继续有界，质量报告仍由 Main 校验 exact document/revision/Page/Frame/profile 身份。

## 后果与限制

- 可以稳定发现“矩形没越界但正文被固定高度吃掉”的假通过。
- 显式 ellipsis 与静默 clip 分层，不会因所有截断都报 error 而迫使设计无限扩高。
- capture 会增加一次有界文字测量；只遍历目标 Frame，普通 Text 通常一次测量，只有带 maxLines 的 ending Text 需要完整/显示两次测量。不会增加 Provider/LLM 往返。
- 首版不证明字形像素、字体授权、OCR 可读性或文案质量；缺字仍由既有 font/fidelity warning 链处理。
- 交互目标遮挡/重叠、对齐/间距异常和 visual critic 仍是后续独立切片。

## 验证

- Text evidence validator 覆盖 exact keys、身份、尺寸和重复 node；
- Leafer 检查器测试覆盖 Fixed silent clip、显式 maxLines ending、rich-text content bounds 和 unsupported ending fail-closed；
- EditorRuntime 测试覆盖 error/warning 分流、测量回传、缺失证据和 report v4 runtime validator；
- Renderer capture/tool 测试证明同一 capture 把 provider evidence 交给 exact-revision Layout Quality Report；
- Main 既有 final `errorCount === 0` 门禁继续阻止静默裁剪交付。

## 复审条件

text-run provider 支持 ending truncation、引入 text-on-path、可变字体轴、竖排文字、跨 Frame flow text 或需要按 locale/preset 配置可读性策略时复审。任何扩展仍必须消费生产 shaping 证据，不回退字符估算。
