# @opendesign/geometry-service

OpenDesign-owned, versioned geometry provider boundary. Contract v4 contains deterministic arrangement plus isolated vector-path and vector-edit providers:

- align multiple axis-aligned world bounds to a selection edge or center;
- distribute one-dimensional gaps while preserving distinct outermost anchors;
- set an exact positive, zero, or negative one-dimensional gap from the leading item;
- infer and Tidy up a row, column, or unequal/sparse two-dimensional grid from the existing gap mode, anchoring a grid at the selection top-left;
- measure uniform spacing or a repeated gap without mutating design state.

Tidy up rejects selections whose overlap graph cannot prove stable rows and columns, including diagonal-only placement, one object bridging multiple rows/columns, or multiple objects occupying one inferred grid cell. One-dimensional Tidy up changes only the inferred axis. Gap modes use deterministic spatial order to break equal-frequency ties (topmost row for horizontal gaps, then leftmost column for vertical gaps); no pixel-grid tolerance is implied. Contract v4 deliberately does not claim Smart Selection canvas handles, reflow editing, snapping, or Auto Layout.

The root entry accepts plain IDs and bounds and returns pure placement deltas. It does not read or save `DesignDocument`, modify Leafer objects, infer the live selection, or own history. `EditorRuntime` resolves world/parent transforms, maintains dynamic Group bounds, validates the resulting `DesignOperation[]`, and applies one transaction.

The `@opendesign/geometry-service/vector-path` sub-entry fixes Skia `pathkit-wasm 1.0.0` behind a plain-data `VectorGeometryProvider`. It covers cubic Boolean operations, simplify, Canvas/SVG transforms, exact two-value dash geometry, outline stroke, fill rules, tight bounds, deterministic output, bounded input and explicit WASM initialization. Every PathKit object remains adapter-private and is explicitly deleted.

The `boolean-resolver` sub-entry recursively converts Rectangle, Ellipse, sharp Polygon/Star, Path, Vector and nested Boolean nodes to derived fill-plus-stroke geometry without mutating `DesignDocument`. Rounded regular shapes fail explicitly until an exact outline exists. The `browser-vector-path` sub-entry is dynamically imported by Leafer only when the active Page contains Boolean nodes, so Vite emits the provider and WASM as separate on-demand assets. Resolver output is a disposable projection with bounded exact fingerprints; it is never a second writable document state.

Boolean contract/runtime/render surfaces, human create/change/ungroup commands, transient source-operand canvas editing with live resolver preview, contextual recovery, and typed Agent actions are now present. The overall capability remains `degraded`: text outlines, Pen/node editing, SVG round-trip, pixel baselines and macOS/Windows packaged product evidence are still required.

Behavioral references:

- [Figma alignment and distribution](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-dimensions-rotation-and-position)
- [Figma Smart Selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)
- [Figma vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- [Figma boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [Skia PathKit](https://skia.org/docs/user/modules/pathkit/)
