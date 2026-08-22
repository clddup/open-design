import type {
  DesignChangeSet,
  DesignDocument,
} from "@opendesign/design-contracts";
import { deepFreeze } from "./document.js";
import { diffDesignSystems } from "./design-system-runtime.js";
import { nodeChangedFields } from "./node-change-fields.js";
import { diffVariantSets } from "./variant-set-diff.js";

export function diffDocuments(
  before: DesignDocument,
  after: DesignDocument,
  toRevision: number,
): DesignChangeSet {
  const changes: DesignChangeSet["changes"] = [];
  const addedNodeIds: string[] = [];
  const changedNodeIds: string[] = [];
  const removedNodeIds: string[] = [];
  const addedAssetIds: string[] = [];
  const changedAssetIds: string[] = [];
  const removedAssetIds: string[] = [];
  const addedImageAssetDerivationIds: string[] = [];
  const changedImageAssetDerivationIds: string[] = [];
  const removedImageAssetDerivationIds: string[] = [];
  const addedPageIds: string[] = [];
  const changedPageIds: string[] = [];
  const removedPageIds: string[] = [];
  const pageChanges: NonNullable<DesignChangeSet["pageChanges"]> = [];
  const addedComponentIds: string[] = [];
  const changedComponentIds: string[] = [];
  const removedComponentIds: string[] = [];
  const componentChanges: NonNullable<DesignChangeSet["componentChanges"]> = [];
  const addedLibraryComponentIds: string[] = [];
  const changedLibraryComponentIds: string[] = [];
  const removedLibraryComponentIds: string[] = [];
  const libraryComponentChanges: NonNullable<
    DesignChangeSet["libraryComponentChanges"]
  > = [];
  const addedLibraryVariantSetIds: string[] = [];
  const changedLibraryVariantSetIds: string[] = [];
  const removedLibraryVariantSetIds: string[] = [];
  const libraryVariantSetChanges: NonNullable<
    DesignChangeSet["libraryVariantSetChanges"]
  > = [];
  const addedLibraryStyleIds: string[] = [];
  const changedLibraryStyleIds: string[] = [];
  const removedLibraryStyleIds: string[] = [];
  const libraryStyleChanges: NonNullable<
    DesignChangeSet["libraryStyleChanges"]
  > = [];
  const ids = new Set([
    ...Object.keys(before.nodesById),
    ...Object.keys(after.nodesById),
  ]);

  for (const nodeId of ids) {
    const oldNode = before.nodesById[nodeId];
    const newNode = after.nodesById[nodeId];
    if (!oldNode && newNode) {
      addedNodeIds.push(nodeId);
      changes.push({
        type: "added",
        nodeId,
        after: newNode,
        changedFields: ["node"],
      });
      continue;
    }
    if (oldNode && !newNode) {
      removedNodeIds.push(nodeId);
      changes.push({
        type: "removed",
        nodeId,
        before: oldNode,
        changedFields: ["node"],
      });
      continue;
    }
    if (!oldNode || !newNode) continue;
    if (JSON.stringify(oldNode) === JSON.stringify(newNode)) {
      if (siblingIndexChanged(before, after, nodeId)) {
        changedNodeIds.push(nodeId);
        changes.push({
          type: "moved",
          nodeId,
          before: oldNode,
          after: newNode,
          changedFields: ["zOrder"],
        });
      }
      continue;
    }
    changedNodeIds.push(nodeId);
    const changedFields = nodeChangedFields(oldNode, newNode);
    changes.push({
      type:
        changedFields.includes("parentId") ||
        siblingIndexChanged(before, after, nodeId)
          ? "moved"
          : "updated",
      nodeId,
      before: oldNode,
      after: newNode,
      changedFields,
    });
  }

  const assetIds = new Set([
    ...Object.keys(before.assetsById),
    ...Object.keys(after.assetsById),
  ]);
  for (const assetId of assetIds) {
    const oldAsset = before.assetsById[assetId];
    const newAsset = after.assetsById[assetId];
    if (!oldAsset && newAsset) addedAssetIds.push(assetId);
    else if (oldAsset && !newAsset) removedAssetIds.push(assetId);
    else if (JSON.stringify(oldAsset) !== JSON.stringify(newAsset)) {
      changedAssetIds.push(assetId);
    }
  }

  const imageAssetDerivationIds = new Set([
    ...Object.keys(before.imageAssetDerivationsById),
    ...Object.keys(after.imageAssetDerivationsById),
  ]);
  for (const derivationId of imageAssetDerivationIds) {
    const oldDerivation = before.imageAssetDerivationsById[derivationId];
    const newDerivation = after.imageAssetDerivationsById[derivationId];
    if (!oldDerivation && newDerivation) {
      addedImageAssetDerivationIds.push(derivationId);
    } else if (oldDerivation && !newDerivation) {
      removedImageAssetDerivationIds.push(derivationId);
    } else if (
      JSON.stringify(oldDerivation) !== JSON.stringify(newDerivation) ||
      before.imageAssetDerivationOrder.indexOf(derivationId) !==
        after.imageAssetDerivationOrder.indexOf(derivationId)
    ) {
      changedImageAssetDerivationIds.push(derivationId);
    }
  }

  const pageIds = new Set([
    ...Object.keys(before.pagesById),
    ...Object.keys(after.pagesById),
  ]);
  for (const pageId of pageIds) {
    const oldPage = before.pagesById[pageId];
    const newPage = after.pagesById[pageId];
    if (!oldPage && newPage) {
      addedPageIds.push(pageId);
      pageChanges.push({
        type: "added",
        pageId,
        after: newPage,
        changedFields: ["page"],
      });
      continue;
    }
    if (oldPage && !newPage) {
      removedPageIds.push(pageId);
      pageChanges.push({
        type: "removed",
        pageId,
        before: oldPage,
        changedFields: ["page"],
      });
      continue;
    }
    if (!oldPage || !newPage) continue;
    const changedFields = pageChangedFields(oldPage, newPage);
    const moved = pageIndexChanged(before, after, pageId);
    if (changedFields.length === 0 && !moved) continue;
    changedPageIds.push(pageId);
    pageChanges.push({
      type: moved ? "moved" : "updated",
      pageId,
      before: oldPage,
      after: newPage,
      changedFields: moved
        ? [...new Set([...changedFields, "pageOrder"])]
        : changedFields,
    });
  }

  const componentIds = new Set([
    ...Object.keys(before.componentsById),
    ...Object.keys(after.componentsById),
  ]);
  for (const componentId of componentIds) {
    const oldComponent = before.componentsById[componentId];
    const newComponent = after.componentsById[componentId];
    if (!oldComponent && newComponent) {
      addedComponentIds.push(componentId);
      componentChanges.push({
        type: "added",
        componentId,
        after: newComponent,
        changedFields: ["component"],
      });
      continue;
    }
    if (oldComponent && !newComponent) {
      removedComponentIds.push(componentId);
      componentChanges.push({
        type: "removed",
        componentId,
        before: oldComponent,
        changedFields: ["component"],
      });
      continue;
    }
    if (!oldComponent || !newComponent) continue;
    const changedFields = [
      "name",
      "rootNodeId",
      "description",
      "componentPropertyOrder",
      "componentPropertyDefinitions",
      "variantSetId",
      "variantProperties",
      "extensions",
    ].filter(
      (field) =>
        JSON.stringify(oldComponent[field as keyof typeof oldComponent]) !==
        JSON.stringify(newComponent[field as keyof typeof newComponent]),
    );
    if (changedFields.length === 0) continue;
    changedComponentIds.push(componentId);
    componentChanges.push({
      type: "updated",
      componentId,
      before: oldComponent,
      after: newComponent,
      changedFields,
    });
  }

  diffLibrarySources(
    before.libraryComponentsById,
    after.libraryComponentsById,
    "componentId",
    [
      "source",
      "component",
      "nodesById",
      "assetsById",
      "dependencyComponentIds",
    ],
    addedLibraryComponentIds,
    changedLibraryComponentIds,
    removedLibraryComponentIds,
    libraryComponentChanges,
  );
  diffLibrarySources(
    before.libraryVariantSetsById,
    after.libraryVariantSetsById,
    "variantSetId",
    ["source", "variantSet"],
    addedLibraryVariantSetIds,
    changedLibraryVariantSetIds,
    removedLibraryVariantSetIds,
    libraryVariantSetChanges,
  );
  diffLibrarySources(
    before.libraryStylesById,
    after.libraryStylesById,
    "styleId",
    ["source", "style"],
    addedLibraryStyleIds,
    changedLibraryStyleIds,
    removedLibraryStyleIds,
    libraryStyleChanges,
  );

  return deepFreeze({
    documentId: before.documentId,
    fromRevision: before.revision,
    toRevision,
    addedNodeIds,
    changedNodeIds,
    removedNodeIds,
    addedAssetIds,
    changedAssetIds,
    removedAssetIds,
    addedImageAssetDerivationIds,
    changedImageAssetDerivationIds,
    removedImageAssetDerivationIds,
    addedPageIds,
    changedPageIds,
    removedPageIds,
    pageChanges,
    addedComponentIds,
    changedComponentIds,
    removedComponentIds,
    componentChanges,
    addedLibraryComponentIds,
    changedLibraryComponentIds,
    removedLibraryComponentIds,
    libraryComponentChanges,
    addedLibraryVariantSetIds,
    changedLibraryVariantSetIds,
    removedLibraryVariantSetIds,
    libraryVariantSetChanges,
    addedLibraryStyleIds,
    changedLibraryStyleIds,
    removedLibraryStyleIds,
    libraryStyleChanges,
    ...diffVariantSets(before, after),
    ...diffDesignSystems(before, after),
    changes,
  });
}

