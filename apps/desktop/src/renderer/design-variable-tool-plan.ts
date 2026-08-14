import type {
  DesignDocument,
  VariableDefinition,
} from "@opendesign/design-contracts";
import {
  planAddVariableMode,
  planCreateVariable,
  planCreateVariableCollection,
  planDeleteVariable,
  planDeleteVariableCollection,
  planRemoveVariableMode,
  planSetExplicitVariableMode,
  planSetVariableBinding,
  planUpdateVariable,
  planUpdateVariableCollection,
  type VariableOperationPlan,
} from "@opendesign/editor-runtime";
import type { DesignVariableToolInput } from "../shared/design-agent-tools";

export function planDesignVariableTool(
  document: DesignDocument,
  input: DesignVariableToolInput,
  commandPrefix: string,
): VariableOperationPlan {
  switch (input.action) {
    case "create-collection":
      return planCreateVariableCollection(document, {
        collectionId: input.collectionId,
        key: input.key,
        name: input.name,
        defaultModeId: input.defaultModeId,
        defaultModeName: input.defaultModeName,
        commandPrefix,
      });
    case "rename-collection": {
      const collection = document.variableCollectionsById[input.collectionId];
      return collection
        ? planUpdateVariableCollection(document, {
            collection: { ...structuredClone(collection), name: input.name },
            commandPrefix,
          })
        : missing("Collection", input.collectionId);
    }
    case "delete-collection":
      return planDeleteVariableCollection(document, {
        collectionId: input.collectionId,
        commandPrefix,
      });
    case "add-mode":
      return planAddVariableMode(document, {
        collectionId: input.collectionId,
        modeId: input.modeId,
        name: input.name,
        valuesByVariableId: input.valuesByVariableId,
        commandPrefix,
      });
    case "rename-mode": {
      const collection = document.variableCollectionsById[input.collectionId];
      if (!collection) return missing("Collection", input.collectionId);
      if (!collection.modes.some((mode) => mode.modeId === input.modeId)) {
        return missing("Mode", input.modeId);
      }
      return planUpdateVariableCollection(document, {
        collection: {
          ...structuredClone(collection),
          modes: collection.modes.map((mode) =>
            mode.modeId === input.modeId ? { ...mode, name: input.name } : mode,
          ),
        },
        commandPrefix,
      });
    }
    case "remove-mode":
      return planRemoveVariableMode(document, {
        collectionId: input.collectionId,
        modeId: input.modeId,
        replacementModeId: input.replacementModeId,
        commandPrefix,
      });
    case "create-variable": {
      const variable: VariableDefinition = {
        id: input.variableId,
        key: input.key,
        name: input.name,
        description: "",
        hiddenFromPublishing: false,
        variableCollectionId: input.collectionId,
        resolvedType: input.resolvedType,
        valuesByMode: structuredClone(input.valuesByMode),
        scopes: [...input.scopes],
        codeSyntax: {},
        extensions: {},
      };
      return planCreateVariable(document, { variable, commandPrefix });
    }
    case "set-value": {
      const variable = document.variablesById[input.variableId];
      if (!variable) return missing("Variable", input.variableId);
      return planUpdateVariable(document, {
        variable: {
          ...structuredClone(variable),
          valuesByMode: {
            ...structuredClone(variable.valuesByMode),
            [input.modeId]: structuredClone(input.value),
          },
        },
        commandPrefix,
      });
    }
    case "update-variable": {
      const variable = document.variablesById[input.variableId];
      if (!variable) return missing("Variable", input.variableId);
      return planUpdateVariable(document, {
        variable: {
          ...structuredClone(variable),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.scopes === undefined ? {} : { scopes: [...input.scopes] }),
          ...(input.hiddenFromPublishing === undefined
            ? {}
            : { hiddenFromPublishing: input.hiddenFromPublishing }),
          ...(input.codeSyntax === undefined
            ? {}
            : { codeSyntax: structuredClone(input.codeSyntax) }),
        },
        commandPrefix,
      });
    }
    case "delete-variable":
      return planDeleteVariable(document, {
        variableId: input.variableId,
        commandPrefix,
      });
    case "set-binding":
      return planSetVariableBinding(document, {
        target: input.target,
        variableId: input.variableId,
        commandPrefix,
      });
    case "set-mode":
      return planSetExplicitVariableMode(document, {
        target: input.target,
        collectionId: input.collectionId,
        modeId: input.modeId,
        commandPrefix,
      });
  }
}

function missing(kind: string, id: string): VariableOperationPlan {
  return {
    ok: false,
    code: "not-found",
    message: `${kind} ${id} does not exist`,
  };
}
