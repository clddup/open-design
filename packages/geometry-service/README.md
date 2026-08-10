# @opendesign/geometry-service

OpenDesign-owned, versioned geometry provider boundary. Contract v2 contains deterministic arrangement plus an isolated vector-path provider:

- align multiple axis-aligned world bounds to a selection edge or center;
- distribute one-dimensional gaps while preserving distinct outermost anchors;
- set an exact positive, zero, or negative one-dimensional gap from the leading item;
- measure uniform spacing or a repeated gap without mutating design state.

The root entry accepts plain IDs and bounds and returns pure placement deltas. It does not read or save `DesignDocument`, modify Leafer objects, infer the live selection, or own history. `EditorRuntime` resolves world/parent transforms, maintains dynamic Group bounds, validates the resulting `DesignOperation[]`, and applies one transaction.

The `@opendesign/geometry-service/vector-path` sub-entry fixes Skia `pathkit-wasm 1.0.0` behind a plain-data `VectorGeometryProvider`. It currently proves cubic boolean operations, simplify, outline stroke, fill rules, tight bounds, deterministic output, bounded input and explicit WASM initialization. The sub-entry is not loaded by arrangement consumers, so the base desktop bundles do not include PathKit. Every PathKit object remains adapter-private and is explicitly deleted.

This provider foundation does not yet make boolean or Pen editing a product capability. OpenDesign still needs a formal vector-network/boolean-group schema, hierarchy/appearance planner, dynamic WASM asset loading, EditorRuntime transactions, human commands, Agent tools, Leafer projection, persistence, undo/redo, SVG round-trip and macOS/Windows evidence. Capability status remains `unavailable` until those surfaces are complete.

Behavioral references:

- [Figma alignment and distribution](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-dimensions-rotation-and-position)
- [Figma Smart Selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)
- [Figma vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
- [Figma boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [Skia PathKit](https://skia.org/docs/user/modules/pathkit/)
