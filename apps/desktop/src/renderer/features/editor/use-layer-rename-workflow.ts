import type {
  ComponentOverridePatch,
  ComponentSelectionTarget,
  DesignDocument,
} from "@opendesign/design-contracts";
import {
  previewLayerRenames,
  type EditorRuntime,
  type LayerRenameInput,
  type LayerRenameItem,
} from "@opendesign/editor-runtime";
import { useCallback, useState } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import { createComponentInspectorContext } from "../editor-workbench/component-inspector-context";
import type { LayerActionResult, LayerRenameTarget } from "./types";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

type ActiveLayerRename =
  | {
      baseRevision: number;
      documentId: string;
      items: LayerRenameItem[];
      kind: "nodes";
      nodeIds: string[];
    }
  | {
      baseRevision: number;
      componentTarget: ComponentSelectionTarget;
      documentId: string;
      items: [LayerRenameItem];
      kind: "component";
    };

type RenameLayers = (
  nodeIds: readonly string[],
  input: LayerRenameInput,
  expectedDocument?: { documentId: string; revision: number },
) => LayerActionResult;

type UpdateInstanceSource = (
  instanceId: string,
  sourcePath: readonly string[],
  patch: ComponentOverridePatch,
  historyLabel?: string,
) => boolean;

export function useLayerRenameWorkflow({
  renameLayers,
  runtime,
  t,
  updateInstanceSource,
}: {
  renameLayers: RenameLayers;
  runtime: EditorRuntime;
  t: Translate;
  updateInstanceSource: UpdateInstanceSource;
}) {
  const [activeRename, setActiveRename] = useState<ActiveLayerRename | null>(
    null,
  );
  const close = useCallback(() => setActiveRename(null), []);

  const openSelection = useCallback(() => {
    const current = runtime.getSnapshot();
    const componentTarget = current.state.selection.componentTarget;
    if (componentTarget) {
      const item = componentLayerRenameItem(current.document, componentTarget);
      if (!item) return;
      setActiveRename({
        baseRevision: current.document.revision,
        componentTarget,
        documentId: current.document.documentId,
        items: [item],
        kind: "component",
      });
      return;
    }
    const nodeIds = [...new Set(current.state.selection.nodeIds)].filter(
      (nodeId) => current.document.nodesById[nodeId] !== undefined,
    );
    if (nodeIds.length === 0) return;
    setActiveRename({
      baseRevision: current.document.revision,
      documentId: current.document.documentId,
      items: nodeIds.map((nodeId) => ({
        id: nodeId,
        name: current.document.nodesById[nodeId]?.name ?? "",
      })),
      kind: "nodes",
      nodeIds,
    });
  }, [runtime]);

  const renameTarget = useCallback(
    (target: LayerRenameTarget, name: string): LayerActionResult => {
      if (target.componentTarget) {
        const applied = updateInstanceSource(
          target.componentTarget.instanceId,
          target.componentTarget.sourcePath,
          { name },
          t("history.renameLayer"),
        );
        return applied
          ? { ok: true }
          : { ok: false, error: t("renameLayers.applyFailed") };
      }
      return renameLayers([target.nodeId], {
        match: "",
        renameTo: name,
        useRegularExpression: false,
      });
    },
    [renameLayers, t, updateInstanceSource],
  );

  const apply = useCallback(
    (input: LayerRenameInput): LayerActionResult => {
      if (!activeRename) {
        return { ok: false, error: t("renameLayers.targetUnavailable") };
      }
      if (activeRename.kind === "nodes") {
        return renameLayers(activeRename.nodeIds, input, {
          documentId: activeRename.documentId,
          revision: activeRename.baseRevision,
        });
      }
      const current = runtime.getSnapshot();
      if (
        current.document.documentId !== activeRename.documentId ||
        current.document.revision !== activeRename.baseRevision
      ) {
        return { ok: false, error: t("renameLayers.documentChanged") };
      }
      const preview = previewLayerRenames(activeRename.items, input);
      if (!preview.ok || !preview.preview[0]) {
        return { ok: false, error: t("renameLayers.targetUnavailable") };
      }
      const applied = updateInstanceSource(
        activeRename.componentTarget.instanceId,
        activeRename.componentTarget.sourcePath,
        { name: preview.preview[0].nextName },
        t("history.renameLayer"),
      );
      return applied
        ? { ok: true }
        : { ok: false, error: t("renameLayers.applyFailed") };
    },
    [activeRename, renameLayers, runtime, t, updateInstanceSource],
  );

  return {
    activeRename,
    apply,
    close,
    openSelection,
    renameTarget,
  };
}

function componentLayerRenameItem(
  document: DesignDocument,
  target: ComponentSelectionTarget,
): LayerRenameItem | null {
  const instance = document.nodesById[target.instanceId];
  const context = createComponentInspectorContext(document, instance, target);
  const source = context?.sourceNodes.find(
    (candidate) =>
      candidate.sourcePath.length === target.sourcePath.length &&
      candidate.sourcePath.every(
        (value, index) => value === target.sourcePath[index],
      ),
  );
  return source
    ? {
        id: `${target.instanceId}:${target.sourcePath.join("/")}`,
        name: source.node.name,
      }
    : null;
}
