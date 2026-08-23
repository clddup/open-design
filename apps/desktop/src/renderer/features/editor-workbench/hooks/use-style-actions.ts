import type {
  DesignOperation,
  SharedStyleDefinition,
  StyleReferenceTarget,
} from "@opendesign/design-contracts";
import {
  planCreateStyleFromNode,
  planDeleteStyle,
  planMoveStyle,
  planSetStyleReference,
  planUpdateStyle,
  planUpdateStyleFromNode,
  type EditorRuntime,
  type StyleOperationPlan,
} from "@opendesign/editor-runtime";
import { useCallback } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import type { LocalStylesPanelActions } from "../components/LocalStylesPanel";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useStyleActions({
  applyCommands,
  runtime,
  setEditorError,
  t,
  transactionCounter,
}: {
  applyCommands: (label: string, commands: DesignOperation[]) => boolean;
  runtime: EditorRuntime;
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
}): LocalStylesPanelActions {
  const applyPlan = useCallback(
    (label: MessageKey, plan: StyleOperationPlan): boolean => {
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
      `style_${kind}_${Date.now()}_${++transactionCounter.current}`,
    [transactionCounter],
  );
  return {
    createFromNode(nodeId, field, name) {
      const id = operation("local");
      return applyPlan(
        "history.createStyle",
        planCreateStyleFromNode(runtime.getSnapshot().document, {
          nodeId,
          field,
          styleId: id,
          key: `${id}_key`,
          name,
          commandPrefix: id,
        }),
      );
    },
    updateStyle(style) {
      return applyPlan(
        "history.updateStyle",
        planUpdateStyle(runtime.getSnapshot().document, {
          style,
          commandPrefix: operation("update"),
        }),
      );
    },
    updateFromNode(styleId, nodeId, field) {
      return applyPlan(
        "history.updateStyle",
        planUpdateStyleFromNode(runtime.getSnapshot().document, {
          styleId,
          nodeId,
          field,
          commandPrefix: operation("update_from_node"),
        }),
      );
    },
    moveStyle(styleId, index) {
      return applyPlan(
        "history.reorderStyles",
        planMoveStyle(runtime.getSnapshot().document, {
          styleId,
          index,
          commandPrefix: operation("move"),
        }),
      );
    },
    deleteStyle(styleId) {
      return applyPlan(
        "history.deleteStyle",
        planDeleteStyle(runtime.getSnapshot().document, {
          styleId,
          commandPrefix: operation("delete"),
        }),
      );
    },
    setReference(target, styleId) {
      return applyPlan(
        "history.setStyleReference",
        planSetStyleReference(runtime.getSnapshot().document, {
          target,
          styleId,
          commandPrefix: operation("reference"),
        }),
      );
    },
  };
}

export type StyleActions = {
  createFromNode(
    nodeId: string,
    field: StyleReferenceTarget["field"],
    name: string,
  ): boolean;
  updateStyle(style: SharedStyleDefinition): boolean;
  updateFromNode(
    styleId: string,
    nodeId: string,
    field: StyleReferenceTarget["field"],
  ): boolean;
  moveStyle(styleId: string, index: number): boolean;
  deleteStyle(styleId: string): boolean;
  setReference(target: StyleReferenceTarget, styleId: string | null): boolean;
};
