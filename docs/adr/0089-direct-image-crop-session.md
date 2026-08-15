# ADR-0089：画布直接图片裁剪使用短生命周期 Session

- 状态：已接受
- 日期：2026-08-15
- 文档协议：`DesignDocument 1.33.0`（不变）
- Image Service：contract v2
- 补充：ADR-0019

## 背景

ADR-0019 已定义非破坏 `ImagePlacement.crop`、确定性焦点/缩放/旋转/翻转几何、Leafer 投影、Inspector 字段和人工/Agent 共用的 placement planner，但用户仍只能在属性面板里输入数字。专业图片工作流需要在画布上直接看到原图相对裁剪框的位置并拖动调整；这个过程不能把每次 pointer move 写成 revision，也不能在 React 或 Leafer 私有对象里建立第二份持久图片状态。

## 决策

### Image Service v2 独占裁剪几何 Session

`@opendesign/image-service` contract v2 增加无文档状态的 `ImageCropSession`。Session 只持有原始/当前 placement、源尺寸和目标 Image 节点尺寸，并提供确定性操作：

- 从 Stretch/Fit/Fill/Crop 建立规范化 Crop；
- 在节点局部坐标中移动图片，并在旋转/翻转后的逆变换中恢复受约束焦点；
- 设置 `1..64` zoom、重置和生成源图片 overlay transform；
- 继续复用 v1 的空白像素防护和有效焦点约束。

Session 不读取路径、不持有 asset bytes、不修改 `DesignDocument`，也不进入 save/history/capture/export。

### Leafer Adapter 拥有直接操作生命周期

选中且未锁定的单个 Image 可通过双击或 Inspector“在画布中裁剪”进入 session。Adapter 投影真实图片预览、目标裁剪边界、源图片边界和可命中的拖拽区域；pan/zoom 只重投影 overlay，不改变裁剪几何。

拖动和 zoom 控件只更新 transient preview。`Enter`/“完成”把最终 canonical placement 交给 Renderer；Renderer 通过现有 `planImageNodeUpdate` 和唯一 `EditorRuntime` 提交一笔事务、一个 revision 和一次 undo。`Escape`/“取消”恢复当前权威 projection，零 revision。Reset 只重置 session，仍需完成后才提交。

document、Page、revision、selection、tool 或目标身份变化时，Adapter 立即丢弃 session 并恢复权威投影，不能把 stale placement 写入新 revision。capture/export、Agent 和 MCP 不读取 session；它们只看到最后已提交文档。

### UI 是真实状态投影

Canvas 顶部上下文条只消费 Adapter 发布的真实 session state，显示当前图片、zoom、Reset、Cancel 和 Done；没有 session 时不显示。Canvas 控件的 pointer/focus 不被画布根节点抢占。Inspector 和双击入口调用同一个 Adapter controller，不复制裁剪逻辑。

## 验证

- Image Service：Fit/Fill/Crop 初始化、移动、旋转/翻转逆变换、zoom clamp、reset、源 transform 与非法尺寸；
- Leafer Adapter：双击/显式启动、真实 overlay、拖动预览、zoom/reset、Enter commit、Escape cancel、selection/revision/Page stale 取消和 dispose；
- Renderer：Inspector 入口、真实状态条、slider、Escape、一次 placement transaction 和离屏 capture adapter 契约；
- `pnpm typecheck` 保证公共 Adapter 接口的所有宿主与测试替身同步升级。

## 后果与边界

图片裁剪现在具备画布直接操作、非破坏保存和可靠取消，不再要求用户靠焦点数字猜测结果。高频 pointer move 不进入 React 文档状态或 history，正式提交仍经过唯一事务入口。

本切片不增加图片 adjustments/filter、Tile、像素级编辑、AI 局部重绘/扩图、派生 asset 谱系或跨平台原生指针视觉门禁；这些能力仍保持 degraded/roadmap 状态。
