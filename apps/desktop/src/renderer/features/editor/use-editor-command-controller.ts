import type {
  DesignOperation,
  LayoutConstraints,
  Size,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";
import {
  planResizeFrameWithConstraints,
  planSetNodeConstraints,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import { useCallback } from "react";
import type {
  MessageKey,
  MessageParameters,
} from "../../../shared/i18n/messages";
import type { UpdatePropertiesPatch } from "./types";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export type ApplyEditorCommands = (
  label: string,
  commands: DesignOperation[],
) => boolean;

export function useEditorCommandController({
  runtime,
  setEditorError,
  t,
  transactionCounter,
}: {
  runtime: EditorRuntime;
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
}) {
  const applyCommands = useCallback<ApplyEditorCommands>(
    (label, commands) => {
      const current = runtime.getSnapshot().document;
      const result = runtime.apply({
        transactionId: `transaction_renderer_${Date.now()}_${++transactionCounter.current}`,
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "local-user" },
        label,
        commands,
      });
      setEditorError(result.ok ? null : result.error.message);
      return result.ok;
    },
    [runtime, setEditorError, transactionCounter],
  );

  const updateNode = useCallback(
    (nodeId: string, updates: UpdatePropertiesPatch) => {
      const current = runtime.getSnapshot().document;
      const node = current.nodesById[nodeId];
      if (node?.kind === "frame" && updates.size && node.childIds.length > 0) {
        const plan = planResizeFrameWithConstraints(
          current,
          pageIdForNode(current, nodeId),
          nodeId,
          updates.size,
          `inspector_resize_${nodeId}`,
        );
        if (!plan.ok) {
          setEditorError(plan.message);
          return;
        }
        applyCommands(t("history.updateProperties"), plan.commands);
        return;
      }
      const command: UpdatePropertiesCommand = {
        commandId: `update_${nodeId}`,
        type: "update_properties",
        nodeId,
        ...updates,
      };
      applyCommands(t("history.updateProperties"), [command]);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const setNodeConstraints = useCallback(
    (nodeId: string, constraints: LayoutConstraints) => {
      const current = runtime.getSnapshot().document;
      const plan = planSetNodeConstraints(
        current,
        pageIdForNode(current, nodeId),
        nodeId,
        constraints,
        `inspector_constraints_${nodeId}`,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.updateConstraints"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const resizeFrame = useCallback(
    (frameId: string, size: Size) => {
      const current = runtime.getSnapshot().document;
      const plan = planResizeFrameWithConstraints(
        current,
        pageIdForNode(current, frameId),
        frameId,
        size,
        `canvas_resize_${frameId}`,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return false;
      }
      return applyCommands(t("history.resizeFrameResponsive"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  return { applyCommands, resizeFrame, setNodeConstraints, updateNode };
}

function pageIdForNode(
  document: ReturnType<EditorRuntime["getSnapshot"]>["document"],
  nodeId: string,
): string {
  const roots = new Map<string, string>();
  for (const [pageId, page] of Object.entries(document.pagesById)) {
    page.rootNodeIds.forEach((rootId) => roots.set(rootId, pageId));
  }
  const visited = new Set<string>();
  let current = document.nodesById[nodeId];
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parentId === null) {
      const pageId = roots.get(current.id);
      if (pageId) return pageId;
      break;
    }
    current = document.nodesById[current.parentId];
  }
  throw new Error(`Layer ${nodeId} does not belong to a Page`);
}
