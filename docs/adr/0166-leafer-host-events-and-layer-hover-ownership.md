# ADR-0166：Leafer 宿主事件与 Layer Hover 资源所有权

## 状态

已接受。

## 背景

Leafer adapter 的 mapping、projection、reconcile、generation presentation、frame scheduler 和七组直接交互 session 已经迁入独立 owner，但 adapter 仍直接注册二十余个 Leafer 事件、全局键盘事件和 WebGL context-loss 监听，并直接创建、同步和销毁 Layers panel hover 的 `Stroker`。

这些资源不属于 DesignDocument，却与 adapter 生命周期绑定。过去只有 DOM listener 在 `dispose()` 中显式移除，Leafer listener 依赖 `App.destroy()` 间接清理；hover chrome 的可见性、Component-derived target 解析和资源销毁也散落在 adapter。切换 Editor destination、销毁离屏 capture adapter 或初始化失败时，难以独立证明事件不会继续调用已经释放的交互 controller。

## 决策

1. `LeaferAdapterEventController` 是 adapter 级事件订阅的唯一资源 owner：
   - 注册 Editor selection、editBox drag、move/scale/rotate/skew、inner editor、App drag/pointer、viewport move/zoom/resize 与 render-boundary 事件；
   - 注册 window `keydown/keyup` 和 host `contextlost`；
   - 保留每个 target/type/listener/capture identity，并在 terminal `dispose()` 中按逆序显式解绑；
   - adapter 只提供稳定语义 callback，事件 owner 不读取或复制文档、selection、viewport 或交互 session 状态。
2. Adapter 一旦进入 disposed 状态，先终止 event owner，再释放 projection、DOM editor、交互 controller、presentation、scheduler、overlay、hover 和 Leafer App，避免 teardown 期间新事件进入已释放 controller。
3. `LayerHoverController` 是 Layers panel canvas hover chrome 的唯一 owner：
   - 持有 `Stroker` 的 mount/show/clear/update/dispose 生命周期；
   - 根据当前 tool、Vector edit、Image crop、selection 和完整 ancestor visibility 决定是否显示；
   - 普通节点使用稳定 node ID，Component-derived layer 使用稳定 `instanceId + sourcePath` 解析当前 projection element；
   - 被选中、隐藏、切换 drawing tool 或进入专用编辑模式时立即清除；
   - hover 仍只是不可命中的当前 revision 投影，不进入 document/history/save/export。
4. `WebLeaferEngineAdapter` 继续组合 owner 与语义 callback，不建立第二份画布状态。`TextEditDomController` 继续独占其短生命周期 edit-root listeners，不并入全局事件 owner。
5. 不改变 Leafer 2.2.9、公共 adapter API、事件顺序、手势语义、selection、viewport、hover 样式或事务行为；不保留旧 `#listen`/`#syncLayerHover` 双路径。

## 结果

- Adapter 不再直接调用 Leafer `on/off` 或 DOM `add/removeEventListener`，全局 listener 可独立验证和终止。
- Layer hover chrome 不再由 adapter 私有字段和 helper 偶然管理。
- Phase 8 中列出的 mapping、interaction、reconcile、generation presentation、frame scheduler、listener 与 hover 资源均有明确 owner，Phase 8 完成。

## 验证

- Event owner 对所有 Leafer/DOM listener 做成对注册与解绑，重复 dispose 不重复释放，dispose 后事件不再到达 callback。
- Layer hover 覆盖普通节点、Component-derived 节点、ancestor visibility、selection、drawing、Vector edit、Image crop 与 terminal dispose。
- 既有 adapter 行为回归覆盖 selection、Grid/Auto Layout/Smart Selection、Text edit、capture/export、generation presentation、Boolean、Image crop、Box/Pen/Vector 交互和 hover。
- Leafer package typecheck、定向 Vitest、格式、lint 与 Desktop build 通过。
