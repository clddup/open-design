import { resolveComponentInstance } from "@opendesign/component-service";
import type {
  ComponentDefinition,
  ComponentPropertyReferences as OpenDesignComponentPropertyReferences,
  DesignDocument,
  DesignNode,
  VariantSetDefinition,
} from "@opendesign/design-contracts";

export function toFigmaComponentPropertyDefinitions(
  component: ComponentDefinition,
): ComponentPropertyDefinitions {
  return structuredClone(component.componentPropertyDefinitions);
}

export function toFigmaVariantSetPropertyDefinitions(
  variantSet: VariantSetDefinition,
): ComponentPropertyDefinitions {
  return structuredClone(variantSet.componentPropertyDefinitions);
}

export function toFigmaVariantProperties(
  component: ComponentDefinition,
): NonNullable<ComponentNode["variantProperties"]> | null {
  return component.variantSetId
    ? structuredClone(component.variantProperties)
    : null;
}

export function toFigmaComponentProperties(
  document: DesignDocument,
  instanceId: string,
): ComponentProperties {
  const resolution = resolveComponentInstance(document, instanceId);
  if (!resolution.ok) {
    throw new Error(
      resolution.issues[0]?.message ??
        `Instance ${instanceId} cannot be converted to Figma properties`,
    );
  }
  const result: ComponentProperties = {};
  for (const [propertyName, property] of Object.entries(
    resolution.componentProperties,
  )) {
    result[propertyName] = {
      type: property.type,
      value: property.value,
      ...(property.preferredValues
        ? {
            preferredValues: property.preferredValues.map((preferred) => ({
              ...preferred,
            })),
          }
        : {}),
    };
  }
  return result;
}

export function toFigmaComponentPropertyReferences(
  node: DesignNode,
): NonNullable<SceneNode["componentPropertyReferences"]> | null {
  return node.componentPropertyReferences
    ? structuredClone(
        node.componentPropertyReferences satisfies OpenDesignComponentPropertyReferences,
      )
    : null;
}
