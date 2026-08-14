import { resolveComponentInstance } from "@opendesign/component-service";
import type {
  ComponentDefinition,
  ComponentPropertyReferences as OpenDesignComponentPropertyReferences,
  DesignDocument,
  DesignNode,
} from "@opendesign/design-contracts";

export const FIGMA_PLUGIN_TYPINGS_VERSION = "1.133.0" as const;
export const FIGMA_PLUGIN_TYPINGS_COMMIT =
  "83bfe81d9616ab759702f657eb18ef153f83e8ae" as const;

export function toFigmaComponentPropertyDefinitions(
  component: ComponentDefinition,
): ComponentPropertyDefinitions {
  return structuredClone(component.componentPropertyDefinitions);
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
