import { componentSourceNodeIds } from "@opendesign/component-service";
import type {
  DesignAsset,
  DesignDocument,
  DesignNode,
  DesignOperation,
  LibraryComponentSource,
  LibraryReleaseSnapshot,
  LibraryStyleSource,
} from "@opendesign/design-contracts";

export const LIBRARY_SERVICE_VERSION = 1 as const;

export interface CreateLibraryReleaseOptions {
  libraryId: string;
  releaseId: string;
  sourceProjectId: string;
  sourceDesignFileId: string;
  name: string;
  publishedAt: string;
}

export interface LibraryReleaseUpdatePlan {
  commands: DesignOperation[];
  staleComponentIds: string[];
  staleVariantSetIds: string[];
  staleStyleIds: string[];
}

export function createLibraryReleaseSnapshot(
  document: DesignDocument,
  options: CreateLibraryReleaseOptions,
): LibraryReleaseSnapshot {
  const identity = {
    libraryId: options.libraryId,
    releaseId: options.releaseId,
    sourceProjectId: options.sourceProjectId,
    sourceDesignFileId: options.sourceDesignFileId,
    sourceDocumentId: document.documentId,
  };
  const componentsById = Object.fromEntries(
    Object.values(document.componentsById).map((component) => {
      const nodeIds = componentSourceNodeIds(document, component.id);
      const nodesById = Object.fromEntries(
        [...nodeIds].flatMap((nodeId) => {
          const node = document.nodesById[nodeId];
          if (!node) return [];
          const cloned = structuredClone(node);
          if (nodeId === component.rootNodeId) cloned.parentId = null;
          return [[nodeId, cloned] as const];
        }),
      );
      const dependencyComponentIds = componentDependencies(
        component,
        nodesById,
      );
      const assetIds = new Set(
        Object.values(nodesById).flatMap((node) => nodeAssetIds(node)),
      );
      const assetsById = Object.fromEntries(
        [...assetIds].flatMap((assetId) => {
          const asset = document.assetsById[assetId];
          return asset ? [[assetId, structuredClone(asset)] as const] : [];
        }),
      );
      const source: LibraryComponentSource = {
        source: { ...identity, sourceComponentId: component.id },
        component: structuredClone(component),
        nodesById,
        assetsById,
        dependencyComponentIds,
      };
      return [component.id, source] as const;
    }),
  );
  const variantSetsById = Object.fromEntries(
    Object.values(document.variantSetsById).map((variantSet) => [
      variantSet.id,
      {
        source: { ...identity, sourceVariantSetId: variantSet.id },
        variantSet: structuredClone(variantSet),
      },
    ]),
  );
  const componentStyleIds = new Set(
    Object.values(componentsById).flatMap((source) =>
      Object.values(source.nodesById).flatMap((node) => nodeStyleIds(node)),
    ),
  );
  for (const styleId of componentStyleIds) {
    if (!document.stylesById[styleId]) {
      throw new Error(
        `Published component references non-local Style ${styleId}; detach it or publish the Style from this file`,
      );
    }
  }
  const stylesById = Object.fromEntries(
    Object.values(document.stylesById)
      .filter(
        (style) =>
          !style.hiddenFromPublishing || componentStyleIds.has(style.id),
      )
      .map((style) => {
        const source: LibraryStyleSource = {
          source: { ...identity, sourceStyleId: style.id },
          style: structuredClone(style),
        };
        return [style.id, source] as const;
      }),
  );
  return {
    version: 2,
    ...identity,
    name: options.name,
    publishedAt: options.publishedAt,
    componentsById,
    variantSetsById,
    stylesById,
  };
}

export function planLibraryReleaseImport(
  document: DesignDocument,
  release: LibraryReleaseSnapshot,
  commandPrefix: string,
): LibraryReleaseUpdatePlan {
  return planReleaseSources(document, release, commandPrefix, {
    componentIds: new Set(Object.keys(release.componentsById)),
    styleIds: new Set(Object.keys(release.stylesById)),
    variantSetIds: new Set(Object.keys(release.variantSetsById)),
  });
}

export function planLibraryReleaseUpdate(
  document: DesignDocument,
  release: LibraryReleaseSnapshot,
  commandPrefix: string,
): LibraryReleaseUpdatePlan {
  const componentIds = new Set(
    Object.entries(document.libraryComponentsById)
      .filter(([, source]) => source.source.libraryId === release.libraryId)
      .map(([componentId]) => componentId),
  );
  const variantSetIds = new Set(
    Object.entries(document.libraryVariantSetsById)
      .filter(([, source]) => source.source.libraryId === release.libraryId)
      .map(([variantSetId]) => variantSetId),
  );
  const styleIds = new Set(
    Object.entries(document.libraryStylesById)
      .filter(([, source]) => source.source.libraryId === release.libraryId)
      .map(([styleId]) => styleId),
  );
  for (const componentId of componentIds) {
    const source = release.componentsById[componentId];
    if (!source) continue;
    for (const node of Object.values(source.nodesById)) {
      for (const styleId of nodeStyleIds(node)) styleIds.add(styleId);
    }
    if (source.component.variantSetId) {
      variantSetIds.add(source.component.variantSetId);
    }
  }
  return planReleaseSources(document, release, commandPrefix, {
    componentIds,
    styleIds,
    variantSetIds,
  });
}

