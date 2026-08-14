import {
  planReorderComponentProperties,
  type ComponentOperationPlan,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import { useCallback } from "react";

export function useComponentPropertyOrderAction({
  applyPlan,
  label,
  runtime,
  transactionCounter,
}: {
  applyPlan: (label: string, plan: ComponentOperationPlan) => void;
  label: string;
  runtime: EditorRuntime;
  transactionCounter: { current: number };
}) {
  return useCallback(
    (componentPropertyOrder: readonly string[]) => {
      const current = runtime.getSnapshot();
      const selected = current.state.selection.nodeIds;
      if (selected.length !== 1) return;
      const component = Object.values(current.document.componentsById).find(
        (candidate) => candidate.rootNodeId === selected[0],
      );
      if (!component) return;
      const operationId = `component_property_reorder_${Date.now()}_${++transactionCounter.current}`;
      applyPlan(
        label,
        planReorderComponentProperties(current.document, {
          componentId: component.id,
          componentPropertyOrder,
          commandPrefix: operationId,
        }),
      );
    },
    [applyPlan, label, runtime, transactionCounter],
  );
}
