import type { DesignNode } from "@opendesign/design-contracts";

export function nodeChangedFields(
  before: DesignNode,
  after: DesignNode,
): string[] {
  const fields = [
    "name",
    "parentId",
    "childIds",
    "visible",
    "locked",
    "transform",
    "size",
    "opacity",
    "constraints",
    "layoutSizing",
    "layoutLimits",
    "blendMode",
    "effects",
    "maskMode",
    "properties",
    "extensions",
  ] as const;
  return fields.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}
