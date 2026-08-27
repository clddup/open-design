# ADR-0205：图片编辑 Prepared Source 单一契约

## 状态

已接受。

## 背景

AI 图片编辑在调用外部图片服务前，Renderer 会从当前 DesignDocument 读取明确 Page/Image node 和 expected asset，向 Main 返回嵌入图片、placement 与 target size。该结果此前通过 `isPreparedImageEditSource()`、`isBoundedEmbeddedImageAsset()`、`isRecord/exactKeys` 和多个手写字段判断校验，与已经 Contract 化的公开/内部图片工具输入形成平行事实源。

## 决策

1. 独立 `design-agent-image-result-contract.ts` 拥有 `BoundedEmbeddedImageAssetSchema/Contract` 与 `PreparedImageEditSourceSchema/Contract`，不继续扩大已有大型图片工具输入文件。
2. Schema 组合 canonical `DesignAssetSchema` 与 `ImagePlacementSchema`，并负责 closed object、稳定 ID、图片 MIME、嵌入 base64、正尺寸、placement union 和 24 MB 边界。
3. 唯一 domain refinement 只负责 `asset.id === expectedAssetId` 的 stale-write identity。
4. 原 `isPreparedImageEditSource()` 与 `isBoundedEmbeddedImageAsset()` 只保留为 Contract 布尔薄投影；internal image provenance refinement 继续复用后者，不复制资产规则。
5. Main 图片编辑 handler 直接解析 Contract，并把准确字段路径返回到工具失败；非法 prepared source 不调用外部图片服务、不产生 revision。

## 结果

- Renderer bridge、Main image edit 与 internal image update 使用同一 prepared source 结构事实。
- 外部路径冒充嵌入 source、非法 placement/size 与 asset identity 漂移获得稳定路径。
- 删除图片 prepared source 的手写 `isRecord/exactKeys/isPositiveSize` 遍历，不增加 Provider 工具或模型往返。

## 验证

- 合法 embedded Image asset、Fit placement 与正 target size 通过 Contract。
- external source 精确定位 `/asset/source/type`。
- 非正 target width 精确定位 `/targetSize/width`。
- asset identity 漂移精确定位 `/asset/id`。
- Main 在 malformed prepared source 上返回结构化字段错误且不调用 image edit service。
