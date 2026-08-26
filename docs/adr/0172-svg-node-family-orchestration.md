# ADR-0172：SVG Node Family 与顶层 Orchestration

## 状态

已接受。

## 背景

Phase 9 已分别建立 Parse、Normalize、Appearance、Fidelity、Filter、Mask/Clip、Text、Editable Vector、Line Endpoint、Regular Shape 与 Serialize owner，但聚合 `svg.ts` 仍持有全部节点 kind 分派、容器遍历、Mask sibling run、Frame clipping、稳定导入 ID、节点预算、Group rebase 和导出 root traversal。

这些行为不是公共 API 编排，而是两套方向明确、生命周期完整的节点转换工作流。继续留在聚合文件会让 `svg.ts` 仍超过两千行，并迫使后续节点能力修改公共入口。

## 决策

1. `svg-export-nodes.ts` 是 SVG node/container export 的唯一 owner，负责：
   - 选中 root 的递归遍历、cycle/missing-node 失败和稳定 exported node order；
   - Group/Frame/Boolean/Shape/Text/Vector 节点分派；
   - Frame clipping、ordered sibling Mask run、Line endpoint、Regular Shape 与 metadata；
   - effects/appearance family、mask family、text/vector family 与 serialize namespace 的组合；
   - export traversal 的 sequence、visiting set 和 defs context。
2. `svg-import-nodes.ts` 是 parsed SVG 到 OpenDesign nodes 的唯一 owner，负责：
   - Root style/defs 收集、稳定 ID、editable node/depth budget 与 root Group；
   - Group/Frame/Shape/Text/Vector/Path 节点分派；
   - standard/controlled Mask 引用、Frame clip、Line endpoint、Regular Shape 与 filter；
   - source viewport offset、Group/Mask local bounds/rebase 和完整 node assembly。
3. `svg.ts` 只拥有公开版本、request/result contract、export root selection validation、Parse → Import Nodes 和 Export Nodes → Serialize 的顶层编排，以及 versioned failure 包装。
4. `SvgResolvedBooleanPath`、`resolvedBooleanPathsForSvg()` 与 node-export request port 由 export node family 拥有，`svg.ts` 保持原公共 re-export，不建立兼容实现或双写路径。
5. Import/Export node family 只依赖窄公开 family API，不访问 EditorRuntime、Main、文件路径、Worker 或 Renderer 状态。
6. 不改变公共 `importSvg`/`exportSvg` API、interchange version、节点顺序、ID、Mask/Frame 语义、fidelity issue、预算、失败行为或序列化结果。

## 结果

- `svg.ts` 从 Phase 9 开始时约 3,017 行收缩为约 207 行的公共契约和顶层 orchestration。
- 节点导入与节点导出各有完整 owner，不是按 helper 或节点 kind 继续制造碎片。
- Parse、Normalize、Appearance、Fidelity、Filter/Mask/Text/Vector 与 Serialize family 不再被重新合回聚合 service。
- Phase 9 完成；后续 SVG 能力在对应 owner 中演进，不再扩张公共入口。

## 验证

- Node family 定向测试覆盖真实 root export、metadata/transform、parsed root import、稳定 Group/Rectangle assembly 与 viewport normalization。
- 完整 SVG 回归覆盖 Boolean、Frame、Mask、Text、Vector、Regular Shape、Line endpoint、Gradient、Filter、恶意 XML、round-trip 与 fidelity report。
- Import/export package 全测试、typecheck、定向 ESLint、Prettier 与 Desktop production build 通过。
