import type {
  DesignOperation,
  VariableBindingTarget,
  VariableCollectionDefinition,
  VariableDefinition,
  VariableResolvedDataType,
  VariableValue,
} from "@opendesign/design-contracts";
import {
  planAddVariableMode,
  planCreateVariable,
  planCreateVariableCollection,
  planDeleteVariable,
  planDeleteVariableCollection,
  planMoveVariableCollection,
  planRemoveVariableMode,
  planSetExplicitVariableMode,
  planSetVariableBinding,
  planUpdateVariable,
  planUpdateVariableCollection,
  type EditorRuntime,
  type VariableOperationPlan,
} from "@opendesign/editor-runtime";
import { useCallback } from "react";
import type { MessageKey, MessageParameters } from "../shared/i18n/messages";
import type { VariablesPanelActions } from "./features/editor-workbench/components/VariablesPanel";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useVariableActions({
  applyCommands,
  runtime,
  selectedNodeId,
  setEditorError,
  t,
  transactionCounter,
}: {
  applyCommands: (label: string, commands: DesignOperation[]) => boolean;
  runtime: EditorRuntime;
  selectedNodeId?: string;
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
}): VariableActions {
  const applyPlan = useCallback(
    (label: MessageKey, plan: VariableOperationPlan): boolean => {
      if (!plan.ok) {
        setEditorError(plan.message);
        return false;
      }
      return applyCommands(t(label), plan.commands);
    },
    [applyCommands, setEditorError, t],
  );
  const operation = useCallback(
    (kind: string) =>
      `variable_${kind}_${Date.now()}_${++transactionCounter.current}`,
    [transactionCounter],
  );

  return {
    createCollection(name) {
      const id = operation("collection");
      const modeId = `${id}_mode`;
      return applyPlan(
        "history.createVariableCollection",
        planCreateVariableCollection(runtime.getSnapshot().document, {
          collectionId: id,
          key: `${id}_key`,
          name,
          defaultModeId: modeId,
          defaultModeName: t("variables.defaultMode"),
          commandPrefix: id,
        }),
      );
    },
    updateCollection(collection) {
      return applyPlan(
        "history.updateVariableCollection",
        planUpdateVariableCollection(runtime.getSnapshot().document, {
          collection,
          commandPrefix: operation("collection_update"),
        }),
      );
    },
    moveCollection(collectionId, index) {
      return applyPlan(
        "history.reorderVariableCollections",
        planMoveVariableCollection(runtime.getSnapshot().document, {
          collectionId,
          index,
          commandPrefix: operation("collection_move"),
        }),
      );
    },
    deleteCollection(collectionId) {
      return applyPlan(
        "history.deleteVariableCollection",
        planDeleteVariableCollection(runtime.getSnapshot().document, {
          collectionId,
          commandPrefix: operation("collection_delete"),
        }),
      );
    },
    addMode(collectionId, name, sourceModeId) {
      const document = runtime.getSnapshot().document;
      const collection = document.variableCollectionsById[collectionId];
      if (!collection) return false;
      const modeId = operation("mode");
      const source = sourceModeId ?? collection.defaultModeId;
      return applyPlan(
        "history.addVariableMode",
        planAddVariableMode(document, {
          collectionId,
          modeId,
          name,
          valuesByVariableId: Object.fromEntries(
            collection.variableIds.map((variableId) => [
              variableId,
              structuredClone(
                document.variablesById[variableId].valuesByMode[source],
              ),
            ]),
          ),
          commandPrefix: modeId,
        }),
      );
    },
    removeMode(collectionId, modeId, replacementModeId) {
      return applyPlan(
        "history.deleteVariableMode",
        planRemoveVariableMode(runtime.getSnapshot().document, {
          collectionId,
          modeId,
          replacementModeId,
          commandPrefix: operation("mode_delete"),
        }),
      );
    },
    createVariable(collectionId, name, resolvedType) {
      const document = runtime.getSnapshot().document;
      const collection = document.variableCollectionsById[collectionId];
      if (!collection) return false;
      const id = operation("value");
      const variable: VariableDefinition = {
        id,
        key: `${id}_key`,
        name,
        description: "",
        hiddenFromPublishing: false,
        variableCollectionId: collectionId,
        resolvedType,
        valuesByMode: Object.fromEntries(
          collection.modes.map((mode) => [
            mode.modeId,
            defaultValue(resolvedType),
          ]),
        ),
        scopes: ["ALL_SCOPES"],
        codeSyntax: {},
        extensions: {},
      };
      return applyPlan(
        "history.createVariable",
        planCreateVariable(document, {
          variable,
          commandPrefix: id,
        }),
      );
    },
    updateVariable(variable) {
      return applyPlan(
        "history.updateVariable",
        planUpdateVariable(runtime.getSnapshot().document, {
          variable,
          commandPrefix: operation("value_update"),
        }),
      );
    },
    deleteVariable(variableId) {
      return applyPlan(
        "history.deleteVariable",
        planDeleteVariable(runtime.getSnapshot().document, {
          variableId,
          commandPrefix: operation("value_delete"),
        }),
      );
    },
    setBinding(target, variableId) {
      return applyPlan(
        "history.setVariableBinding",
        planSetVariableBinding(runtime.getSnapshot().document, {
          target,
          variableId,
          commandPrefix: operation("binding"),
        }),
      );
    },
    setExplicitMode(target, collectionId, modeId) {
      return applyPlan(
        "history.setVariableMode",
        planSetExplicitVariableMode(runtime.getSnapshot().document, {
          target,
          collectionId,
          modeId,
          commandPrefix: operation("explicit_mode"),
        }),
      );
    },
    setSelectedNodeMode(collectionId, modeId) {
      if (!selectedNodeId) return false;
      return applyPlan(
        "history.setVariableMode",
        planSetExplicitVariableMode(runtime.getSnapshot().document, {
          target: { kind: "node", id: selectedNodeId },
          collectionId,
          modeId,
          commandPrefix: operation("explicit_mode"),
        }),
      );
    },
  } satisfies VariableActions;
}

export type VariableActions = VariablesPanelActions & {
  setSelectedNodeMode: (collectionId: string, modeId: string | null) => boolean;
};

function defaultValue(type: VariableResolvedDataType): VariableValue {
  if (type === "BOOLEAN") return false;
  if (type === "COLOR") return { r: 0, g: 0, b: 0, a: 1 };
  if (type === "EASING") return { type: "LINEAR" };
  if (type === "STRING") return "";
  return 0;
}

export type {
  VariableBindingTarget,
  VariableCollectionDefinition,
  VariableDefinition,
};
