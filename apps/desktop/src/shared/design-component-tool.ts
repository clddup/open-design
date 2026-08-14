import {
  ComponentOverridePatchSchema,
  schemaValidationIssues,
  type ComponentPropertyAssignment,
  type ComponentPropertyType,
  type InstanceSwapPreferredValue,
  type SlotSettings,
} from "@opendesign/design-contracts";

import type { DesignComponentToolInput } from "./design-component-tool-contract";
export type { DesignComponentToolInput } from "./design-component-tool-contract";

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
    case "combine-as-variants":
      return (
        idArray(input.componentIds, 2, 128) &&
        idArray(input.componentRootNodeIds, 2, 128) &&
        input.componentIds.length === input.componentRootNodeIds.length &&
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        boundedString(input.name, 256) &&
        input.name.trim().length > 0 &&
        variantPropertyMatrix(
          input.variantPropertiesByComponentId,
          input.componentIds,
        ) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "componentIds",
          "componentRootNodeIds",
          "variantSetId",
          "rootNodeId",
          "name",
          "variantPropertiesByComponentId",
        ])
      );
    case "add-component-to-variant-set":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        id(input.componentId) &&
        id(input.componentRootNodeId) &&
        variantProperties(input.variantProperties) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
          "componentId",
          "componentRootNodeId",
          "variantProperties",
        ])
      );
    case "duplicate-variant":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        id(input.sourceComponentId) &&
        id(input.sourceRootNodeId) &&
        id(input.componentId) &&
        id(input.componentRootNodeId) &&
        (input.name === undefined || boundedString(input.name, 256)) &&
        variantProperties(input.variantProperties) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
          "sourceComponentId",
          "sourceRootNodeId",
          "componentId",
          "componentRootNodeId",
          ...(input.name === undefined ? [] : ["name"]),
          "variantProperties",
        ])
      );
    case "remove-variant":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        id(input.componentId) &&
        id(input.componentRootNodeId) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
          "componentId",
          "componentRootNodeId",
        ])
      );
    case "dissolve-variant-set":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
        ])
      );
    case "add-variant-property":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        propertyName(input.propertyName) &&
        variantProperties(input.valuesByComponentId) &&
        (input.index === undefined ||
          (Number.isInteger(input.index) && (input.index as number) >= 0)) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
          "propertyName",
          "valuesByComponentId",
          ...(input.index === undefined ? [] : ["index"]),
        ])
      );
    case "rename-variant-property":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        propertyName(input.propertyName) &&
        boundedString(input.name, 256) &&
        input.name.trim().length > 0 &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
          "propertyName",
          "name",
        ])
      );
    case "reorder-variant-properties":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        idArray(input.propertyOrder, 1, 128) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
          "propertyOrder",
        ])
      );
    case "remove-variant-property":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        propertyName(input.propertyName) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
          "propertyName",
        ])
      );
    case "rename-variant-value":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        propertyName(input.propertyName) &&
        boundedString(input.value, 256) &&
        input.value.length > 0 &&
        boundedString(input.name, 256) &&
        input.name.trim().length > 0 &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
          "propertyName",
          "value",
          "name",
        ])
      );
    case "reorder-variant-values":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        propertyName(input.propertyName) &&
        idArray(input.values, 1, 1_024) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
          "propertyName",
          "values",
        ])
      );
    case "set-variant-properties":
      return (
        id(input.variantSetId) &&
        id(input.rootNodeId) &&
        id(input.componentId) &&
        id(input.componentRootNodeId) &&
        variantProperties(input.variantProperties) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "variantSetId",
          "rootNodeId",
          "componentId",
          "componentRootNodeId",
          "variantProperties",
        ])
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
          input.type === "SLOT" ||
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
    case "reorder-properties":
      return (
        id(input.componentId) &&
        id(input.componentRootNodeId) &&
        propertyNameArray(input.componentPropertyOrder, 1, 4_096) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "componentId",
          "componentRootNodeId",
          "componentPropertyOrder",
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
    case "create-slot-override":
    case "clear-slot":
    case "reset-slot":
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
    case "set-slot-settings":
      return (
        id(input.componentId) &&
        propertyName(input.propertyName) &&
        slotSettings(input.settings) &&
        (input.preferredValues === undefined ||
          preferredValues(input.preferredValues)) &&
        (input.description === undefined ||
          boundedString(input.description, 2_000)) &&
        exactKeys(input, [
          "action",
          "label",
          "pageId",
          "componentId",
          "propertyName",
          "settings",
          ...(input.preferredValues === undefined ? [] : ["preferredValues"]),
          ...(input.description === undefined ? [] : ["description"]),
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

function idArray(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    new Set(value).size === value.length &&
    value.every(id)
  );
}

function propertyNameArray(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    new Set(value).size === value.length &&
    value.every(propertyName)
  );
}

function variantPropertyMatrix(
  value: unknown,
  componentIds: readonly string[],
): value is Record<string, Record<string, string>> {
  if (!isRecord(value)) return false;
  const expected = [...componentIds].sort();
  const actual = Object.keys(value).sort();
  if (
    actual.length !== expected.length ||
    actual.some((componentId, index) => componentId !== expected[index])
  ) {
    return false;
  }
  return actual.every((componentId) => {
    const properties = value[componentId];
    return (
      isRecord(properties) &&
      Object.keys(properties).length > 0 &&
      Object.keys(properties).length <= 128 &&
      Object.entries(properties).every(
        ([name, propertyValue]) =>
          name.length > 0 &&
          name.length <= 256 &&
          boundedString(propertyValue, 256) &&
          propertyValue.length > 0,
      )
    );
  });
}

function variantProperties(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).length <= 128 &&
    Object.entries(value).every(
      ([name, propertyValue]) =>
        name.length > 0 &&
        name.length <= 256 &&
        boundedString(propertyValue, 256) &&
        propertyValue.length > 0,
    )
  );
}

function componentPropertyType(value: unknown): value is ComponentPropertyType {
  return (
    value === "BOOLEAN" ||
    value === "TEXT" ||
    value === "INSTANCE_SWAP" ||
    value === "SLOT"
  );
}

function slotSettings(value: unknown): value is SlotSettings {
  if (!isRecord(value)) return false;
  if (
    !exactKeys(value, [
      ...(value.stretchChildOnInsert === undefined
        ? []
        : ["stretchChildOnInsert"]),
      ...(value.displayEmptyByDefault === undefined
        ? []
        : ["displayEmptyByDefault"]),
      ...(value.minChildren === undefined ? [] : ["minChildren"]),
      ...(value.maxChildren === undefined ? [] : ["maxChildren"]),
      ...(value.allowPreferredValuesOnly === undefined
        ? []
        : ["allowPreferredValuesOnly"]),
    ])
  )
    return false;
  const optionalBoolean = (candidate: unknown) =>
    candidate === undefined || typeof candidate === "boolean";
  const count = (candidate: unknown) =>
    candidate === undefined ||
    candidate === null ||
    (Number.isInteger(candidate) &&
      (candidate as number) >= 0 &&
      (candidate as number) <= 4_096);
  return (
    optionalBoolean(value.stretchChildOnInsert) &&
    optionalBoolean(value.displayEmptyByDefault) &&
    count(value.minChildren) &&
    count(value.maxChildren) &&
    optionalBoolean(value.allowPreferredValuesOnly) &&
    !(
      typeof value.minChildren === "number" &&
      typeof value.maxChildren === "number" &&
      value.minChildren > value.maxChildren
    )
  );
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
