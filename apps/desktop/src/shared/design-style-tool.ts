import type { StyleReferenceTarget } from "@opendesign/design-contracts";
import type { DesignStyleToolInput } from "./design-style-tool-contract";

export type { DesignStyleToolInput } from "./design-style-tool-contract";

const fields = new Set<StyleReferenceTarget["field"]>([
  "fillStyleId",
  "strokeStyleId",
  "effectStyleId",
  "textStyleId",
  "gridStyleId",
]);

export function isDesignStyleToolInput(
  input: unknown,
): input is DesignStyleToolInput {
  if (
    !record(input) ||
    !id(input.pageId) ||
    !text(input.label, 256) ||
    typeof input.action !== "string"
  )
    return false;
  const base = ["action", "label", "pageId"];
  switch (input.action) {
    case "create-from-node":
      return (
        id(input.nodeId) &&
        field(input.field) &&
        id(input.styleId) &&
        id(input.key) &&
        text(input.name, 512) &&
        (input.description === undefined ||
          text(input.description, 2000, true)) &&
        exact(input, [
          ...base,
          "nodeId",
          "field",
          "styleId",
          "key",
          "name",
          ...(input.description === undefined ? [] : ["description"]),
        ])
      );
    case "update-from-node":
      return (
        id(input.nodeId) &&
        field(input.field) &&
        id(input.styleId) &&
        exact(input, [...base, "nodeId", "field", "styleId"])
      );
    case "update-metadata": {
      const hasUpdate =
        input.name !== undefined ||
        input.description !== undefined ||
        input.hiddenFromPublishing !== undefined;
      return (
        id(input.styleId) &&
        hasUpdate &&
        (input.name === undefined || text(input.name, 512)) &&
        (input.description === undefined ||
          text(input.description, 2000, true)) &&
        (input.hiddenFromPublishing === undefined ||
          typeof input.hiddenFromPublishing === "boolean") &&
        exact(input, [
          ...base,
          "styleId",
          ...(input.name === undefined ? [] : ["name"]),
          ...(input.description === undefined ? [] : ["description"]),
          ...(input.hiddenFromPublishing === undefined
            ? []
            : ["hiddenFromPublishing"]),
        ])
      );
    }
    case "move":
      return (
        id(input.styleId) &&
        Number.isInteger(input.index) &&
        (input.index as number) >= 0 &&
        (input.index as number) <= 9999 &&
        exact(input, [...base, "styleId", "index"])
      );
    case "delete":
      return id(input.styleId) && exact(input, [...base, "styleId"]);
    case "set-reference":
      return (
        id(input.nodeId) &&
        field(input.field) &&
        (input.styleId === null || id(input.styleId)) &&
        exact(input, [...base, "nodeId", "field", "styleId"])
      );
    default:
      return false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}
function text(value: unknown, max: number, empty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (empty || value.trim().length > 0)
  );
}
function field(value: unknown): value is StyleReferenceTarget["field"] {
  return fields.has(value as StyleReferenceTarget["field"]);
}
function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}
