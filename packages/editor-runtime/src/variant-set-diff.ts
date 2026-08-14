import type {
  DesignChangeSet,
  DesignDocument,
} from "@opendesign/design-contracts";

export function diffVariantSets(
  before: DesignDocument,
  after: DesignDocument,
): Pick<
  DesignChangeSet,
  | "addedVariantSetIds"
  | "changedVariantSetIds"
  | "removedVariantSetIds"
  | "variantSetChanges"
> {
  const addedVariantSetIds: string[] = [];
  const changedVariantSetIds: string[] = [];
  const removedVariantSetIds: string[] = [];
  const variantSetChanges: NonNullable<DesignChangeSet["variantSetChanges"]> =
    [];
  const variantSetIds = new Set([
    ...Object.keys(before.variantSetsById),
    ...Object.keys(after.variantSetsById),
  ]);
  for (const variantSetId of variantSetIds) {
    const oldVariantSet = before.variantSetsById[variantSetId];
    const newVariantSet = after.variantSetsById[variantSetId];
    if (!oldVariantSet && newVariantSet) {
      addedVariantSetIds.push(variantSetId);
      variantSetChanges.push({
        type: "added",
        variantSetId,
        after: newVariantSet,
        changedFields: ["variantSet"],
      });
      continue;
    }
    if (oldVariantSet && !newVariantSet) {
      removedVariantSetIds.push(variantSetId);
      variantSetChanges.push({
        type: "removed",
        variantSetId,
        before: oldVariantSet,
        changedFields: ["variantSet"],
      });
      continue;
    }
    if (!oldVariantSet || !newVariantSet) continue;
    const changedFields = [
      "name",
      "rootNodeId",
      "defaultComponentId",
      "componentPropertyDefinitions",
      "description",
      "extensions",
    ].filter(
      (field) =>
        JSON.stringify(oldVariantSet[field as keyof typeof oldVariantSet]) !==
        JSON.stringify(newVariantSet[field as keyof typeof newVariantSet]),
    );
    if (changedFields.length === 0) continue;
    changedVariantSetIds.push(variantSetId);
    variantSetChanges.push({
      type: "updated",
      variantSetId,
      before: oldVariantSet,
      after: newVariantSet,
      changedFields,
    });
  }
  return {
    addedVariantSetIds,
    changedVariantSetIds,
    removedVariantSetIds,
    variantSetChanges,
  };
}