function diffLibrarySources<
  Source extends object,
  IdField extends "componentId" | "variantSetId" | "styleId",
  Change extends {
    type: "added" | "updated" | "removed";
    changedFields: string[];
  } & Record<IdField, string>,
>(
  before: Record<string, Source>,
  after: Record<string, Source>,
  idField: IdField,
  fields: readonly string[],
  addedIds: string[],
  changedIds: string[],
  removedIds: string[],
  changes: Change[],
): void {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of ids) {
    const previous = before[id];
    const next = after[id];
    if (!previous && next) {
      addedIds.push(id);
      changes.push({
        type: "added",
        [idField]: id,
        after: next,
        changedFields: ["source"],
      } as unknown as Change);
      continue;
    }
    if (previous && !next) {
      removedIds.push(id);
      changes.push({
        type: "removed",
        [idField]: id,
        before: previous,
        changedFields: ["source"],
      } as unknown as Change);
      continue;
    }
    if (
      !previous ||
      !next ||
      JSON.stringify(previous) === JSON.stringify(next)
    ) {
      continue;
    }
    changedIds.push(id);
    changes.push({
      type: "updated",
      [idField]: id,
      before: previous,
      after: next,
      changedFields: fields.filter(
        (field) =>
          JSON.stringify(previous[field as keyof Source]) !==
          JSON.stringify(next[field as keyof Source]),
      ),
    } as unknown as Change);
  }
}

