import type {
  AutoLayout,
  DesignOperation,
  LayoutConstraints,
  LayoutLimits,
  LayoutGuide,
  LayoutPositioning,
  LayoutSizing,
  RelativePoint,
  GridTrack,
  Size,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";
import {
  planDeleteGridTracks,
  planMoveGridChildren,
  planResizeGridChildSpan,
  planSetFrameAutoLayout,
  planReorderGridTracks,
  planSetGridTracks,
  planSetNodeLayoutLimits,
  planSetNodeLayoutPositioning,
  planSetFrameLayoutGuides,
  planSetNodeLayoutSizing,
  planSetNodeGridPlacement,
  planSetNodeRotationOrigin,
  planResizeFrameWithConstraints,
  planSetNodeConstraints,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import type {
  LeaferAutoLayoutSpacingChange,
  LeaferGridChildMoveRequest,
  LeaferGridChildSpanRequest,
} from "@opendesign/leafer-engine";
import { useCallback, useEffect } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import type { UpdatePropertiesPatch } from "./types";
import { autoLayoutShortcutRequest } from "./auto-layout-shortcut";

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

  const setFrameAutoLayout = useCallback(
    (frameId: string, autoLayout: AutoLayout) => {
      const current = runtime.getSnapshot().document;
      const plan = planSetFrameAutoLayout(
        current,
        pageIdForNode(current, frameId),
        frameId,
        autoLayout,
        `inspector_auto_layout_${frameId}`,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.updateAutoLayout"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const adjustAutoLayoutSpacing = useCallback(
    (
      frameId: string,
      expectedRevision: number,
      change: LeaferAutoLayoutSpacingChange,
    ) => {
      const current = runtime.getSnapshot().document;
      if (current.revision !== expectedRevision) {
        setEditorError(t("canvas.autoLayoutSpacingStale"));
        return false;
      }
      const frame = current.nodesById[frameId];
      const autoLayout =
        frame?.kind === "frame" ? frame.properties.autoLayout : undefined;
      if (!autoLayout || autoLayout.mode === "none") {
        setEditorError(t("canvas.autoLayoutSpacingStale"));
        return false;
      }
      let next: AutoLayout;
      if (change.kind === "padding") {
        next = { ...autoLayout, padding: change.value };
      } else if (
        change.kind === "gap" &&
        (autoLayout.mode === "horizontal" || autoLayout.mode === "vertical") &&
        autoLayout.primaryAlignment !== "space-between"
      ) {
        next = { ...autoLayout, gap: change.value };
      } else if (
        change.kind === "counter-gap" &&
        autoLayout.mode === "horizontal" &&
        autoLayout.wrap &&
        autoLayout.wrap.counterAxisAlignContent !== "space-between"
      ) {
        next = {
          ...autoLayout,
          wrap: { ...autoLayout.wrap, counterGap: change.value },
        };
      } else {
        setEditorError(t("canvas.autoLayoutSpacingStale"));
        return false;
      }
      const plan = planSetFrameAutoLayout(
        current,
        pageIdForNode(current, frameId),
        frameId,
        next,
        `canvas_auto_layout_spacing_${frameId}`,
      );
      if (!plan.ok) {
        if (plan.code === "no-op") {
          setEditorError(null);
          return true;
        }
        setEditorError(plan.message);
        return false;
      }
      return applyCommands(t("history.updateAutoLayout"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const reorderGridTracks = useCallback(
    (
      frameId: string,
      axis: "rows" | "columns",
      fromIndices: readonly number[],
      insertionIndex: number,
    ) => {
      const current = runtime.getSnapshot().document;
      const plan = planReorderGridTracks(
        current,
        pageIdForNode(current, frameId),
        frameId,
        axis,
        fromIndices,
        insertionIndex,
        `inspector_grid_reorder_${frameId}`,
      );
      if (!plan.ok) {
        if (plan.code === "no-op") {
          setEditorError(null);
          return true;
        }
        setEditorError(plan.message);
        return false;
      }
      return applyCommands(t("history.reorderGridTracks"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const moveGridChildren = useCallback(
    (request: LeaferGridChildMoveRequest) => {
      const current = runtime.getSnapshot().document;
      if (current.revision !== request.expectedRevision) {
        setEditorError(t("canvas.gridTrackStale"));
        return false;
      }
      const plan = planMoveGridChildren(
        current,
        pageIdForNode(current, request.frameId),
        request.frameId,
        request.nodeIds,
        request.anchorNodeId,
        request.target,
        `canvas_grid_child_move_${request.frameId}`,
      );
      if (!plan.ok) {
        if (plan.code === "no-op") {
          setEditorError(null);
          return true;
        }
        setEditorError(plan.message);
        return false;
      }
      return applyCommands(t("history.moveGridContent"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const resizeGridChildSpan = useCallback(
    (request: LeaferGridChildSpanRequest) => {
      const current = runtime.getSnapshot().document;
      if (current.revision !== request.expectedRevision) {
        setEditorError(t("canvas.gridTrackStale"));
        return false;
      }
      const plan = planResizeGridChildSpan(
        current,
        pageIdForNode(current, request.frameId),
        request.frameId,
        request.nodeId,
        request.target,
        `canvas_grid_child_span_${request.frameId}`,
        request.size,
      );
      if (!plan.ok) {
        if (plan.code === "no-op") {
          setEditorError(null);
          return true;
        }
        setEditorError(plan.message);
        return false;
      }
      return applyCommands(t("history.resizeGridSpan"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const deleteGridTracks = useCallback(
    (
      frameId: string,
      axis: "rows" | "columns",
      indices: readonly number[],
      expectedRevision?: number,
    ) => {
      const current = runtime.getSnapshot().document;
      if (
        expectedRevision !== undefined &&
        current.revision !== expectedRevision
      ) {
        setEditorError(t("canvas.gridTrackStale"));
        return false;
      }
      const plan = planDeleteGridTracks(
        current,
        pageIdForNode(current, frameId),
        frameId,
        axis,
        indices,
        `grid_track_delete_${frameId}`,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return false;
      }
      return applyCommands(t("history.deleteGridTracks"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const setGridTracks = useCallback(
    (
      frameId: string,
      expectedRevision: number,
      axis: "rows" | "columns",
      indices: readonly number[],
      track: GridTrack,
    ) => {
      const current = runtime.getSnapshot().document;
      if (current.revision !== expectedRevision) {
        setEditorError(t("canvas.gridTrackStale"));
        return false;
      }
      const plan = planSetGridTracks(
        current,
        pageIdForNode(current, frameId),
        frameId,
        axis,
        indices,
        track,
        `canvas_grid_track_${frameId}`,
      );
      if (!plan.ok) {
        if (plan.code === "no-op") {
          setEditorError(null);
          return true;
        }
        setEditorError(plan.message);
        return false;
      }
      return applyCommands(t("history.updateGridTrack"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const setNodeLayoutSizing = useCallback(
    (nodeId: string, sizing: LayoutSizing) => {
      const current = runtime.getSnapshot().document;
      const plan = planSetNodeLayoutSizing(
        current,
        pageIdForNode(current, nodeId),
        nodeId,
        sizing,
        `inspector_layout_sizing_${nodeId}`,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.updateAutoLayoutSizing"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const setNodeLayoutLimits = useCallback(
    (nodeId: string, limits: LayoutLimits | null) => {
      const current = runtime.getSnapshot().document;
      const plan = planSetNodeLayoutLimits(
        current,
        pageIdForNode(current, nodeId),
        nodeId,
        limits,
        `inspector_layout_limits_${nodeId}`,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.updateAutoLayoutLimits"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const setNodeLayoutPositioning = useCallback(
    (
      nodeId: string,
      positioning: LayoutPositioning | null,
      constraints?: LayoutConstraints,
    ) => {
      const current = runtime.getSnapshot().document;
      const plan = planSetNodeLayoutPositioning(
        current,
        pageIdForNode(current, nodeId),
        nodeId,
        positioning === "absolute" ? "absolute" : "flow",
        `inspector_layout_positioning_${nodeId}`,
        constraints,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.updateLayoutPositioning"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const setFrameLayoutGuides = useCallback(
    (frameId: string, layoutGuides: readonly LayoutGuide[]) => {
      const current = runtime.getSnapshot().document;
      const plan = planSetFrameLayoutGuides(
        current,
        pageIdForNode(current, frameId),
        frameId,
        layoutGuides,
        `inspector_layout_guides_${frameId}`,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.updateLayoutGuides"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const setNodeRotationOrigin = useCallback(
    (nodeId: string, origin: RelativePoint | null): boolean => {
      const current = runtime.getSnapshot().document;
      const plan = planSetNodeRotationOrigin(
        current,
        pageIdForNode(current, nodeId),
        nodeId,
        origin,
        `rotation_origin_${nodeId}`,
      );
      if (!plan.ok) {
        setEditorError(plan.code === "no-op" ? null : plan.message);
        return plan.code === "no-op";
      }
      return applyCommands(t("history.updateRotationOrigin"), plan.commands);
    },
    [applyCommands, runtime, setEditorError, t],
  );

  const updateNode = useCallback(
    (nodeId: string, updates: UpdatePropertiesPatch) => {
      const current = runtime.getSnapshot().document;
      const node = current.nodesById[nodeId];
      if (updates.rotationOrigin !== undefined) {
        setNodeRotationOrigin(nodeId, updates.rotationOrigin);
        return;
      }
      if (updates.layoutLimits !== undefined) {
        setNodeLayoutLimits(nodeId, updates.layoutLimits);
        return;
      }
      if (updates.layoutSizing) {
        setNodeLayoutSizing(nodeId, updates.layoutSizing);
        return;
      }
      if (updates.gridPlacement) {
        const plan = planSetNodeGridPlacement(
          current,
          pageIdForNode(current, nodeId),
          nodeId,
          updates.gridPlacement,
          `inspector_grid_${nodeId}`,
        );
        if (!plan.ok) {
          setEditorError(plan.message);
          return;
        }
        applyCommands(t("history.updateProperties"), plan.commands);
        return;
      }
      const autoLayout = updates.properties?.autoLayout;
      if (
        (node?.kind === "frame" || node?.kind === "slot") &&
        isAutoLayout(autoLayout)
      ) {
        setFrameAutoLayout(nodeId, autoLayout);
        return;
      }
      if (
        (node?.kind === "frame" || node?.kind === "slot") &&
        updates.size &&
        node.childIds.length > 0
      ) {
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
    [
      applyCommands,
      runtime,
      setEditorError,
      setFrameAutoLayout,
      setNodeLayoutLimits,
      setNodeLayoutSizing,
      setNodeRotationOrigin,
      t,
    ],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const snapshot = runtime.getSnapshot();
      const request = autoLayoutShortcutRequest(
        event,
        snapshot.document,
        snapshot.state.selection,
      );
      if (!request) return;
      event.preventDefault();
      setFrameAutoLayout(request.frameId, request.autoLayout);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [runtime, setFrameAutoLayout]);

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

  return {
    adjustAutoLayoutSpacing,
    applyCommands,
    deleteGridTracks,
    moveGridChildren,
    resizeGridChildSpan,
    setGridTracks,
    resizeFrame,
    reorderGridTracks,
    setFrameAutoLayout,
    setNodeConstraints,
    setNodeLayoutLimits,
    setNodeLayoutPositioning,
    setFrameLayoutGuides,
    setNodeLayoutSizing,
    setNodeRotationOrigin,
    updateNode,
  };
}

function isAutoLayout(value: unknown): value is AutoLayout {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ["none", "horizontal", "vertical", "grid"].includes(
      String((value as { mode?: unknown }).mode),
    )
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input, textarea, select, [role='textbox']"))
  );
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
