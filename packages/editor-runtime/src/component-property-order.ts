import type { ComponentDefinition } from "@opendesign/design-contracts";

export interface ComponentPropertyOrderIssue {
  path: string;
  message: string;
}

export function validateComponentPropertyOrder(
  componentId: string,
  component: ComponentDefinition,
): ComponentPropertyOrderIssue[] {
  const definitions = Object.keys(component.componentPropertyDefinitions);
  const ordered = new Set(component.componentPropertyOrder);
  if (
    definitions.length === component.componentPropertyOrder.length &&
    ordered.size === component.componentPropertyOrder.length &&
    definitions.every((name) => ordered.has(name))
  ) {
    return [];
  }
  return [
    {
      path: `/componentsById/${componentId}/componentPropertyOrder`,
      message:
        "component property order must contain every ordinary component property exactly once",
    },
  ];
}
