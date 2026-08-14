import {
  ComponentOverridePatchSchema,
  schemaValidationIssues,
  type ComponentPropertyAssignment,
  type ComponentPropertyType,
  type InstanceSwapPreferredValue,
} from "@opendesign/design-contracts";

export type DesignComponentToolInput =
  | {
      action: "create-component";
      label: string;
      pageId: string;
      nodeId: string;
      componentId: string;
      name: string;
    }
  | {
      action: "create-instance";
      label: string;
      pageId: string;
      componentId: string;
      instanceId: string;
      parentId: string | null;
      index: number;
      x: number;
      y: number;
      name?: string;
    }
  | {
      action: "remove-component";
      label: string;
      pageId: string;
      componentId: string;
    }
  | {
      action: "add-property";
      label: string;
      pageId: string;
      componentId: string;
      propertyId: string;
      name: string;
      type: ComponentPropertyType;
      sourceNodeId: string;
      preferredValues?: InstanceSwapPreferredValue[];
    }
  | {
      action: "rename-property";
      label: string;
      pageId: string;
      componentId: string;
      propertyName: string;
      name: string;
    }
  | {
      action: "remove-property";
      label: string;
      pageId: string;
      componentId: string;
      propertyName: string;
    }
  | {
      action: "set-property";
      label: string;
      pageId: string;
      instanceId: string;
      propertyName: string;
      value: ComponentPropertyAssignment;
    }
  | {
      action: "reset-property";
      label: string;
      pageId: string;
      instanceId: string;
      propertyName: string;
    }
  | {
      action: "set-override";
      label: string;
      pageId: string;
      instanceId: string;
      sourcePath: string[];
      patch: Record<string, unknown>;
    }
  | {
      action: "reset-overrides";
      label: string;
      pageId: string;
      instanceId: string;
      sourcePath?: string[];
    }
  | {
      action: "detach-instance";
      label: string;
      pageId: string;
      instanceId: string;
    }
  | {
      action: "go-to-main";
      pageId: string;
      instanceId: string;
    };

export function isDesignComponentToolInput(
  input: unknown,
): input is DesignComponentToolInput {
  if (
    !isRecord(input) ||
    typeof input.action !== "string" ||
    !id(input.pageId)
  ) {
    return false;
  }
  if (
    input.action !== "go-to-main" &&
    (!boundedString(input.label, 256) || input.label.length === 0)
  ) {
    return false;
  }
  switch (input.action) {
    case "create-component":
      return (
        id(input.nodeId) &&
        id(input.componentId) &&
        boundedString(input.name, 256) &&
        input.name.length > 0 &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "nodeId",
          "componentId",
          "name",
        ])
      );
    case "create-instance":
      return (
        id(input.componentId) &&
        id(input.instanceId) &&
        (input.parentId === null || id(input.parentId)) &&
        Number.isInteger(input.index) &&
        (input.index as number) >= 0 &&
        finite(input.x) &&
        finite(input.y) &&
        (input.name === undefined || id(input.name)) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "componentId",
          "instanceId",
          "parentId",
          "index",
          "x",
          "y",
          ...(input.name === undefined ? [] : ["name"]),
        ])
      );
    case "remove-component":
      return (
        id(input.componentId) &&
        exactKeys(input, ["action", "label", "pageId", "componentId"])
      );
    case "add-property":
      return (
        id(input.componentId) &&
        id(input.propertyId) &&
        boundedString(input.name, 256) &&
        input.name.trim().length > 0 &&
        componentPropertyType(input.type) &&
        id(input.sourceNodeId) &&
        (input.preferredValues === undefined ||
          preferredValues(input.preferredValues)) &&
        (input.type === "INSTANCE_SWAP" ||
          input.preferredValues === undefined ||
          input.preferredValues.length === 0) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "componentId",
          "propertyId",
          "name",
          "type",
          "sourceNodeId",
          ...(input.preferredValues === undefined ? [] : ["preferredValues"]),
        ])
      );
    case "rename-property":
      return (
        id(input.componentId) &&
        propertyName(input.propertyName) &&
        boundedString(input.name, 256) &&
        input.name.trim().length > 0 &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "componentId",
          "propertyName",
          "name",
        ])
      );
    case "remove-property":
      return (
        id(input.componentId) &&
        propertyName(input.propertyName) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "componentId",
          "propertyName",
        ])
      );
    case "set-property":
      return (
        id(input.instanceId) &&
        propertyName(input.propertyName) &&
        componentPropertyValue(input.value) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "instanceId",
          "propertyName",
          "value",
        ])
      );
    case "reset-property":
      return (
        id(input.instanceId) &&
        propertyName(input.propertyName) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "instanceId",
          "propertyName",
        ])
      );
    case "set-override":
      return (
        id(input.instanceId) &&
        sourcePath(input.sourcePath) &&
        schemaValidationIssues(ComponentOverridePatchSchema, input.patch)
          .length === 0 &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "instanceId",
          "sourcePath",
          "patch",
        ])
      );
    case "reset-overrides":
      return (
        id(input.instanceId) &&
        (input.sourcePath === undefined || sourcePath(input.sourcePath)) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "instanceId",
          ...(input.sourcePath === undefined ? [] : ["sourcePath"]),
        ])
      );
    case "detach-instance":
      return (
        id(input.instanceId) &&
        exactKeys(input, ["action", "label", "pageId", "instanceId"])
      );
    case "go-to-main":
      return (
        id(input.instanceId) &&
        exactKeys(input, ["action", "pageId", "instanceId"])
      );
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  input: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(input).length === expected.size &&
    Object.keys(input).every((key) => expected.has(key))
  );
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function id(value: unknown): value is string {
  return boundedString(value, 256) && value.length > 0;
}

function propertyName(value: unknown): value is string {
  return boundedString(value, 512) && value.length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sourcePath(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    value.every(id)
  );
}

function componentPropertyType(value: unknown): value is ComponentPropertyType {
  return value === "BOOLEAN" || value === "TEXT" || value === "INSTANCE_SWAP";
}

function componentPropertyValue(
  value: unknown,
): value is ComponentPropertyAssignment {
  return typeof value === "boolean" || boundedString(value, 100_000);
}

function preferredValues(
  value: unknown,
): value is InstanceSwapPreferredValue[] {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every(
      (candidate) =>
        isRecord(candidate) &&
        (candidate.type === "COMPONENT" ||
          candidate.type === "COMPONENT_SET") &&
        id(candidate.key) &&
        exactKeys(candidate, ["type", "key"]),
    )
  );
}
