# ADR-0259：Image Node 像素保真 Flatten

## 状态

接受。

## 背景

Flatten 已能把 Frame、Group、Boolean、Text outline、规则形状、Path 与 Vector 物化为一个 editable Vector，但 Image node 被整体拒绝。把图片仅转换成矩形几何会丢失 Stretch/Fit/Fill/Crop、焦点、缩放、旋转、翻转和 filters；把像素描成路径则既不保真也不可维护。

## 决策

1. `DesignDocument 1.53.0` 为 Image Paint 增加 Figma `CROP` 对应的 `fit: "crop"`。它使用既有 `scale + offset + rotation` 保存明确 source-to-target clip transform；Leafer 投影为 `mode: "clip"`，不新增第二份图片 placement 状态。
2. Image Flatten 将节点边界物化为一个 closed Vector region，并把原图片保存为 region-local Image Paint。圆角继续由精确 rounded-rectangle path 表达，图片 asset 不栅格化、不复制、不删除。
3. placement 映射固定为：Stretch → `fill`，Fit → `contain`，Fill/Crop → `crop + resolved scale/offset/rotation`。Fill/Crop 必须从权威 image asset 取得正数 source dimensions；缺失尺寸时失败关闭，不回退 Stretch。
4. Crop 的 focal point、zoom、rotation 与 horizontal/vertical flip 继续由 Image Service 唯一解析；负 scale 表示 flip。Image filters 原样移动到 Image Paint，画布、capture 与位图导出继续复用既有每-Paint 调整投影。
5. layer opacity、effect、blend 与 mask 仍由通用 Flatten compositing guard 拒绝；不能把不可交换的像素合成静默折叠进单一 region。
6. 人工 `⌘E / Ctrl-E` 与统一 Agent `flatten` action 继续复用同一 `planFlattenNodes`、宿主结果 ID、单 revision 与单 undo，不新增 Image 专用 Agent 工具。
7. Flatten 结果属于 Design File。当前 Run 失败、取消或 Provider 异常只结束本轮；同一 Conversation 的后续消息仍可读取图片 asset 并继续编辑结果 Vector。

## 结果

- Image 可与其他同父级受支持图层一起 Flatten，并保持真实 paint order、ancestor transform 与 Frame clipping。
- 结果几何可继续执行普通 Vector 编辑，region image paint 仍可调整或替换 asset。
- Image 语义被破坏性转换为 Vector + Paint，alt text 与 Image crop session 不再保留，这是用户明确 Flatten 的预期结果。
- arbitrary pixel compositing、Text 剩余边界、系统字体 outline 和真实双平台像素 baseline 仍是后续切片。

## 验证

- Contract：`fit: "crop"` schema、1.52 → 1.53 空迁移与 Leafer `clip` 投影。
- Image mapping：Stretch/Fit/Fill/Crop、focal、zoom、rotation、flip、filters、缺失 source size。
- Runtime：圆角 Image → region-local Image Paint、source 删除、结果插入、单 revision/undo。
