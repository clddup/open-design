import type {
  DesignAsset,
  DesignDocument,
  DesignNode,
  DesignOperation,
  LibraryComponentSource,
  LibraryReleaseSnapshot,
} from "@opendesign/design-contracts";
import { componentSourceNodeIds } from "./component-source.js";

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
          return node ? [[nodeId, structuredClone(node)] as const] : [];
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
  return {
    version: 1,
    ...identity,
    name: options.name,
    publishedAt: options.publishedAt,
    componentsById,
    variantSetsById,
  };
}

export function planLibraryReleaseUpdate(
  document: DesignDocument,
  release: LibraryReleaseSnapshot,
  commandPrefix: string,
): LibraryReleaseUpdatePlan {
  const commands: DesignOperation[] = [];
  for (const [componentId, source] of Object.entries(release.componentsById)) {
    const existing = document.libraryComponentsById[componentId];
    if (existing && JSON.stringify(existing) === JSON.stringify(source))
      continue;
    commands.push({
      commandId: `${commandPrefix}_component_${commands.length}`,
      type: "put_library_component_source",
      source: structuredClone(source),
    });
  }
  for (const [variantSetId, source] of Object.entries(
    release.variantSetsById,
  )) {
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
