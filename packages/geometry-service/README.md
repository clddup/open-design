# @opendesign/geometry-service

OpenDesign-owned, versioned geometry provider boundary. Contract v30 contains deterministic arrangement, layer reflection, shared rounded regular-shape geometry, and isolated vector-path and vector-edit providers:

- align multiple axis-aligned world bounds to a selection edge or center;
- distribute one-dimensional gaps while preserving distinct outermost anchors;
- set an exact positive, zero, or negative one-dimensional gap from the leading item;
- infer and Tidy up a row, column, or unequal/sparse two-dimensional grid from the existing gap mode, anchoring a grid at the selection top-left;
- analyze a Figma-compatible one- or two-dimensional Smart Selection and change one uniform spacing axis without flattening the other axis;
- reorder a marked proper subset of a one-dimensional Smart Selection while preserving spatial spacing and hierarchy;
- rearrange or swap one layer across stable occupied cells in a two-dimensional Smart Selection, recomputing unequal row and column extents;
- reflow one- and two-dimensional Smart Selection after duplicate, delete, or resize without changing hierarchy;
- create horizontal or vertical reflection matrices around explicit document or node-local bounds;
- measure uniform spacing or a repeated gap without mutating design state.

Tidy up and Smart Selection reject selections whose overlap graph cannot prove stable rows and columns, including diagonal-only placement, one object bridging multiple rows/columns, or multiple objects occupying one inferred grid cell. One-dimensional operations change only the inferred axis. Gap modes use deterministic spatial order to break equal-frequency ties (topmost row for horizontal gaps, then leftmost column for vertical gaps); no pixel-grid tolerance is implied. Smart Selection spacing supports negative gaps for a one-dimensional selection. Reorder accepts stable marked IDs plus an insertion index in the remaining spatial order; it changes placement only, never layer hierarchy. Reflection is pure matrix geometry; EditorRuntime owns selection scope, parent transforms, Auto Layout policy, transactions and history. Snapping and transform-origin policy are not part of this service.

The root entry accepts plain IDs and bounds and returns pure placement deltas. It does not read or save `DesignDocument`, modify Leafer objects, infer the live selection, or own history. `EditorRuntime` resolves world/parent transforms, maintains dynamic Group bounds, validates the resulting `DesignOperation[]`, and applies one transaction.

The `@opendesign/geometry-service/vector-path` sub-entry fixes Skia `pathkit-wasm 1.0.0` behind a plain-data `VectorGeometryProvider`. It covers cubic Boolean operations, simplify, Canvas/SVG transforms, exact two-value dash geometry, outline stroke, fill rules, tight bounds, deterministic output, bounded input and explicit WASM initialization. Every PathKit object remains adapter-private and is explicitly deleted.

The `vector-edit` sub-entry validates stable editable Vector Network topology and provides pure point/handle transforms, point/path deletion, Connect/Disconnect, explicit-path Open/Close/Reverse, nearest line/cubic hit resolution, click Cut, and finite-line drag Cut. Click Cut creates coincident but topologically independent endpoints and uses exact de Casteljau splitting for cubic segments. Drag Cut handles open multi-crossing runs, closed regions, holes, concave components, multiple layers through the Runtime planner, and connected/branch networks. Branch output ownership follows shared-vertex and region connectivity so an uncut arm cannot detach from its real junction component. Tangencies, overlaps, exact shared-junction hits, mixed-side connected components, ambiguous nested regions, and self-intersections fail explicitly.

The `boolean-resolver` sub-entry recursively converts Rectangle, Ellipse, sharp Polygon/Star, Path, Vector and nested Boolean nodes to derived fill-plus-stroke geometry without mutating `DesignDocument`. Rounded regular shapes fail explicitly until an exact outline exists. The `browser-vector-path` sub-entry is dynamically imported by Leafer only when the active Page contains Boolean nodes, so Vite emits the provider and WASM as separate on-demand assets. Resolver output is a disposable projection with bounded exact fingerprints; it is never a second writable document state.

Boolean contract/runtime/render surfaces, human create/change/ungroup commands, transient source-operand canvas editing with live resolver preview, contextual recovery, and typed Agent actions are present. Vector topology editing, Cut, Outline Stroke, and supported SceneNode Flatten share the same Geometry/EditorRuntime path across human and Agent entry points. Image Flatten uses Geometry only for its editable rounded region; EditorRuntime keeps placement, filters, and the existing asset in a region-local Image Paint. The overall capability remains `degraded` until the remaining pixel-faithful Flatten cases, ambiguous topology boundaries, visual baselines, and macOS/Windows packaged product evidence are complete.

Behavioral references:

- [Figma alignment and distribution](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-dimensions-rotation-and-position)
- [Figma Smart Selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)
- [Figma vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- [Figma vector editing and Cut](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
- [Figma boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [Skia PathKit](https://skia.org/docs/user/modules/pathkit/)
