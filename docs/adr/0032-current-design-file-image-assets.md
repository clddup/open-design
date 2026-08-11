# ADR-0032：当前 Design File 图片资源面板与引用安全

- 状态：已接受（共享实现与自动化完成；macOS/Windows 打包交互实测待完成）
- 日期：2026-08-12
- 补充：ADR-0005、ADR-0006、ADR-0019、ADR-0031

## 背景

左侧 Assets 标签原先只显示四个禁用的静态组件占位，既不读取 `DesignDocument.assetsById`，也不能完成图片导入、复用、定位或失效恢复。图片选择和单个 Image 节点来源替换虽然已经存在，但不能冒充文件级资源工作流；直接把本地路径交给 Renderer、在 Leafer 场景中创建旁路节点，或只在 UI 中判断资源可删除都会破坏既有进程与文档边界。

本切片只覆盖当前 Design File 的图片资源。组件、字体、跨文件 Library、授权、派生谱系和批量资源操作仍由后续资源工作台承接。

## 决策

### 权威索引来自当前文档

Assets 面板每次从活动文件的权威 `DesignDocument.assetsById` 和 `nodesById` 派生图片索引，不持久化第二份资源列表。索引对 Image 节点以及 shape/text/path/vector/boolean 的 image fill/stroke 去重计数，并解析稳定 Page/node 引用；切换 Design File 后旧索引不能继续显示或操作。

只有受支持 MIME 的有界 `source.type=data` 可生成预览 data URL。`external/uri`、不受支持 MIME 和缺失引用显示为不可用或缺失并要求 relink；Renderer 不读取路径，不渲染不受信任 SVG 图片预览。

### 导入、放置、替换和删除共用事务入口

原生图片选择仍由 Main 校验内容、MIME、尺寸和内容摘要，只把 `DesignAsset` 返回类型化 Preload。导入未引用资源使用一个 `put_asset` 事务；取消或失败不产生 revision。拖放载荷只包含私有 MIME 下的稳定 asset ID，不包含 bytes、base64 或路径。

Canvas 把 drop 点从 host 屏幕坐标转换为文档坐标；EditorRuntime planner 在对应 Page 中解析该点下最深的可见 Frame，再转换为父级局部坐标。命中锁定 Frame 或锁定祖先时明确拒绝，不能静默散落到 Page root。放置既有资源只插入一个 Image node，形成一个 revision 和一个 undo。

文件级 replace/relink 在一个事务里更新该 asset 的所有 Image 与 image paint 引用，保留每个 Image 的 placement/crop 和每个 paint 的 fit/offset 等字段，再安全删除旧 asset。超过事务命令预算时明确拒绝，不拆成可能留下半完成状态的隐式批次。

UI 只对零引用资源开放删除，但 `EditorRuntime.delete_asset` 继续作为竞态和伪造请求的最终引用安全门禁。定位按引用循环，并在跨 Page 时先激活稳定 Page、选择节点并将其适配到 viewport；浏览和定位不修改文档。

## 结果与限制

- 静态 Assets 占位被真实、可搜索的当前文件图片资源列表取代。
- 图片可导入、复用拖放、跨 Page 定位、全文件替换/relink，并以标准 history 撤销。
- Renderer 没有新增路径或任意文件能力，Leafer 仍只是当前 revision 的投影。
- 当前没有资源 grid、组件/字体 Library、批量选择、授权状态、派生谱系、AI 图片编辑、后台缩略图缓存和大资源虚拟列表；这些能力不能标记为已完成。

## 验证

- 纯索引测试覆盖 Image 与 image paint、多 Page、多节点、缺失/不受支持来源、安全 data URL、搜索和长名称。
- EditorRuntime planner 测试覆盖 Frame/local 坐标、锁定拒绝、单 revision/undo、placement 保留、全引用 relink、零引用删除和 Runtime 二次门禁。
- Renderer 测试覆盖空态、搜索、预览、使用次数、定位、内部 MIME 拖放、外部 payload 拒绝、导入取消/失败零 revision、替换、删除和 undo。
- macOS/Windows 打包程序仍需验证原生选择框、拖放指针、窄面板、长名称、跨 Page 定位和自动保存重开。
