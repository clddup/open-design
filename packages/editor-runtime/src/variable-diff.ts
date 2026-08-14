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
  return {
    addedVariableCollectionIds,
    changedVariableCollectionIds,
    removedVariableCollectionIds,
    addedVariableIds,
    changedVariableIds,
    removedVariableIds,
    variableCollectionChanges,
    variableChanges,
  };
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
