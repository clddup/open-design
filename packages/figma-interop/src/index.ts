import { resolveComponentInstance } from "@opendesign/component-service";
import type {
  ComponentDefinition,
  ComponentPropertyReferences as OpenDesignComponentPropertyReferences,
  DesignDocument,
  DesignNode,
  VariableAlias as OpenDesignVariableAlias,
  VariableCollectionDefinition,
  VariableDefinition,
  VariantSetDefinition,
} from "@opendesign/design-contracts";

export const FIGMA_PLUGIN_TYPINGS_VERSION = "1.133.0" as const;
export const FIGMA_PLUGIN_TYPINGS_COMMIT =
  "83bfe81d9616ab759702f657eb18ef153f83e8ae" as const;

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

export function toFigmaVariableCollection(
  collection: VariableCollectionDefinition,
): Pick<
  VariableCollection,
  | "id"
  | "key"
  | "name"
  | "hiddenFromPublishing"
  | "modes"
  | "variableIds"
  | "defaultModeId"
> {
  return {
    id: collection.id,
    key: collection.key,
    name: collection.name,
    hiddenFromPublishing: collection.hiddenFromPublishing,
    modes: structuredClone(collection.modes),
    variableIds: [...collection.variableIds],
    defaultModeId: collection.defaultModeId,
  };
}

export function toFigmaVariable(
  variable: VariableDefinition,
): Pick<
  Variable,
  | "id"
  | "key"
  | "name"
  | "description"
  | "hiddenFromPublishing"
  | "variableCollectionId"
  | "resolvedType"
  | "valuesByMode"
  | "scopes"
  | "codeSyntax"
> {
  return {
    id: variable.id,
    key: variable.key,
    name: variable.name,
    description: variable.description,
    hiddenFromPublishing: variable.hiddenFromPublishing,
    variableCollectionId: variable.variableCollectionId,
    resolvedType: variable.resolvedType,
    valuesByMode: structuredClone(variable.valuesByMode),
    scopes: [...variable.scopes],
    codeSyntax: structuredClone(variable.codeSyntax),
  };
}

export function toFigmaExplicitVariableModes(
  owner: Pick<DesignNode, "explicitVariableModes">,
): SceneNode["explicitVariableModes"] {
  return structuredClone(owner.explicitVariableModes ?? {});
}

export function toFigmaNodeBoundVariables(
  node: DesignNode,
): Partial<
  Record<"visible" | "opacity" | "characters", OpenDesignVariableAlias>
> {
  return structuredClone(node.boundVariables ?? {});
}
