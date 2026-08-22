# ADR-0132：可恢复图片资源派生谱系

- 状态：Accepted
- 日期：2026-08-22
- 文档协议：`DesignDocument 1.42.0`
- Image Service：contract 3（不变）
- 关联：ADR-0129、ADR-0130、ADR-0131

## 背景

OpenDesign 已有内容寻址 Image asset、非破坏裁剪与调整，但人工和 Agent 的来源替换会在旧 asset 不再被节点或 Style 直接引用时删除旧字节。用户因此无法恢复原图，后续去背景、擦除对象、扩图和提示词编辑也没有可靠方式表达“原始资源 → 派生结果”。把单一 `sourceAssetId` 写入 `DesignAsset` 会破坏内容身份：同一结果字节可能由多个来源、遮罩或参考资源得到，修改 provenance 也不应改变 asset 内容身份。

Figma 的公开 Plugin API 把图片作为按内容 hash 存储的对象；图片修改示例会从原 hash 读取字节、创建新 Image/hash，再让 Image Paint 指向新 hash。公开 API 没有提供完整 AI 编辑谱系，因此 OpenDesign 采用公开可验证的内容寻址行为，同时自行建立非破坏恢复所需的文档语义，不宣称复制 Figma 私有实现。

## 决策

### 内容 asset 与来源谱系分离

`DesignDocument 1.42.0` 增加有序 `imageAssetDerivationOrder` 与 `imageAssetDerivationsById`。每条稳定 derivation 保存一个 source/result edge、typed operation、可选 prompt、可选 mask asset、有界 reference assets 和 extensions。operation 覆盖 replacement、remove-background、erase-object、isolate-object、expand、upscale、prompt-edit、relight 与 style-harmonize。

source、result、mask 与 reference 都必须指向当前文档中的 Image asset；source/result 不得相同，result 不能同时作为本次输入，整个 source→result 图必须无环，order/store 必须完整一致。`1.41.0` 及更早文档确定迁移为空谱系，不猜造历史关系。

### 唯一事务维护谱系和当前引用

EditorRuntime 增加 `put_image_asset_derivation` 与 `delete_image_asset_derivation`。删除 asset 时同时检查节点、Text/Image Paint、local/imported Paint Style 和 derivation 引用。删除一个无人使用的 source family 时，先删除该 family 的 derivation edges，再删除所有 source/result assets，作为一笔 revision 和一个 undo；仍被节点、Style 或外部 derivation input 使用时失败关闭。

人工 Image Inspector 与文件级 Assets 替换不再清理旧 asset。替换操作原子放入新 asset、记录 replacement edge 并更新节点或全部受支持引用。已有 family 版本切换只更新引用，不复制字节或创建伪 derivation；请求必须携带 expected current asset，当前来源变化后返回 stale。placement、filters、尺寸和其他节点属性保持不变。

### 人工与 Agent 使用同一恢复边界

Image Inspector 只在存在多个 family 版本时显示紧凑 Source version 选择与 Restore original。Assets 面板把原图和派生结果按 family 相邻排列，标明 Original/派生 operation 和版本数量；无人使用时可一次删除完整来源历史，不把每个版本伪装成无关垃圾 asset。

`opendesign_update_image` 的 `replace-source` 由 Main materialize 已授权 attachment，Renderer 以受信任 tool-call identity 生成 derivation ID；模型不能提交任意 provenance command。新增 `switch-source` 只接受 inspection 返回的现有 family asset ID，并要求 `expectedAssetId`。inspection 只返回有界 asset metadata 和 derivation 摘要，不返回图片字节、URI或完整 prompt。

### Library 与渲染边界

谱系不改变像素渲染；Canvas、capture 与 PNG/JPEG/WebP export 继续只消费节点/ Paint 当前指向的 asset。Component Library release 只携带渲染该 source bundle 所需的 asset bytes，不隐式复制整个文档级 derivation graph，避免消费文件出现引用不存在历史 asset 的半闭包。跨文件携带完整可编辑图片历史需要独立闭包协议后再实现。

## 后果

- 替换和后续 AI 图片编辑不再覆盖或丢弃原图，恢复、切换、undo、保存重开共用同一文档事实。
- 内容寻址 asset 保持纯内容身份；多来源、多参考和遮罩关系可用 DAG 扩展，不需要为每个 provider 增加私有 asset 字段。
- 文档会保留来源 family 的额外图片字节；用户可在无人引用时原子删除完整 family。大图按需加载、去重和外部 blob store 仍需后续资源生命周期切片。
- 本切片不接入远端去背景、扩图或局部重绘 provider；这些能力后续必须产出新 asset 并复用本谱系事务，不能绕过它直接覆写来源。

## 验证

- Design contracts 覆盖 typed operation、严格字段、`1.41 → 1.42` 迁移。
- EditorRuntime 覆盖 order/store、Image asset 引用、self/cycle 拒绝、replacement、stale-safe switch、family 删除、diff、undo 和保存重开。
- Inspector/App 与 Assets 覆盖恢复原图、来源版本展示、完整 family 删除和一次 revision/undo。
- Agent 覆盖严格 tool schema、trusted replacement、switch-source、inspection 有界摘要和通用 apply provenance 旁路拒绝。

## 参考

- [Figma Plugin API `Image`](https://developers.figma.com/docs/plugins/api/Image/)
- [Figma Working with Images](https://developers.figma.com/docs/plugins/working-with-images/)
- [Figma Plugin API `Paint`](https://developers.figma.com/docs/plugins/api/Paint/)