function pageIndexChanged(
  before: DesignDocument,
  after: DesignDocument,
  pageId: string,
): boolean {
  return before.pageOrder.indexOf(pageId) !== after.pageOrder.indexOf(pageId);
}

function pageChangedFields(
  before: DesignDocument["pagesById"][string],
  after: DesignDocument["pagesById"][string],
): string[] {
  const fields = [
    "name",
    "rootNodeIds",
    "explicitVariableModes",
    "extensions",
  ] as const;
  return fields.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

function siblingIndexChanged(
  before: DesignDocument,
  after: DesignDocument,
  nodeId: string,
): boolean {
  const oldLocation = locateNode(before, nodeId);
  const newLocation = locateNode(after, nodeId);
  return (
    oldLocation?.pageId !== newLocation?.pageId ||
    oldLocation?.index !== newLocation?.index
  );
}

interface NodeLocation {
  pageId: string;
  parentId: string | null;
  index: number;
}

function locateNode(
  document: DesignDocument,
  nodeId: string,
): NodeLocation | undefined {
  const visit = (
    pageId: string,
    parentId: string | null,
    childIds: readonly string[],
  ): NodeLocation | undefined => {
    const index = childIds.indexOf(nodeId);
    if (index >= 0) return { pageId, parentId, index };
    for (const childId of childIds) {
      const child = document.nodesById[childId];
      if (!child) continue;
      const result = visit(pageId, childId, child.childIds);
      if (result) return result;
    }
    return undefined;
  };
  for (const pageId of document.pageOrder) {
    const page = document.pagesById[pageId];
    if (!page) continue;
    const result = visit(pageId, null, page.rootNodeIds);
    if (result) return result;
  }
  return undefined;
}
