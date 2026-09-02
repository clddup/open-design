# ADR-0290：Figma-compatible Vector Edit Pen 独立轮廓

## 状态

Accepted

## 背景

ADR-0288 与 ADR-0289 已支持在 Vector Edit 中沿现有路径插点、从节点续画，以及在另一节点完成路径。但没有选中节点时点击空白区域不会开始绘制，用户只能创建第二个 Vector layer，不能在当前 Vector Network 中建立多个独立 path。

Figma 的公开 Vector Network 说明明确指出一个 Vector layer 可以包含多条 path，并允许 Pen 连续添加 points 与 paths：

- <https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks>
- <https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>

## 决策

### 1. 空白处开始当前 Network 的新轮廓

Vector Edit Pen 处于可写状态且没有 source vertex 时：

- 第一次点击空白处只建立 session-only 起点，不提交不完整几何；
- 第二次点击空白处创建两个稳定 vertex、一个 segment 和一个开放 path；若点击现有节点，则只创建首点 vertex 并与该稳定节点连接，不生成重合副本；两者都通过既有 `onVectorEdit` 提交一次事务；
- 任一点 click-drag 都继续生成 mirrored Bézier handle；
- 成功后选择新 endpoint，可直接继续当前 path；按一次 Escape 只结束当前 path 并清空点/段选择，再次点击空白处可在同一 Network 开始下一条 path；无选择时 Escape 仍退出 Vector Edit。

Geometry Service contract 42 新增纯函数 `appendVectorContour(network, start, end)`。它只分配宿主稳定 ID、追加一个两点开放 contour，并校验完整 Network；不保存交互状态，不直接修改文档。

### 2. 预览不进入文档

首点、rubber-band path、anchor 与 handle 只存在于 Leafer Vector Edit session。Escape、Delete/Backspace、工具切换、只读变化、Page/document/scope 变化与不可连续 revision 会清理预览，零 revision、零 undo。

### 3. 失败恢复权威状态

第二点只调用一次既有 Vector transaction 入口。callback/stale 拒绝时恢复提交前 Network、原选择和首点预览，用户可以直接重试第二点；不创建第二套可写状态，也不新增 Agent tool 或 DesignDocument 字段。

## 验证

- Geometry 覆盖稳定 ID、原 Network 不突变、重合点、非有限坐标和非法 Network。
- Leafer 覆盖直线/曲线独立 contour、连接现有节点且无重合副本、同一 Network 连续创建多 contour、Escape 结束当前 path、提交拒绝后重试、只读与 session 清理。
- Desktop 覆盖 Pen 提示与既有快捷键、选择和单事务语义。

## 后续

- 顶层 Pen 直接创建多 contour/branch Vector Network。
- Vector Edit 与顶层 Pen 的 path/handle 吸附。
- macOS/Windows 打包产品中的真实指针、键盘、HiDPI 与视觉证据。
