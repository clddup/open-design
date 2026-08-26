import type { DesignComponentToolInput } from "./design-component-tool-contract";
import { DESIGN_COMPONENT_TOOL_INPUT_SCHEMA } from "./design-component-tool-schema";
import { defineContract, type ValidationIssue } from "./contract-validation";

export type { DesignComponentToolInput } from "./design-component-tool-contract";

export const DesignComponentContract = defineContract<DesignComponentToolInput>(
  {
    schema: DESIGN_COMPONENT_TOOL_INPUT_SCHEMA,
    code: "design_component.schema_invalid",
    subject: "Component",
    maximum: 32,
    refine: refineDesignComponent,
  },
);

function refineDesignComponent(
  input: DesignComponentToolInput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (input.action === "combine-as-variants") {
    if (input.componentRootNodeIds.length !== input.componentIds.length) {
      issues.push({
        code: "design_component.component_root_count_mismatch",
        path: "/componentRootNodeIds",
        message:
          "componentRootNodeIds must contain one current root for every componentId",
        expected: input.componentIds.length,
        actual: input.componentRootNodeIds.length,
        recovery:
          "Inspect the Component Mains and submit one root ID at the matching componentIds index.",
      });
    }
    const expectedComponentIds = [...input.componentIds].sort();
    const actualComponentIds = Object.keys(
      input.variantPropertiesByComponentId,
    ).sort();
    if (!sameStrings(expectedComponentIds, actualComponentIds)) {
      issues.push({
        code: "design_component.variant_matrix_members_mismatch",
        path: "/variantPropertiesByComponentId",
        message:
          "variantPropertiesByComponentId must define exactly every componentId once",
        expected: expectedComponentIds,
        actual: actualComponentIds,
        recovery:
          "Use the same inspected Component IDs as componentIds and provide one complete property map for each member.",
      });
    }
    for (const properties of Object.values(
      input.variantPropertiesByComponentId,
    )) {
      validatePropertyNames(
        properties,
        "/variantPropertiesByComponentId",
        issues,
      );
    }
  }

  if (
    input.action === "add-component-to-variant-set" ||
    input.action === "duplicate-variant" ||
    input.action === "set-variant-properties"
  ) {
    validatePropertyNames(
      input.variantProperties,
      "/variantProperties",
      issues,
    );
  }
  if (input.action === "add-variant-property") {
    validatePropertyNames(
      input.valuesByComponentId,
      "/valuesByComponentId",
      issues,
    );
  }

  if (
    input.action === "add-property" &&
    input.preferredValues !== undefined &&
    input.preferredValues.length > 0 &&
    input.type !== "INSTANCE_SWAP" &&
    input.type !== "SLOT"
  ) {
    issues.push({
      code: "design_component.preferred_values_not_supported",
      path: "/preferredValues",
      message:
        "preferredValues are supported only by INSTANCE_SWAP and SLOT properties",
      expected: ["INSTANCE_SWAP", "SLOT"],
      actual: input.type,
      recovery:
        "Remove preferredValues or choose the property type that owns component recommendations.",
    });
  }

  if (
    input.action === "set-slot-settings" &&
    typeof input.settings.minChildren === "number" &&
    typeof input.settings.maxChildren === "number" &&
    input.settings.minChildren > input.settings.maxChildren
  ) {
    issues.push({
      code: "design_component.slot_child_range_invalid",
      path: "/settings/maxChildren",
      message: "maxChildren must be greater than or equal to minChildren",
      expected: { minimum: input.settings.minChildren },
      actual: input.settings.maxChildren,
      recovery:
        "Revise the Slot child-count range without changing the Component property identity.",
    });
  }

  return issues;
}

function validatePropertyNames(
  properties: Readonly<Record<string, string>>,
  path: string,
  issues: ValidationIssue[],
): void {
  const invalid = Object.keys(properties).find(
    (name) => name.length === 0 || name.length > 256,
  );
  if (!invalid) return;
  issues.push({
    code: "design_component.variant_property_name_invalid",
    path,
    message: "Variant property names must contain 1 to 256 characters",
    actual: invalid,
    recovery:
      "Use the current inspected Variant property name or one bounded new property name.",
  });
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
