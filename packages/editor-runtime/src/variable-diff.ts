import type {
  DesignChangeSet,
  DesignDocument,
} from "@opendesign/design-contracts";

export function diffVariables(
  before: DesignDocument,
  after: DesignDocument,
): Pick<
  DesignChangeSet,
  | "addedVariableCollectionIds"
  | "changedVariableCollectionIds"
  | "removedVariableCollectionIds"
  | "addedVariableIds"
  | "changedVariableIds"
  | "removedVariableIds"
  | "variableCollectionChanges"
  | "variableChanges"
  | "addedLibraryVariableCollectionIds"
  | "changedLibraryVariableCollectionIds"
  | "removedLibraryVariableCollectionIds"
  | "libraryVariableCollectionChanges"
  | "addedLibraryVariableIds"
  | "changedLibraryVariableIds"
  | "removedLibraryVariableIds"
  | "libraryVariableChanges"
> {
  const addedVariableCollectionIds: string[] = [];
  const changedVariableCollectionIds: string[] = [];
  const removedVariableCollectionIds: string[] = [];
  const variableCollectionChanges: NonNullable<
    DesignChangeSet["variableCollectionChanges"]
  > = [];
  const collectionIds = new Set([
    ...Object.keys(before.variableCollectionsById),
    ...Object.keys(after.variableCollectionsById),
  ]);
  for (const collectionId of collectionIds) {
    const oldValue = before.variableCollectionsById[collectionId];
    const newValue = after.variableCollectionsById[collectionId];
    if (!oldValue && newValue) {
      addedVariableCollectionIds.push(collectionId);
      variableCollectionChanges.push({
        type: "added",
        collectionId,
        after: newValue,
        changedFields: ["collection"],
      });
    } else if (oldValue && !newValue) {
      removedVariableCollectionIds.push(collectionId);
      variableCollectionChanges.push({
        type: "removed",
        collectionId,
        before: oldValue,
        changedFields: ["collection"],
      });
    } else if (oldValue && newValue) {
      const changedFields = changedObjectFields(oldValue, newValue);
      const moved =
        before.variableCollectionOrder.indexOf(collectionId) !==
        after.variableCollectionOrder.indexOf(collectionId);
      if (changedFields.length > 0 || moved) {
        changedVariableCollectionIds.push(collectionId);
        variableCollectionChanges.push({
          type: moved ? "moved" : "updated",
          collectionId,
          before: oldValue,
          after: newValue,
          changedFields: moved
            ? [...new Set([...changedFields, "collectionOrder"])]
            : changedFields,
        });
      }
    }
  }

  const addedVariableIds: string[] = [];
  const changedVariableIds: string[] = [];
  const removedVariableIds: string[] = [];
  const variableChanges: NonNullable<DesignChangeSet["variableChanges"]> = [];
  const variableIds = new Set([
    ...Object.keys(before.variablesById),
    ...Object.keys(after.variablesById),
  ]);
  for (const variableId of variableIds) {
    const oldValue = before.variablesById[variableId];
    const newValue = after.variablesById[variableId];
    if (!oldValue && newValue) {
      addedVariableIds.push(variableId);
      variableChanges.push({
        type: "added",
        variableId,
        after: newValue,
        changedFields: ["variable"],
      });
    } else if (oldValue && !newValue) {
      removedVariableIds.push(variableId);
      variableChanges.push({
        type: "removed",
        variableId,
        before: oldValue,
        changedFields: ["variable"],
      });
    } else if (oldValue && newValue) {
      const changedFields = changedObjectFields(oldValue, newValue);
      if (changedFields.length > 0) {
        changedVariableIds.push(variableId);
        variableChanges.push({
          type: "updated",
          variableId,
          before: oldValue,
          after: newValue,
          changedFields,
        });
      }
    }
  }
  const libraryCollections = diffLibrarySources(
    before.libraryVariableCollectionsById,
    after.libraryVariableCollectionsById,
    "collectionId",
  );
  const libraryVariables = diffLibrarySources(
    before.libraryVariablesById,
    after.libraryVariablesById,
    "variableId",
  );
  return {
    addedVariableCollectionIds,
    changedVariableCollectionIds,
    removedVariableCollectionIds,
    addedVariableIds,
    changedVariableIds,
    removedVariableIds,
    variableCollectionChanges,
    variableChanges,
    addedLibraryVariableCollectionIds: libraryCollections.addedIds,
    changedLibraryVariableCollectionIds: libraryCollections.changedIds,
    removedLibraryVariableCollectionIds: libraryCollections.removedIds,
    libraryVariableCollectionChanges: libraryCollections.changes,
    addedLibraryVariableIds: libraryVariables.addedIds,
    changedLibraryVariableIds: libraryVariables.changedIds,
    removedLibraryVariableIds: libraryVariables.removedIds,
    libraryVariableChanges: libraryVariables.changes,
  };
}

function diffLibrarySources<
  Source extends object,
  Field extends "collectionId" | "variableId",
>(before: Record<string, Source>, after: Record<string, Source>, field: Field) {
  const addedIds: string[] = [];
  const changedIds: string[] = [];
  const removedIds: string[] = [];
  const changes: Array<
    {
      type: "added" | "updated" | "removed";
      changedFields: string[];
      before?: Source;
      after?: Source;
    } & Record<Field, string>
  > = [];
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previous = before[id];
    const next = after[id];
    if (!previous && next) {
      addedIds.push(id);
      changes.push({
        type: "added",
        [field]: id,
        after: next,
        changedFields: ["source"],
      } as (typeof changes)[number]);
    } else if (previous && !next) {
      removedIds.push(id);
      changes.push({
        type: "removed",
        [field]: id,
        before: previous,
        changedFields: ["source"],
      } as (typeof changes)[number]);
    } else if (
      previous &&
      next &&
      JSON.stringify(previous) !== JSON.stringify(next)
    ) {
      changedIds.push(id);
      changes.push({
        type: "updated",
        [field]: id,
        before: previous,
        after: next,
        changedFields: changedObjectFields(previous, next),
      } as (typeof changes)[number]);
    }
  }
  return { addedIds, changedIds, removedIds, changes };
}

function changedObjectFields(before: object, after: object): string[] {
  const oldRecord = before as Record<string, unknown>;
  const newRecord = after as Record<string, unknown>;
  return [
    ...new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]),
  ].filter(
    (field) =>
      JSON.stringify(oldRecord[field]) !== JSON.stringify(newRecord[field]),
  );
}