function planReleaseSources(
  document: DesignDocument,
  release: LibraryReleaseSnapshot,
  commandPrefix: string,
  included: {
    componentIds: ReadonlySet<string>;
    styleIds: ReadonlySet<string>;
    variantSetIds: ReadonlySet<string>;
  },
): LibraryReleaseUpdatePlan {
  const commands: DesignOperation[] = [];
  for (const styleId of included.styleIds) {
    const source = release.stylesById[styleId];
    if (!source) continue;
    const existing = document.libraryStylesById[styleId];
    if (existing && JSON.stringify(existing) === JSON.stringify(source))
      continue;
    commands.push({
      commandId: `${commandPrefix}_style_${commands.length}`,
      type: "put_library_style_source",
      source: structuredClone(source),
    });
  }
  for (const componentId of included.componentIds) {
    const source = release.componentsById[componentId];
    if (!source) continue;
    const existing = document.libraryComponentsById[componentId];
    if (existing && JSON.stringify(existing) === JSON.stringify(source))
      continue;
    commands.push({
      commandId: `${commandPrefix}_component_${commands.length}`,
      type: "put_library_component_source",
      source: structuredClone(source),
    });
  }
  for (const variantSetId of included.variantSetIds) {
    const source = release.variantSetsById[variantSetId];
    if (!source) continue;
    const existing = document.libraryVariantSetsById[variantSetId];
    if (existing && JSON.stringify(existing) === JSON.stringify(source))
      continue;
    commands.push({
      commandId: `${commandPrefix}_variant_${commands.length}`,
      type: "put_library_variant_set_source",
      source: structuredClone(source),
    });
  }
  return {
    commands,
    staleComponentIds: Object.entries(document.libraryComponentsById)
      .filter(
        ([componentId, source]) =>
          source.source.libraryId === release.libraryId &&
          !release.componentsById[componentId],
      )
      .map(([componentId]) => componentId),
    staleVariantSetIds: Object.entries(document.libraryVariantSetsById)
      .filter(
        ([variantSetId, source]) =>
          source.source.libraryId === release.libraryId &&
          !release.variantSetsById[variantSetId],
      )
      .map(([variantSetId]) => variantSetId),
    staleStyleIds: Object.entries(document.libraryStylesById)
      .filter(
        ([styleId, source]) =>
          source.source.libraryId === release.libraryId &&
          !release.stylesById[styleId],
      )
      .map(([styleId]) => styleId),
  };
}

function componentDependencies(
  component: DesignDocument["componentsById"][string],
  nodesById: Record<string, DesignNode>,
): string[] {
  const dependencies = new Set<string>();
  for (const node of Object.values(nodesById)) {
    if (node.kind === "instance") dependencies.add(node.properties.componentId);
  }
  for (const definition of Object.values(
    component.componentPropertyDefinitions,
  )) {
    if (definition.type === "INSTANCE_SWAP") {
      dependencies.add(definition.defaultValue);
    }
    if (definition.type !== "INSTANCE_SWAP" && definition.type !== "SLOT") {
      continue;
    }
    for (const preferred of definition.preferredValues ?? []) {
      if (preferred.type === "COMPONENT") dependencies.add(preferred.key);
    }
  }
  dependencies.delete(component.id);
  return [...dependencies].sort();
}

function nodeAssetIds(node: DesignNode): string[] {
  const assets = new Set<string>();
  if (node.kind === "image") assets.add(node.properties.assetId);
  if (hasPaints(node)) {
    for (const paint of [
      ...node.properties.fills,
      ...node.properties.strokes,
    ]) {
      if (paint.type === "image") assets.add(paint.assetId);
    }
  }
  return [...assets];
}

function nodeStyleIds(node: DesignNode): string[] {
  const ids = new Set<string>();
  for (const styleId of [
    node.fillStyleId,
    node.strokeStyleId,
    node.effectStyleId,
    node.textStyleId,
    node.gridStyleId,
  ]) {
    if (styleId) ids.add(styleId);
  }
  if (node.kind === "text") {
    for (const run of node.properties.runs ?? []) {
      if (run.style.textStyleId) ids.add(run.style.textStyleId);
      if (run.style.fillStyleId) ids.add(run.style.fillStyleId);
    }
  }
  return [...ids];
}

function hasPaints(
  node: DesignNode,
): node is Extract<DesignNode, { properties: { fills: unknown[] } }> {
  return "fills" in node.properties && "strokes" in node.properties;
}

export function libraryReleaseAssets(
  release: LibraryReleaseSnapshot,
): Record<string, DesignAsset> {
  const assets: Record<string, DesignAsset> = {};
  for (const source of Object.values(release.componentsById)) {
    Object.assign(assets, source.assetsById);
  }
  return assets;
}
