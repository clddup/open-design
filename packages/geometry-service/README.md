# @opendesign/geometry-service

OpenDesign-owned, versioned geometry provider boundary. Contract v7 contains deterministic arrangement plus isolated vector-path and vector-edit providers:

- align multiple axis-aligned world bounds to a selection edge or center;
- distribute one-dimensional gaps while preserving distinct outermost anchors;
- set an exact positive, zero, or negative one-dimensional gap from the leading item;
- infer and Tidy up a row, column, or unequal/sparse two-dimensional grid from the existing gap mode, anchoring a grid at the selection top-left;
- analyze a Figma-compatible one- or two-dimensional Smart Selection and change one uniform spacing axis without flattening the other axis;
- reorder a marked proper subset of a one-dimensional Smart Selection while preserving spatial spacing and hierarchy;
- measure uniform spacing or a repeated gap without mutating design state.

Tidy up and Smart Selection reject selections whose overlap graph cannot prove stable rows and columns, including diagonal-only placement, one object bridging multiple rows/columns, or multiple objects occupying one inferred grid cell. One-dimensional operations change only the inferred axis. Gap modes use deterministic spatial order to break equal-frequency ties (topmost row for horizontal gaps, then leftmost column for vertical gaps); no pixel-grid tolerance is implied. Smart Selection spacing supports negative gaps for a one-dimensional selection. Reorder accepts stable marked IDs plus an insertion index in the remaining spatial order; it changes placement only, never layer hierarchy. The current surface does not claim two-dimensional rearrange/swap, structural reflow after duplicate/delete/resize, snapping, or Auto Layout.

The root entry accepts plain IDs and bounds and returns pure placement deltas. It does not read or save `DesignDocument`, modify Leafer objects, infer the live selection, or own history. `EditorRuntime` resolves world/parent transforms, maintains dynamic Group bounds, validates the resulting `DesignOperation[]`, and applies one transaction.

The `@opendesign/geometry-service/vector-path` sub-entry fixes Skia `pathkit-wasm 1.0.0` behind a plain-data `VectorGeometryProvider`. It covers cubic Boolean operations, simplify, Canvas/SVG transforms, exact two-value dash geometry, outline stroke, fill rules, tight bounds, deterministic output, bounded input and explicit WASM initialization. Every PathKit object remains adapter-private and is explicitly deleted.

The `vector-edit` sub-entry validates stable editable Vector Network topology and provides pure vertex/handle movement, point modes, deletion, explicit-contour Open/Close/Reverse, nearest line/cubic hit resolution, click Cut, and finite-line drag Cut. Click Cut creates coincident but topologically independent endpoints; cubic segments use exact de Casteljau splitting. Drag Cut solves real line/cubic crossings, rejects tangencies and overlaps, divides each supported closed contour at exactly two crossings, and gives both pieces a real closing connector. The piece containing the source start keeps its path ID; extracted pieces are returned as one independent network. Multiple disjoint closed contours may be divided in one action, while open contours, compound holes, connected/shared-vertex, branching, and ambiguous multi-intersection cases remain explicit follow-up capabilities.

The `boolean-resolver` sub-entry recursively converts Rectangle, Ellipse, sharp Polygon/Star, Path, Vector and nested Boolean nodes to derived fill-plus-stroke geometry without mutating `DesignDocument`. Rounded regular shapes fail explicitly until an exact outline exists. The `browser-vector-path` sub-entry is dynamically imported by Leafer only when the active Page contains Boolean nodes, so Vite emits the provider and WASM as separate on-demand assets. Resolver output is a disposable projection with bounded exact fingerprints; it is never a second writable document state.

Boolean contract/runtime/render surfaces, human create/change/ungroup commands, transient source-operand canvas editing with live resolver preview, contextual recovery, and typed Agent actions are now present. Vector Open/Close/Reverse, click Cut, and the supported drag-across Cut subset share one EditorRuntime planner across human and Agent entry points. The overall capability remains `degraded`: multi-Vector-layer Cut, open-stroke division, compound-hole redistribution, concave contours with more than two crossings, connected/branch networks, connect/disconnect, flatten, outline stroke product commands, pixel baselines, and macOS/Windows packaged product evidence are still required.

Behavioral references:

- [Figma alignment and distribution](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-dimensions-rotation-and-position)
- [Figma Smart Selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)
- [Figma vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- [Figma vector editing and Cut](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- [Figma boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [Skia PathKit](https://skia.org/docs/user/modules/pathkit/)
