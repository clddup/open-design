import {
  VariableValueSchema,
  schemaValidationIssues,
  type VariableBindingTarget,
  type VariableResolvedDataType,
  type VariableScope,
  type VariableValue,
} from "@opendesign/design-contracts";
import type { DesignVariableToolInput } from "./design-variable-tool-contract";

export type { DesignVariableToolInput } from "./design-variable-tool-contract";

const types = new Set<VariableResolvedDataType>([
  "BOOLEAN",
  "COLOR",
  "EASING",
  "FLOAT",
  "STRING",
  "TIMING",
]);
const scopes = new Set<VariableScope>([
  "ALL_SCOPES",
  "TEXT_CONTENT",
  "CORNER_RADIUS",
  "WIDTH_HEIGHT",
  "GAP",
  "ALL_FILLS",
  "FRAME_FILL",
  "SHAPE_FILL",
  "TEXT_FILL",
  "STROKE_COLOR",
  "STROKE_FLOAT",
  "EFFECT_FLOAT",
  "EFFECT_COLOR",
  "OPACITY",
  "FONT_FAMILY",
  "FONT_STYLE",
  "FONT_WEIGHT",
  "FONT_SIZE",
  "LINE_HEIGHT",
  "LETTER_SPACING",
  "PARAGRAPH_SPACING",
  "PARAGRAPH_INDENT",
]);

export function isDesignVariableToolInput(
  input: unknown,
): input is DesignVariableToolInput {
  if (
    !record(input) ||
    !id(input.pageId) ||
    !text(input.label, 256) ||
    typeof input.action !== "string"
  ) {
    return false;
  }
  const base = ["action", "label", "pageId"];
  switch (input.action) {
    case "create-collection":
      return (
        id(input.collectionId) &&
        id(input.key) &&
        text(input.name, 256) &&
        id(input.defaultModeId) &&
        text(input.defaultModeName, 256) &&
        exact(input, [
          ...base,
          "collectionId",
          "key",
          "name",
          "defaultModeId",
          "defaultModeName",
        ])
      );
    case "rename-collection":
      return (
        id(input.collectionId) &&
        text(input.name, 256) &&
        exact(input, [...base, "collectionId", "name"])
      );
    case "delete-collection":
      return id(input.collectionId) && exact(input, [...base, "collectionId"]);
    case "add-mode":
      return (
        id(input.collectionId) &&
        id(input.modeId) &&
        text(input.name, 256) &&
        valueRecord(input.valuesByVariableId) &&
        exact(input, [
          ...base,
          "collectionId",
          "modeId",
          "name",
          "valuesByVariableId",
        ])
      );
    case "rename-mode":
      return (
        id(input.collectionId) &&
        id(input.modeId) &&
        text(input.name, 256) &&
        exact(input, [...base, "collectionId", "modeId", "name"])
      );
    case "remove-mode":
      return (
        id(input.collectionId) &&
        id(input.modeId) &&
        id(input.replacementModeId) &&
        exact(input, [...base, "collectionId", "modeId", "replacementModeId"])
      );
    case "create-variable":
      return (
        id(input.variableId) &&
        id(input.key) &&
        id(input.collectionId) &&
        text(input.name, 512) &&
        types.has(input.resolvedType as VariableResolvedDataType) &&
        valueRecord(input.valuesByMode) &&
        scopeArray(input.scopes) &&
        exact(input, [
          ...base,
          "variableId",
          "key",
          "collectionId",
          "name",
          "resolvedType",
          "valuesByMode",
          "scopes",
        ])
      );
    case "set-value":
      return (
        id(input.variableId) &&
        id(input.modeId) &&
        variableValue(input.value) &&
        exact(input, [...base, "variableId", "modeId", "value"])
      );
    case "update-variable":
      return (
        id(input.variableId) &&
        (input.name === undefined || text(input.name, 512)) &&
        (input.description === undefined ||
          text(input.description, 2_000, true)) &&
        (input.scopes === undefined || scopeArray(input.scopes)) &&
        (input.hiddenFromPublishing === undefined ||
          typeof input.hiddenFromPublishing === "boolean") &&
        (input.codeSyntax === undefined || codeSyntax(input.codeSyntax)) &&
        exact(input, [
          ...base,
          "variableId",
          ...(input.name === undefined ? [] : ["name"]),
          ...(input.description === undefined ? [] : ["description"]),
          ...(input.scopes === undefined ? [] : ["scopes"]),
          ...(input.hiddenFromPublishing === undefined
            ? []
            : ["hiddenFromPublishing"]),
          ...(input.codeSyntax === undefined ? [] : ["codeSyntax"]),
        ])
      );
    case "delete-variable":
      return id(input.variableId) && exact(input, [...base, "variableId"]);
    case "set-binding":
      return (
        bindingTarget(input.target) &&
        (input.variableId === null || id(input.variableId)) &&
        exact(input, [...base, "target", "variableId"])
      );
    case "set-mode":
      return (
        modeTarget(input.target) &&
        id(input.collectionId) &&
        (input.modeId === null || id(input.modeId)) &&
        exact(input, [...base, "target", "collectionId", "modeId"])
      );
    default:
      return false;
  }
}

function bindingTarget(value: unknown): value is VariableBindingTarget {
  if (!record(value) || !id(value.nodeId) || typeof value.kind !== "string")
    return false;
  if (value.kind === "node") {
    return (
      (value.field === "visible" ||
        value.field === "opacity" ||
        value.field === "characters") &&
      exact(value, ["kind", "nodeId", "field"])
    );
  }
  return (
    value.kind === "paint" &&
    (value.paintField === "fills" || value.paintField === "strokes") &&
    Number.isInteger(value.paintIndex) &&
    (value.paintIndex as number) >= 0 &&
    value.field === "color" &&
    exact(value, ["kind", "nodeId", "paintField", "paintIndex", "field"])
  );
}

function modeTarget(
  value: unknown,
): value is { kind: "page" | "node"; id: string } {
  return (
    record(value) &&
    (value.kind === "page" || value.kind === "node") &&
    id(value.id) &&
    exact(value, ["kind", "id"])
  );
}

function valueRecord(value: unknown): value is Record<string, VariableValue> {
  return (
    record(value) &&
    Object.keys(value).length <= 5_000 &&
    Object.entries(value).every(
      ([key, entry]) => id(key) && variableValue(entry),
    )
  );
}

function variableValue(value: unknown): value is VariableValue {
  return schemaValidationIssues(VariableValueSchema, value).length === 0;
}

function scopeArray(value: unknown): value is VariableScope[] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    new Set(value).size === value.length &&
    value.every((entry) => scopes.has(entry as VariableScope))
  );
}

function codeSyntax(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, Object.keys(value)) &&
    Object.keys(value).every(
      (key) => key === "WEB" || key === "ANDROID" || key === "iOS",
    ) &&
    Object.values(value).every((entry) => text(entry, 512, true))
  );
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
