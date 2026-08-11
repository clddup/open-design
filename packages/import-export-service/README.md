# OpenDesign Import/Export Service

This package owns pure, versioned interchange services. It does not read or write files, mutate `EditorRuntime`, keep a second document, or expose parser/provider objects through public results.

The SVG v1 service uses pinned XML and transform parsers plus OpenDesign's pinned vector geometry provider. It imports the supported SVG subset as editable OpenDesign nodes and exports OpenDesign Frame/Group, Path/Vector/basic shapes, rounded Frame clipping, ordered sibling masks, bounded filter effects, and resolved non-destructive Boolean results. Sharp Polygon/Star nodes round-trip through standard `<polygon>` elements with exact, validated OpenDesign semantic metadata; ordinary external polygons remain Vectors. Unsupported SVG features produce explicit fidelity issues instead of being silently discarded.

Standard SVG cannot preserve OpenDesign's non-destructive Boolean operands. Export therefore consumes a caller-supplied, disposable resolved Boolean path and records `boolean-flattened`; re-import produces an editable Vector, never a fake Boolean group. Rounded Polygon/Star export also fails explicitly until an exact outline service exists. Pixel equivalence, text outlining, complex filter/combined-mask graphs, images, angular gradients, inside/outside stroke simplification, and packaged product UI remain separate acceptance gates.
