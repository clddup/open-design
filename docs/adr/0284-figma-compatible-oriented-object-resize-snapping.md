# ADR-0284：Figma-compatible 单对象仿射 resize 吸附

## 状态

已接受。

## 背景

ADR-0280 已让轴对齐普通对象与多选在 resize 时命中对象、Page/Frame 参考线和像素网格，但旋转或倾斜对象会直接退出吸附。继续把这类对象的 world AABB 交给轴对齐 resolver 会把活动边、固定边和 scale correction 都算错；视觉上接近目标也不能以错误几何换取“看起来支持”。

Leafer 的 `beforeScale` 提供当前 local resize scale，真正写入仍围绕编辑框 origin 发生。宿主因此需要在对象的完整 affine basis 中求 local scale correction，再用 document-space 目标和 smart guide 表达命中。

## 决策

1. `@opendesign/geometry-service` contract 38 增加后端无关的 oriented resize resolver。输入为 local bounds、完整可逆 local-to-document transform、活动边、中心/比例语义、raw scale、既有 target index 与屏幕换算阈值；输出校正后的 `scaleX/scaleY`、稳定命中与 axis target smart guides。
2. Resolver 不从 affine matrix 猜 rotation angle。它直接以 matrix 两个 basis vector 计算活动 handle 的 document-space 位置和对 local `scaleX/scaleY` 的导数，因此 rotation、non-uniform scale 与 skew 使用同一条数学路径。
3. 单边 handle 只解一个 local scale；自由 corner 可解 x/y target 的二维交点；Shift 或对象自身比例锁定把两个 local scale 收敛为一个自由度；Option/Alt 中心 resize 使用真实 local center origin。不可逆 transform、翻转、零尺寸、超阈值和非有限输入失败开放。
4. Leafer 只对单个非 Line 普通对象启用 oriented resolver。轴对齐单选与多选继续使用 ADR-0280 的 bounds resolver；不同 orientation 的多选不伪造共同定向框。Line endpoint 与 Grid span 继续使用各自语义路径。
5. 对象、Page guide、当前可表示的轴对齐 Frame-local guide、pixel grid、`5 / zoom` 阈值和 `Control` 临时关闭继续复用唯一 target/session。目标命中只修正本帧 `beforeScale` 结果，不做事后回滚。
6. Pointer up 继续沿既有 DirectTransform 形成一个 DesignTransaction、revision 与 undo。Smart guide 仍是 editor-sky disposable overlay，不进入文档、history、capture 或 export；本切片不增加文档字段、Agent tool 或偏好项。

## 影响

- 单个旋转、轴缩放或倾斜普通对象可以从四边和四角沿真实 affine 方向 resize，并命中对象、Page guide 与 pixel grid。
- 比例锁定、中心 resize、左右 `Control`、viewport 阈值刷新、取消和连续 revision 生命周期与轴对齐 resize 一致。
- 不同 orientation 多选、旋转 Frame-local guide、path/handle 吸附和 macOS/Windows 打包产品实机证据仍待后续。

## 公开语义参照

- [Figma：Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
- [Figma：Scale layers while maintaining proportions](https://help.figma.com/hc/en-us/articles/360040451453-Scale-layers-while-maintaining-proportions)
