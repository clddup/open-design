# ADR-0081：受控字体二进制与 HarfBuzz 复杂脚本投影

- 状态：Accepted
- 日期：2026-08-15
- 文档协议：不变（`DesignDocument 1.30.0`）
- Text Run Layout Service：contract v2
- 取代：ADR-0079 中“复杂脚本 provider 尚未接入”的待办结论
- 关联：ADR-0036、ADR-0076、ADR-0077、ADR-0079

## 背景

ADR-0079 已证明 UTF-16 runs、原 Text edit proxy、synthetic fragment、精确 revision capture/export 边界，但固定 Leafer provider 会拒绝 Arabic、Hebrew、Indic 等上下文 shaping。继续按 grapheme 测量会把字符误当 glyph，并在 ligature、conjunct 和 bidi 上产生不可接受的错误。专业 provider 又必须获得真实字体 bytes；Renderer 扫描本机字体或接收路径会破坏既有 Main 权限边界。

## 决策

### 显式导入是唯一字体二进制入口

Main 提供 `select/list/read` 三个窄 IPC 操作。只有用户点击 Inspector 的“导入字体”才打开系统文件选择器；Main 只接受不超过 32 MB 的 TTF、OTF、TTC，校验扩展名与 SFNT magic，以 SHA-256 形成 `font_<digest>`，并在应用数据目录内容寻址持久化。Renderer 只获得稳定 ID、文件名、格式、大小和请求所得有界 bytes，不获得原始路径、目录枚举或任意文件读取。

已导入字体在后续启动中于首屏之后延迟恢复，不阻塞工作台首次呈现。Renderer 用同一 bytes 注册浏览器 `FontFace` 与 HarfBuzz registry；精确 face identity 仍由 family、style name、weight、slant 四字段决定。导入后只有精确匹配的非 Fixed Text 执行既有单事务 `reflow_text`，Fixed 保持作者文字框。

### HarfBuzz provider 输出受控 glyph outline

`@opendesign/text-service` 使用固定 `harfbuzzjs 1.4.0`，只在显式 async factory 中加载 WASM。registry 从 name table、OS/2、cmap 和 upem 验证 face；缺少精确导入 face 返回 `provider-unavailable`，不使用隐藏 fallback。

Text Run Layout contract v2 在 fragment 上增加有界 glyph 数据：glyph ID、完整文档 UTF-16 cluster、position/advance 与 SVG path。validator 限制 glyph 数、单 path/总 path 字符数、有限几何，并要求 cluster 在每个 fragment 内无空洞覆盖。ligature/conjunct cluster 不能被 line breaker 拆分；fill-only run 不建立 shaping boundary。

provider 顺序为：logical runs → Unicode bidi levels → metric/direction shaping runs → HarfBuzz clusters → cluster-aware wrapping → line-local visual reorder → positioned outline。复杂脚本 outline 路径当前只接受 original case 与无 decoration；大小写转换或 underline/strikethrough 继续明确返回 `unsupported`，直到 decoration 也成为受控几何。`bidi-js 1.0.3` 实现 Unicode Bidi Algorithm 13.0；这是当前明确 fidelity 限制，不能描述为最新 Unicode 全覆盖。

### Path 仍只是 disposable revision projection

Leafer adapter 把带 glyph 的 fragment 投影为同父级原生 `Path`，把字体坐标的 y-up outline 转为画布 y-down，并继续用 metadata 回映唯一原 Text/range。Path hit、selection、double-click edit、capture 与 PNG/JPEG/WebP export 复用 ADR-0079 的 proxy 和 exact-revision derived tree；glyph/path 不进入 `DesignDocument`、history、save 或 SVG 作者数据。

## 后果与门禁

Arabic contextual forms、Hebrew bidi、Devanagari conjunct、Latin ligature 与 UTF-16 cluster 已有真实 OFL 字体自动化证据。字体导入、内容寻址、IPC sender/参数校验、Inspector loading/success/error 与精确 reflow 已进入产品链。

这仍不升级正式 rich-text schema。用户尚不能创建 per-range runs，Agent/Figma/SVG 也不能写入或往返 runs；OpenType feature UI、variable axes、列表、text-on-path、字体随 Design File 打包、跨设备授权迁移、Unicode 13 之后 bidi 数据及 macOS/Windows 打包视觉基线继续是后续门禁。capability 保持 degraded，不能把 pre-schema provider 描述成完整富文本。

## 验证

- 真实 Noto Sans Arabic/Hebrew/Devanagari TTF 的 name/cmap/upem 与精确 face registry。
- Arabic fill-only boundary 不破坏 shaping；Devanagari conjunct cluster 不拆行；Hebrew 视觉位置与逻辑 fragment coverage 并存。
- contract v2 拒绝 cluster 空洞、越界、歧义、非有限几何和 outline 超预算。
- Leafer glyph Path 保持 source transform、baseline、原 Text 回映、编辑代理和离屏输出边界。
- Main font host 拒绝扩展名伪装，验证内容哈希、大小、持久 metadata；IPC 拒绝未知 sender、参数数量和非法 font ID。
- Inspector 覆盖 idle/importing/success/error、取消、导入和精确 reflow。
