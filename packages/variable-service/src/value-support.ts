import type {
  VariableAlias,
  VariableResolvedDataType,
  VariableValue,
} from "@opendesign/design-contracts";

export function valueMatchesType(
  value: Exclude<VariableValue, VariableAlias>,
  type: VariableResolvedDataType,
): boolean {
  switch (type) {
    case "BOOLEAN":
      return typeof value === "boolean";
    case "COLOR":
      return isColor(value);
    case "EASING":
      return isEasing(value);
    case "FLOAT":
    case "TIMING":
      return typeof value === "number" && Number.isFinite(value);
    case "STRING":
      return typeof value === "string";
  }
}

export function isVariableAlias(value: VariableValue): value is VariableAlias {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "VARIABLE_ALIAS" &&
    "id" in value &&
    typeof value.id === "string"
  );
}

export function isColor(
  value: unknown,
): value is { r: number; g: number; b: number; a?: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "r" in value &&
    "g" in value &&
    "b" in value &&
    typeof value.r === "number" &&
    typeof value.g === "number" &&
    typeof value.b === "number" &&
    (!("a" in value) || typeof value.a === "number")
  );
}

export function colorToHex(value: { r: number; g: number; b: number }): string {
  const channel = (number: number) =>
    Math.round(number * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(value.r)}${channel(value.g)}${channel(value.b)}`;
}

function isEasing(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    value.type !== "VARIABLE_ALIAS"
  );
}
