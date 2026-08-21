export const MAX_DESIGN_SYSTEM_CATALOG_COMPONENTS = 64;
export const MAX_DESIGN_SYSTEM_CATALOG_PROPERTIES = 12;
export const MAX_DESIGN_SYSTEM_CATALOG_CHARACTERS = 12_000;

export type DesignSystemComponentCatalogEntry = {
  componentId: string;
  name: string;
  description?: string;
  descriptionTruncated?: true;
  availability: "current-scope" | "design-file";
  usageCount: number;
  scopeUsageCount: number;
  variantSetId?: string;
  variantProperties: Record<string, string>;
  properties: Array<{
    name: string;
    type: "BOOLEAN" | "TEXT" | "INSTANCE_SWAP" | "SLOT";
  }>;
  propertiesTruncated: boolean;
};

export type DesignSystemComponentCatalog = {
  totalCount: number;
  truncated: boolean;
  components: DesignSystemComponentCatalogEntry[];
};

export function isDesignSystemComponentCatalog(
  value: unknown,
): value is DesignSystemComponentCatalog {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["totalCount", "truncated", "components"])
  ) {
    return false;
  }
  if (
    !Number.isInteger(value.totalCount) ||
    Number(value.totalCount) < 0 ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.components) ||
    value.components.length > MAX_DESIGN_SYSTEM_CATALOG_COMPONENTS ||
    JSON.stringify(value.components).length >
      MAX_DESIGN_SYSTEM_CATALOG_CHARACTERS ||
    Number(value.totalCount) < value.components.length ||
    value.truncated !== Number(value.totalCount) > value.components.length
  ) {
    return false;
  }
  const componentIds = new Set<string>();
  for (const component of value.components) {
    if (!isDesignSystemComponentCatalogEntry(component)) return false;
    if (componentIds.has(component.componentId)) return false;
    componentIds.add(component.componentId);
  }
  return true;
}

function isDesignSystemComponentCatalogEntry(
  value: unknown,
): value is DesignSystemComponentCatalogEntry {
  if (!isRecord(value)) return false;
  const optionalDescription =
    value.description === undefined || safeHumanText(value.description, 240);
  const optionalDescriptionTruncated =
    value.descriptionTruncated === undefined ||
    (value.descriptionTruncated === true && value.description !== undefined);
  const optionalVariantSet =
    value.variantSetId === undefined || safeId(value.variantSetId, 256);
  if (
    !safeId(value.componentId, 256) ||
    !safeHumanText(value.name, 256) ||
    !optionalDescription ||
    !optionalDescriptionTruncated ||
    (value.availability !== "current-scope" &&
      value.availability !== "design-file") ||
    !nonNegativeInteger(value.usageCount) ||
    !nonNegativeInteger(value.scopeUsageCount) ||
    Number(value.scopeUsageCount) > Number(value.usageCount) ||
    !optionalVariantSet ||
    !isStringRecord(value.variantProperties, 12) ||
    !Array.isArray(value.properties) ||
    value.properties.length > MAX_DESIGN_SYSTEM_CATALOG_PROPERTIES ||
    typeof value.propertiesTruncated !== "boolean"
  ) {
    return false;
  }
  const propertyNames = new Set<string>();
  for (const property of value.properties) {
    if (
      !isRecord(property) ||
      !safeId(property.name, 512) ||
      !["BOOLEAN", "TEXT", "INSTANCE_SWAP", "SLOT"].includes(
        String(property.type),
      ) ||
      !exactKeys(property, ["name", "type"]) ||
      propertyNames.has(property.name)
    ) {
      return false;
    }
    propertyNames.add(property.name);
  }
  return exactKeys(value, [
    "componentId",
    "name",
    ...(value.description === undefined ? [] : ["description"]),
    ...(value.descriptionTruncated === undefined
      ? []
      : ["descriptionTruncated"]),
    "availability",
    "usageCount",
    "scopeUsageCount",
    ...(value.variantSetId === undefined ? [] : ["variantSetId"]),
    "variantProperties",
    "properties",
    "propertiesTruncated",
  ]);
}

function isStringRecord(value: unknown, maxProperties: number): boolean {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= maxProperties &&
    entries.every(([key, item]) => safeId(key, 512) && safeHumanText(item, 512))
  );
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0;
}

function safeId(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  );
}

function safeHumanText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        ((codePoint <= 31 && ![9, 10, 13].includes(codePoint)) ||
          codePoint === 127)
      );
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}
