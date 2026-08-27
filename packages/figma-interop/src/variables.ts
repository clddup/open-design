import type {
  DesignNode,
  VariableAlias as OpenDesignVariableAlias,
  VariableCollectionDefinition,
  VariableDefinition,
} from "@opendesign/design-contracts";

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
