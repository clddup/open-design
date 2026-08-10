# @opendesign/geometry-service

OpenDesign-owned, versioned geometry provider boundary. Contract v2 contains deterministic arrangement plus an isolated vector-path provider:

- align multiple axis-aligned world bounds to a selection edge or center;
- distribute one-dimensional gaps while preserving distinct outermost anchors;
- set an exact positive, zero, or negative one-dimensional gap from the leading item;
- measure uniform spacing or a repeated gap without mutating design state.

The root entry accepts plain IDs and bounds and returns pure placement deltas. It does not read or save `DesignDocument`, modify Leafer objects, infer the live selection, or own history. `EditorRuntime` resolves world/parent transforms, maintains dynamic Group bounds, validates the resulting `DesignOperation[]`, and applies one transaction.

The `@opendesign/geometry-service/vector-path` sub-entry fixes Skia `pathkit-wasm 1.0.0` behind a plain-data `VectorGeometryProvider`. It covers cubic Boolean operations, simplify, Canvas/SVG transforms, exact two-value dash geometry, outline stroke, fill rules, tight bounds, deterministic output, bounded input and explicit WASM initialization. Every PathKit object remains adapter-private and is explicitly deleted.

The `boolean-resolver` sub-entry recursively converts Rectangle, Ellipse, Path, Vector and nested Boolean nodes to derived fill-plus-stroke geometry without mutating `DesignDocument`. The `browser-vector-path` sub-entry is dynamically imported by Leafer only when the active Page contains Boolean nodes, so Vite emits the provider and WASM as separate on-demand assets. Resolver output is a disposable projection with bounded exact fingerprints; it is never a second writable document state.

Boolean contract/runtime/render surfaces, human create/change/ungroup commands, transient source-operand canvas editing with live resolver preview, contextual recovery, and typed Agent actions are now present. The overall capability remains `degraded`: text outlines, Pen/node editing, SVG round-trip, pixel baselines and macOS/Windows packaged product evidence are still required.

Behavioral references:

- [Figma alignment and distribution](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-dimensions-rotation-and-position)
- [Figma Smart Selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)
- [Figma vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- [Figma boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [Skia PathKit](https://skia.org/docs/user/modules/pathkit/)
