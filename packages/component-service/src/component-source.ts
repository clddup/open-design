import type {
  ComponentDefinition,
  DesignDocument,
  DesignNode,
  LibraryComponentSource,
  VariantSetDefinition,
} from "@opendesign/design-contracts";

export type ComponentSource =
  | {
      kind: "local";
      component: ComponentDefinition;
    }
  | {
      kind: "library";
      component: ComponentDefinition;
      library: LibraryComponentSource;
    };

export function componentSource(
  document: DesignDocument,
  componentId: string,
): ComponentSource | undefined {
  const local = document.componentsById[componentId];
  if (local) return { kind: "local", component: local };
  const library = document.libraryComponentsById[componentId];
  return library
    ? { kind: "library", component: library.component, library }
    : undefined;
}

export function componentDefinition(
  document: DesignDocument,
  componentId: string,
): ComponentDefinition | undefined {
  return componentSource(document, componentId)?.component;
}

export function componentSourceNode(
  document: DesignDocument,
  componentId: string,
  nodeId: string,
): DesignNode | undefined {
  const source = componentSource(document, componentId);
  return source?.kind === "library"
    ? source.library.nodesById[nodeId]
    : source
      ? document.nodesById[nodeId]
      : undefined;
}

export function componentSourceNodeIds(
  document: DesignDocument,
  componentId: string,
): ReadonlySet<string> {
  const definition = componentDefinition(document, componentId);
  const result = new Set<string>();
  if (!definition) return result;
  const visit = (nodeId: string): void => {
    if (result.has(nodeId)) return;
    const node = componentSourceNode(document, componentId, nodeId);
    if (!node) return;
    result.add(nodeId);
    node.childIds.forEach(visit);
  };
  visit(definition.rootNodeId);
  return result;
}

export function componentDefinitions(
  document: DesignDocument,
): readonly ComponentDefinition[] {
  return [
    ...Object.values(document.componentsById),
    ...Object.values(document.libraryComponentsById).map(
      (source) => source.component,
    ),
  ];
}

export function componentVariantSet(
  document: DesignDocument,
  variantSetId: string,
): VariantSetDefinition | undefined {
  return (
    document.variantSetsById[variantSetId] ??
    document.libraryVariantSetsById[variantSetId]?.variantSet
  );
}

export function componentProjectionAssets(
  document: DesignDocument,
): DesignDocument["assetsById"] {
  const assets = { ...document.assetsById };
  for (const source of Object.values(document.libraryComponentsById)) {
    Object.assign(assets, source.assetsById);
  }
  return assets;
}
