import type {
  DesignChangeSet,
  DesignDocument,
} from "@opendesign/design-contracts";

export function diffStyles(
  before: DesignDocument,
  after: DesignDocument,
): Pick<
  DesignChangeSet,
  "addedStyleIds" | "changedStyleIds" | "removedStyleIds" | "styleChanges"
> {
  const addedStyleIds: string[] = [];
  const changedStyleIds: string[] = [];
  const removedStyleIds: string[] = [];
  const styleChanges: NonNullable<DesignChangeSet["styleChanges"]> = [];
  const ids = new Set([
    ...Object.keys(before.stylesById),
    ...Object.keys(after.stylesById),
  ]);
  for (const styleId of ids) {
    const oldValue = before.stylesById[styleId];
    const newValue = after.stylesById[styleId];
    if (!oldValue && newValue) {
      addedStyleIds.push(styleId);
      styleChanges.push({
        type: "added",
        styleId,
        after: newValue,
        changedFields: ["style"],
      });
    } else if (oldValue && !newValue) {
      removedStyleIds.push(styleId);
      styleChanges.push({
        type: "removed",
        styleId,
        before: oldValue,
        changedFields: ["style"],
      });
    } else if (oldValue && newValue) {
      const changedFields = objectChanges(oldValue, newValue);
      const moved =
        before.styleOrderByType[oldValue.styleType].indexOf(styleId) !==
        after.styleOrderByType[newValue.styleType].indexOf(styleId);
      if (changedFields.length > 0 || moved) {
        changedStyleIds.push(styleId);
        styleChanges.push({
          type: moved ? "moved" : "updated",
          styleId,
          before: oldValue,
          after: newValue,
          changedFields: moved
            ? [...new Set([...changedFields, "styleOrder"])]
            : changedFields,
        });
      }
    }
  }
  return { addedStyleIds, changedStyleIds, removedStyleIds, styleChanges };
}

function objectChanges(before: object, after: object): string[] {
  const oldValue = before as Record<string, unknown>;
  const newValue = after as Record<string, unknown>;
  return [
    ...new Set([...Object.keys(oldValue), ...Object.keys(newValue)]),
  ].filter(
    (field) =>
      JSON.stringify(oldValue[field]) !== JSON.stringify(newValue[field]),
  );
}
