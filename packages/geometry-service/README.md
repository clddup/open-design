# @opendesign/geometry-service

OpenDesign-owned, versioned geometry provider boundary. Contract v1 contains deterministic arrangement only:

- align multiple axis-aligned world bounds to a selection edge or center;
- distribute one-dimensional gaps while preserving distinct outermost anchors;
- set an exact positive, zero, or negative one-dimensional gap from the leading item;
- measure uniform spacing or a repeated gap without mutating design state.

The package accepts plain IDs and bounds and returns pure placement deltas. It does not read or save `DesignDocument`, modify Leafer objects, infer the live selection, or own history. `EditorRuntime` resolves world/parent transforms, maintains dynamic Group bounds, validates the resulting `DesignOperation[]`, and applies one transaction.

This package does not yet contain a Bézier/path geometry kernel. Boolean operations, flatten, outline stroke, vector-network editing, snapping, guides, rulers, two-dimensional Tidy up, and Smart Selection canvas handles remain separate planned slices. Selecting a mature path kernel requires the maintenance, license, bundle, determinism, WASM/native, and macOS/Windows evaluation recorded in the roadmap.

Behavioral references:

- [Figma alignment and distribution](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-dimensions-rotation-and-position)
- [Figma Smart Selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection)
