# ADR-0280：Figma-compatible 普通对象 resize 吸附

## 状态

已接受。

## 背景

ADR-0278 已完成普通对象移动时的对象、手工参考线与像素网格吸附，但同一组选项尚未作用于 resize。用户拖动八向 resize handle 时仍只能自由调整边界，无法像 Figma 一样让当前活动边命中对象外边缘、中心、Page/Frame guide 或像素网格。

Resize 与 move 不是同一几何问题：只有被拖动的边可以成为候选，对边或中心必须保持固定；Shift 比例锁定和 Option/Alt 中心 resize 还要求多个轴使用同一 scale。把 move resolver 套在 selection bounds 上会错误吸附非活动边并破坏比例。

## 决策

1. `@opendesign/geometry-service` contract 34 增加后端无关的 resize snap resolver。输入显式包含活动横/纵边、中心 resize、比例锁定、raw bounds、target index 与阈值；输出校正 bounds、稳定命中和 smart-guide lines。
2. move 与 resize 共用唯一 target builder：对象外边缘/中心、Page guides、共同祖先中轴对齐的 Frame-local guides，以及 `5 / zoom` 的文档空间阈值。选区及其后代继续排除，多选按 top-level union bounds 处理。
3. Leafer 通过公开 `editor.beforeScale` 在本帧变换写入前修正 `scaleX/scaleY`，不在 resize 后回滚或累计 correction。Pointer up 继续走既有 DirectTransform → DesignTransaction → EditorRuntime，只形成一个 revision/undo。
4. 八向 handle 只吸附活动边。Shift 使用统一比例 correction；Option/Alt 以 selection center 为 origin；`Control` 暂停对象与 guide 吸附但保留 pixel grid。左右修饰键与 blur 复用现有 direct-transform modifier session。
5. Leafer 默认用 `Control/Command + resize handle` 切换 rotate/skew，这与 Figma 的临时关闭吸附冲突。OpenDesign 禁用该隐式 `rotateKey`，旋转仍使用已有外侧 rotate handles。
6. Grid Fill child 的语义 span resize 继续由 Grid session 独占；Line endpoint drag 继续由 LineEditTool 处理。旋转或倾斜 selection 当前保持原有自由 resize，但不做基于 AABB 的错误吸附。
7. Smart guides 保持 editor-sky disposable overlay，不进入 DesignDocument、history、capture 或 export。本切片不增加文档字段、Agent tool 或第二份可写状态。

## 影响

- 轴对齐普通对象与多选可在四边和四角 resize 时命中对象、Page/Frame guide 与 pixel grid，并保留中心/比例语义。
- 非法、翻转、零尺寸、旋转/倾斜和专用 Line/Grid 路径失败开放，不阻塞原有 resize。
- Vector geometry snapping、旋转/倾斜对象的定向 resize snapping、guide-to-object redline、大型文档性能基线与 macOS/Windows 打包产品实机证据仍待后续。

## 公开语义参照

- [Figma：Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
- [Figma：Scale layers while maintaining proportions](https://help.figma.com/hc/en-us/articles/360040451453-Scale-layers-while-maintaining-proportions)
