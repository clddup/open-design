import { componentSourceNodeIds } from "@opendesign/component-service";
import {
  nodePaints,
  type DesignAsset,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
  type LibraryComponentSource,
  type LibraryReleaseSnapshot,
  type LibraryStyleSource,
  type LibraryVariableCollectionSource,
  type LibraryVariableSource,
  type VariableDefinition,
} from "@opendesign/design-contracts";

export const LIBRARY_SERVICE_VERSION = 2 as const;

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
  staleVariableCollectionIds: string[];
  staleVariableIds: string[];
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
      for (const styleId of Object.values(nodesById).flatMap((node) =>
        nodeStyleIds(node),
      )) {
        const style = document.stylesById[styleId];
        if (style?.styleType !== "PAINT") continue;
        for (const paint of style.paints) {
          if (paint.type === "image") assetIds.add(paint.assetId);
        }
      }
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
  const releasedAssetIds = new Set(
    Object.values(componentsById).flatMap((source) =>
      Object.keys(source.assetsById),
    ),
  );
  for (const source of Object.values(stylesById)) {
    if (source.style.styleType !== "PAINT") continue;
    for (const paint of source.style.paints) {
      if (paint.type === "image" && !releasedAssetIds.has(paint.assetId)) {
        throw new Error(
          `Published Image Paint Style ${source.style.id} references asset ${paint.assetId}, but standalone Style asset dependencies are not available yet`,
        );
      }
    }
  }
  const publishedVariableIds = new Set<string>();
  const publishedCollectionIds = new Set<string>();
  for (const collection of Object.values(document.variableCollectionsById)) {
    if (collection.hiddenFromPublishing) continue;
    publishedCollectionIds.add(collection.id);
    for (const variableId of collection.variableIds) {
      const variable = document.variablesById[variableId];
      if (variable && !variable.hiddenFromPublishing) {
        publishedVariableIds.add(variableId);
      }
    }
  }
  for (const source of Object.values(componentsById)) {
    for (const node of Object.values(source.nodesById)) {
      for (const collectionId of Object.keys(
        node.explicitVariableModes ?? {},
      )) {
        publishedCollectionIds.add(collectionId);
      }
      for (const variableId of nodeVariableIds(node)) {
        publishedVariableIds.add(variableId);
      }
    }
  }
  expandVariableAliasClosure(
    document,
    publishedVariableIds,
    publishedCollectionIds,
  );
  const variableCollectionsById = Object.fromEntries(
    [...publishedCollectionIds].sort().map((collectionId) => {
      const collection = document.variableCollectionsById[collectionId];
      if (!collection) {
        throw new Error(
          `Published content references non-local Variable Collection ${collectionId}`,
        );
      }
      const source: LibraryVariableCollectionSource = {
        source: {
          ...identity,
          sourceVariableCollectionId: collectionId,
        },
        collection: {
          ...structuredClone(collection),
          variableIds: collection.variableIds.filter((variableId) =>
            publishedVariableIds.has(variableId),
          ),
        },
      };
      return [collectionId, source] as const;
    }),
  );
  const variablesById = Object.fromEntries(
    [...publishedVariableIds].sort().map((variableId) => {
      const variable = document.variablesById[variableId];
      if (!variable) {
        throw new Error(
          `Published content references non-local Variable ${variableId}`,
        );
      }
      const source: LibraryVariableSource = {
        source: { ...identity, sourceVariableId: variableId },
        variable: structuredClone(variable),
      };
      return [variableId, source] as const;
    }),
  );
  return {
    version: 3,
    ...identity,
    name: options.name,
    publishedAt: options.publishedAt,
    componentsById,
    variantSetsById,
    stylesById,
    variableCollectionsById,
    variablesById,
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
    variableCollectionIds: new Set(
      Object.keys(release.variableCollectionsById),
    ),
    variableIds: new Set(Object.keys(release.variablesById)),
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
  const variableCollectionIds = new Set(
    Object.entries(document.libraryVariableCollectionsById)
      .filter(([, source]) => source.source.libraryId === release.libraryId)
      .map(([collectionId]) => collectionId),
  );
  const variableIds = new Set(
    Object.entries(document.libraryVariablesById)
      .filter(([, source]) => source.source.libraryId === release.libraryId)
      .map(([variableId]) => variableId),
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
    for (const node of Object.values(source.nodesById)) {
      for (const collectionId of Object.keys(
        node.explicitVariableModes ?? {},
      )) {
        variableCollectionIds.add(collectionId);
      }
      for (const variableId of nodeVariableIds(node)) {
        variableIds.add(variableId);
      }
    }
  }
  expandReleaseVariableAliasClosure(
    release,
    variableIds,
    variableCollectionIds,
  );
  return planReleaseSources(document, release, commandPrefix, {
    componentIds,
    styleIds,
    variantSetIds,
    variableCollectionIds,
    variableIds,
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
    variableCollectionIds: ReadonlySet<string>;
    variableIds: ReadonlySet<string>;
  },
): LibraryReleaseUpdatePlan {
  const commands: DesignOperation[] = [];
  for (const collectionId of included.variableCollectionIds) {
    const source = release.variableCollectionsById[collectionId];
    if (!source) continue;
    const existing = document.libraryVariableCollectionsById[collectionId];
    if (existing && JSON.stringify(existing) === JSON.stringify(source))
      continue;
    commands.push({
      commandId: `${commandPrefix}_variable_collection_${commands.length}`,
      type: "put_library_variable_collection_source",
      source: structuredClone(source),
    });
  }
  for (const variableId of included.variableIds) {
    const source = release.variablesById[variableId];
    if (!source) continue;
    const existing = document.libraryVariablesById[variableId];
    if (existing && JSON.stringify(existing) === JSON.stringify(source))
      continue;
    commands.push({
      commandId: `${commandPrefix}_variable_${commands.length}`,
      type: "put_library_variable_source",
      source: structuredClone(source),
    });
  }
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
    staleVariableCollectionIds: Object.entries(
      document.libraryVariableCollectionsById,
    )
      .filter(
        ([collectionId, source]) =>
          source.source.libraryId === release.libraryId &&
          !release.variableCollectionsById[collectionId],
      )
      .map(([collectionId]) => collectionId),
    staleVariableIds: Object.entries(document.libraryVariablesById)
      .filter(
        ([variableId, source]) =>
          source.source.libraryId === release.libraryId &&
          !release.variablesById[variableId],
      )
      .map(([variableId]) => variableId),
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
  for (const paint of nodePaints(node)) {
    if (paint.type === "image") assets.add(paint.assetId);
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

function nodeVariableIds(node: DesignNode): string[] {
  const ids = new Set<string>();
  for (const alias of Object.values(node.boundVariables ?? {})) {
    ids.add(alias.id);
  }
  for (const paint of nodePaints(node)) {
    if (paint.type === "solid" && paint.boundVariables?.color) {
      ids.add(paint.boundVariables.color.id);
    }
  }
  return [...ids];
}

function expandVariableAliasClosure(
  document: DesignDocument,
  variableIds: Set<string>,
  collectionIds: Set<string>,
): void {
  expandAliases(
    variableIds,
    collectionIds,
    (variableId) => document.variablesById[variableId],
  );
}

function expandReleaseVariableAliasClosure(
  release: LibraryReleaseSnapshot,
  variableIds: Set<string>,
  collectionIds: Set<string>,
): void {
  const available = new Set(
    [...variableIds].filter((variableId) => release.variablesById[variableId]),
  );
  expandAliases(
    available,
    collectionIds,
    (variableId) => release.variablesById[variableId]?.variable,
  );
  for (const variableId of available) variableIds.add(variableId);
}

function expandAliases(
  variableIds: Set<string>,
  collectionIds: Set<string>,
  lookup: (variableId: string) => VariableDefinition | undefined,
): void {
  const pending = [...variableIds];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const variableId = pending.pop()!;
    if (visited.has(variableId)) continue;
    visited.add(variableId);
    const variable = lookup(variableId);
    if (!variable) {
      throw new Error(
        `Published content references unavailable Variable ${variableId}`,
      );
    }
    variableIds.add(variableId);
    collectionIds.add(variable.variableCollectionId);
    for (const value of Object.values(variable.valuesByMode)) {
      if (
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        value.type === "VARIABLE_ALIAS"
      ) {
        pending.push(value.id);
      }
    }
  }
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
