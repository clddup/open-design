import type {
  BooleanOperation,
  DesignDocument,
  DesignOperation,
} from "@opendesign/design-contracts";
import {
  canAlignNodeToParent,
  canCreateBooleanGroup,
  canDeleteNodes,
  canGroupNodes,
  canReorderNodes,
  canToggleMaskNodes,
  canUngroupBooleanGroup,
  canUngroupNode,
  getArrangementSelectionMetrics,
  getMaskToggleAction,
  getWorldTransform,
  invertTransform,
  planArrangeNodes,
  planCreateBooleanGroup,
  planGroupNodes,
  planDeleteNodes,
  planRenameLayers,
  planReparentNodes,
  planReorderNodes,
  planSetBooleanOperation,
  planSmartSelectionSpacing,
  planSmartSelectionGridRearrange,
  planSmartSelectionReorder,
  planToggleMaskNodes,
  planUngroupBooleanGroup,
  planUngroupNode,
  type ArrangeOperation,
  type EditorRuntime,
  type LayerOrderAction,
  type LayerRenameInput,
} from "@opendesign/editor-runtime";
import type {
  LeaferSmartSelectionReorderRequest,
  LeaferSmartSelectionSpacingRequest,
} from "@opendesign/leafer-engine";
import { useCallback, useMemo } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import type {
  LayerActionResult,
  LayerReparentRequest,
  LayerReparentResult,
} from "./types";
import type { ApplyEditorCommands } from "./use-editor-command-controller";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

const LAYER_ORDER_ACTIONS: readonly LayerOrderAction[] = [
  "bring-forward",
  "bring-to-front",
  "send-backward",
  "send-to-back",
];

const LAYER_ORDER_HISTORY_KEYS: Record<LayerOrderAction, MessageKey> = {
  "bring-forward": "history.bringForward",
  "bring-to-front": "history.bringToFront",
  "send-backward": "history.sendBackward",
  "send-to-back": "history.sendToBack",
};

const BOOLEAN_OPERATION_HISTORY_KEYS: Record<BooleanOperation, MessageKey> = {
  union: "history.booleanUnion",
  subtract: "history.booleanSubtract",
  intersect: "history.booleanIntersect",
  exclude: "history.booleanExclude",
};

const BOOLEAN_OPERATIONS: readonly BooleanOperation[] = [
  "union",
  "subtract",
  "intersect",
  "exclude",
];

export function useLayerCommandController({
  activePageId,
  applyCommands,
  componentTargetActive,
  document,
  runtime,
  selectedNodeIds,
  setEditorError,
  t,
  transactionCounter,
}: {
  activePageId: string;
  applyCommands: ApplyEditorCommands;
  componentTargetActive: boolean;
  document: DesignDocument;
  runtime: EditorRuntime;
  selectedNodeIds: readonly string[];
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
}) {
  const capabilities = useMemo(() => {
    const selectedNode =
      selectedNodeIds.length === 1
        ? document.nodesById[selectedNodeIds[0] ?? ""]
        : undefined;
    const arrangementMetrics = getArrangementSelectionMetrics(
      document,
      activePageId,
      componentTargetActive ? [] : selectedNodeIds,
    );
    return {
      canAlignSelection:
        !componentTargetActive &&
        (selectedNodeIds.length > 1
          ? arrangementMetrics !== null
          : selectedNode !== undefined &&
            canAlignNodeToParent(document, activePageId, selectedNode.id)),
      arrangementMetrics,
      canChangeSelectedBoolean:
        !componentTargetActive &&
        selectedNode?.kind === "boolean" &&
        BOOLEAN_OPERATIONS.some(
          (operation) =>
            operation !== selectedNode.properties.operation &&
            planSetBooleanOperation(
              document,
              activePageId,
              selectedNode.id,
              operation,
              "boolean_capability_check",
            ).ok,
        ),
      canCreateBooleanSelection:
        !componentTargetActive &&
        canCreateBooleanGroup(document, activePageId, selectedNodeIds),
      canDeleteSelection:
        !componentTargetActive && canDeleteNodes(document, selectedNodeIds),
      canGroupSelection:
        !componentTargetActive &&
        canGroupNodes(document, activePageId, selectedNodeIds),
      canToggleMaskSelection:
        !componentTargetActive &&
        canToggleMaskNodes(document, activePageId, selectedNodeIds),
      canUngroupBooleanSelection:
        !componentTargetActive &&
        canUngroupBooleanGroup(document, activePageId, selectedNodeIds),
      canUngroupSelection:
        !componentTargetActive &&
        canUngroupNode(document, activePageId, selectedNodeIds),
      canRenameSelection:
        selectedNodeIds.length > 0 &&
        selectedNodeIds.every((nodeId) => document.nodesById[nodeId]),
      layerOrderAvailability: Object.fromEntries(
        LAYER_ORDER_ACTIONS.map((action) => [
          action,
          !componentTargetActive &&
            canReorderNodes(document, activePageId, selectedNodeIds, action),
        ]),
      ) as Record<LayerOrderAction, boolean>,
      maskSelectionAction: componentTargetActive
        ? null
        : getMaskToggleAction(document, activePageId, selectedNodeIds),
    };
  }, [activePageId, componentTargetActive, document, selectedNodeIds]);

  const deleteNodes = useCallback(
    (nodeIds: readonly string[]) => {
      const current = runtime.getSnapshot();
      if (
        current.state.selection.componentTarget &&
        nodeIds.includes(current.state.selection.componentTarget.instanceId)
      ) {
        return false;
      }
      const operationId = `delete_${Date.now()}_${++transactionCounter.current}`;
      const plan = planDeleteNodes(current.document, {
        nodeIds,
        commandPrefix: operationId,
      });
      if (!plan.ok) {
        setEditorError(plan.message);
        return false;
      }
      const deleted = applyCommands(
        t("history.deleteLayers", { count: plan.rootNodeIds.length }),
        plan.commands,
      );
      if (deleted) runtime.setSelection([]);
      return deleted;
    },
    [applyCommands, runtime, setEditorError, t, transactionCounter],
  );

  const duplicateSelection = useCallback(() => {
    const current = runtime.getSnapshot();
    if (current.state.selection.componentTarget) return;
    const duplicated = duplicateNodes(
      current.document,
      activePageId,
      current.state.selection.nodeIds,
      Date.now(),
    );
    if (duplicated.commands.length === 0) return;
    if (
      applyCommands(
        t("history.duplicateLayers", { count: duplicated.rootIds.length }),
        duplicated.commands,
      )
    ) {
      runtime.setSelection(duplicated.rootIds, duplicated.rootIds.at(-1));
    }
  }, [activePageId, applyCommands, runtime, t]);

  const groupSelection = useCallback(() => {
    const current = runtime.getSnapshot();
    if (current.state.selection.componentTarget) return;
    const operationId = `group_${Date.now()}_${++transactionCounter.current}`;
    const plan = planGroupNodes(
      current.document,
      activePageId,
      current.state.selection.nodeIds,
      {
        groupId: operationId,
        name: t("canvas.newNode", { kind: t("node.group") }),
        commandPrefix: operationId,
      },
    );
    if (!plan.ok) {
      setEditorError(plan.message);
      return;
    }
    if (applyCommands(t("history.groupLayers"), plan.commands)) {
      runtime.setSelection(plan.selectionNodeIds, plan.selectionNodeIds.at(-1));
    }
  }, [
    activePageId,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  ]);

  const ungroupSelection = useCallback(() => {
    const current = runtime.getSnapshot();
    if (current.state.selection.componentTarget) return;
    const containerId = current.state.selection.nodeIds[0];
    if (!containerId) return;
    const operationId = `ungroup_${Date.now()}_${++transactionCounter.current}`;
    const container = current.document.nodesById[containerId];
    const plan =
      container?.kind === "boolean"
        ? planUngroupBooleanGroup(
            current.document,
            activePageId,
            containerId,
            operationId,
          )
        : planUngroupNode(
            current.document,
            activePageId,
            containerId,
            operationId,
          );
    if (!plan.ok) {
      setEditorError(plan.message);
      return;
    }
    if (applyCommands(t("history.ungroupLayers"), plan.commands)) {
      runtime.setSelection(plan.selectionNodeIds, plan.selectionNodeIds.at(-1));
    }
  }, [
    activePageId,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  ]);

  const toggleMaskSelection = useCallback(() => {
    const current = runtime.getSnapshot();
    if (current.state.selection.componentTarget) return;
    const operationId = `mask_${Date.now()}_${++transactionCounter.current}`;
    const plan = planToggleMaskNodes(
      current.document,
      activePageId,
      current.state.selection.nodeIds,
      {
        groupId: `${operationId}_group`,
        name: t("canvas.newMaskGroup"),
        commandPrefix: operationId,
      },
    );
    if (!plan.ok) {
      setEditorError(plan.message);
      return;
    }
    const removing = plan.commands.some(
      (command) =>
        command.type === "update_properties" && command.maskMode === "none",
    );
    if (
      applyCommands(
        t(removing ? "history.removeMask" : "history.createMask"),
        plan.commands,
      )
    ) {
      runtime.setSelection(plan.selectionNodeIds, plan.selectionNodeIds.at(-1));
    }
  }, [
    activePageId,
    applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  ]);

  const applyBooleanOperation = useCallback(
    (operation: BooleanOperation) => {
      const current = runtime.getSnapshot();
      if (current.state.selection.componentTarget) return;
      const selection = current.state.selection.nodeIds;
      const selected =
        selection.length === 1
          ? current.document.nodesById[selection[0] ?? ""]
          : undefined;
      const operationId = `boolean_${operation}_${Date.now()}_${++transactionCounter.current}`;
      const plan =
        selected?.kind === "boolean"
          ? selected.properties.operation === operation
            ? null
            : planSetBooleanOperation(
                current.document,
                activePageId,
                selected.id,
                operation,
                operationId,
              )
          : planCreateBooleanGroup(
              current.document,
              activePageId,
              selection,
              operation,
              {
                booleanId: operationId,
                name: t("canvas.newNode", { kind: t("node.boolean") }),
                commandPrefix: operationId,
              },
            );
      if (!plan) return;
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      if (
        applyCommands(
          t(BOOLEAN_OPERATION_HISTORY_KEYS[operation]),
          plan.commands,
        )
      ) {
        runtime.setSelection(
          plan.selectionNodeIds,
          plan.selectionNodeIds.at(-1),
        );
      }
    },
    [
      activePageId,
      applyCommands,
      runtime,
      setEditorError,
      t,
      transactionCounter,
    ],
  );

  const reorderSelection = useCallback(
    (action: LayerOrderAction) => {
      const current = runtime.getSnapshot();
      if (current.state.selection.componentTarget) return;
      const operationId = `reorder_${action}_${Date.now()}_${++transactionCounter.current}`;
      const plan = planReorderNodes(
        current.document,
        activePageId,
        current.state.selection.nodeIds,
        action,
        operationId,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return;
      }
      applyCommands(t(LAYER_ORDER_HISTORY_KEYS[action]), plan.commands);
    },
    [
      activePageId,
      applyCommands,
      runtime,
      setEditorError,
      t,
      transactionCounter,
    ],
  );

  const reparentLayers = useCallback(
    (request: LayerReparentRequest): LayerReparentResult => {
      const current = runtime.getSnapshot();
      if (
        current.state.selection.componentTarget &&
        request.nodeIds.includes(
          current.state.selection.componentTarget.instanceId,
        )
      ) {
        return { ok: false, error: t("sidebar.dropUnavailable") };
      }
      const operationId = `reparent_${Date.now()}_${++transactionCounter.current}`;
      const plan = planReparentNodes(
        current.document,
        activePageId,
        request.nodeIds,
        {
          parentId: request.parentId,
          index: request.index,
          commandPrefix: operationId,
        },
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return { ok: false, error: plan.message };
      }
      if (
        !applyCommands(
          t(
            plan.selectionNodeIds.length === 1
              ? "history.reparentLayer"
              : "history.reparentLayers",
            { count: plan.selectionNodeIds.length },
          ),
          plan.commands,
        )
      ) {
        return { ok: false, error: t("sidebar.dropApplyFailed") };
      }
      runtime.setSelection(plan.selectionNodeIds, plan.selectionNodeIds.at(-1));
      return {
        ok: true,
        ...(plan.warnings?.length ? { warning: plan.warnings.join(" ") } : {}),
      };
    },
    [
      activePageId,
      applyCommands,
      runtime,
      setEditorError,
      t,
      transactionCounter,
    ],
  );

  const arrangeSelection = useCallback(
    (operation: ArrangeOperation) => {
      const current = runtime.getSnapshot();
      if (current.state.selection.componentTarget) return;
      const operationId = `arrange_${operation.action}_${Date.now()}_${++transactionCounter.current}`;
      const plan = planArrangeNodes(
        current.document,
        activePageId,
        current.state.selection.nodeIds,
        operation,
        operationId,
      );
      if (!plan.ok) {
        setEditorError(plan.code === "no-op" ? null : plan.message);
        return;
      }
      const historyKey = operation.action.startsWith("align-")
        ? "history.alignLayers"
        : operation.action.startsWith("distribute-")
          ? "history.distributeLayers"
          : "history.setLayerSpacing";
      applyCommands(t(historyKey), plan.commands);
    },
    [
      activePageId,
      applyCommands,
      runtime,
      setEditorError,
      t,
      transactionCounter,
    ],
  );

  const adjustSmartSelectionSpacing = useCallback(
    (request: LeaferSmartSelectionSpacingRequest): boolean => {
      const current = runtime.getSnapshot();
      if (
        current.document.documentId !== request.documentId ||
        current.document.revision !== request.expectedRevision ||
        activePageId !== request.pageId ||
        !sameNodeSet(current.state.selection.nodeIds, request.nodeIds) ||
        current.state.selection.componentTarget
      ) {
        setEditorError(t("canvas.smartSelectionStale"));
        return false;
      }
      const operationId = `smart_spacing_${Date.now()}_${++transactionCounter.current}`;
      const plan = planSmartSelectionSpacing(
        current.document,
        activePageId,
        request.nodeIds,
        request.axis,
        request.spacing,
        operationId,
      );
      if (!plan.ok) {
        setEditorError(plan.code === "no-op" ? null : plan.message);
        return false;
      }
      return applyCommands(t("history.setLayerSpacing"), plan.commands);
    },
    [
      activePageId,
      applyCommands,
      runtime,
      setEditorError,
      t,
      transactionCounter,
    ],
  );

  const reorderSmartSelection = useCallback(
    (request: LeaferSmartSelectionReorderRequest): boolean => {
      const current = runtime.getSnapshot();
      if (
        current.document.documentId !== request.documentId ||
        current.document.revision !== request.expectedRevision ||
        activePageId !== request.pageId ||
        !sameNodeSet(current.state.selection.nodeIds, request.nodeIds) ||
        current.state.selection.componentTarget
      ) {
        setEditorError(t("canvas.smartSelectionStale"));
        return false;
      }
      const operationId = `smart_reorder_${Date.now()}_${++transactionCounter.current}`;
      const plan =
        request.kind === "linear"
          ? planSmartSelectionReorder(
              current.document,
              activePageId,
              request.nodeIds,
              request.movedNodeIds,
              request.insertionIndex,
              operationId,
            )
          : planSmartSelectionGridRearrange(
              current.document,
              activePageId,
              request.nodeIds,
              request.movedNodeId,
              request.targetNodeId,
              request.mode,
              operationId,
            );
      if (!plan.ok) {
        setEditorError(plan.code === "no-op" ? null : plan.message);
        return false;
      }
      return applyCommands(t("history.reorderSmartSelection"), plan.commands);
    },
    [
      activePageId,
      applyCommands,
      runtime,
      setEditorError,
      t,
      transactionCounter,
    ],
  );

  const renameLayers = useCallback(
    (
      nodeIds: readonly string[],
      input: LayerRenameInput,
      expectedDocument?: { documentId: string; revision: number },
    ): LayerActionResult => {
      const current = runtime.getSnapshot();
      if (
        expectedDocument !== undefined &&
        (current.document.documentId !== expectedDocument.documentId ||
          current.document.revision !== expectedDocument.revision)
      ) {
        return { ok: false, error: t("renameLayers.documentChanged") };
      }
      const operationId = `rename_layers_${Date.now()}_${++transactionCounter.current}`;
      const plan = planRenameLayers(
        current.document,
        activePageId,
        nodeIds,
        input,
        operationId,
      );
      if (!plan.ok) {
        return {
          ok: false,
          error:
            plan.code === "invalid-regular-expression"
              ? t("renameLayers.invalidRegularExpression")
              : plan.code === "empty-name"
                ? t("renameLayers.emptyName")
                : plan.code === "name-too-long"
                  ? t("renameLayers.nameTooLong")
                  : plan.code === "no-op"
                    ? t("renameLayers.noChange")
                    : t("renameLayers.targetUnavailable"),
        };
      }
      const applied = applyCommands(
        t(
          plan.commands.length === 1
            ? "history.renameLayer"
            : "history.renameLayers",
          { count: plan.commands.length },
        ),
        plan.commands,
      );
      return applied
        ? { ok: true }
        : { ok: false, error: t("renameLayers.applyFailed") };
    },
    [activePageId, applyCommands, runtime, t, transactionCounter],
  );

  return {
    ...capabilities,
    applyBooleanOperation,
    adjustSmartSelectionSpacing,
    arrangeSelection,
    deleteNodes,
    duplicateSelection,
    groupSelection,
    renameLayers,
    reorderSmartSelection,
    reorderSelection,
    reparentLayers,
    toggleMaskSelection,
    ungroupSelection,
  };
}

function filterTopLevelNodeIds(
  document: DesignDocument,
  nodeIds: readonly string[],
): string[] {
  const selected = new Set(nodeIds);
  return [...new Set(nodeIds)].filter((nodeId) => {
    if (!document.nodesById[nodeId]) return false;
    let parentId = document.nodesById[nodeId]?.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = document.nodesById[parentId]?.parentId;
    }
    return true;
  });
}

function sameNodeSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return (
    rightSet.size === left.length &&
    left.every((nodeId) => rightSet.has(nodeId))
  );
}

function duplicateNodes(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  seed: number,
): { commands: DesignOperation[]; rootIds: string[] } {
  const roots = filterTopLevelNodeIds(document, nodeIds);
  const idMap = new Map<string, string>();
  let idSequence = 0;
  const collect = (nodeId: string) => {
    if (idMap.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;
    idMap.set(nodeId, `${node.kind}_${seed}_${++idSequence}`);
    node.childIds.forEach(collect);
  };
  roots.forEach(collect);

  const commands: DesignOperation[] = [];
  const appendedByParent = new Map<string, number>();
  const emit = (nodeId: string, root: boolean, childIndex = 0) => {
    const node = document.nodesById[nodeId];
    const nextId = idMap.get(nodeId);
    if (!node || !nextId) return;
    const parentId = idMap.get(node.parentId ?? "") ?? node.parentId;
    const clone = structuredClone(node);
    clone.id = nextId;
    clone.parentId = parentId ?? null;
    clone.childIds = [];
    clone.name = `${node.name} copy`.trim();
    if (root) {
      const delta = documentDeltaToParent(document, node.parentId, {
        x: 24,
        y: 24,
      });
      clone.transform[4] += delta.x;
      clone.transform[5] += delta.y;
    }
    const target = parentId
      ? document.nodesById[parentId]?.childIds
      : document.pagesById[pageId]?.rootNodeIds;
    const parentKey = parentId ?? `page:${pageId}`;
    const appended = appendedByParent.get(parentKey) ?? 0;
    const index = root ? (target?.length ?? 0) + appended : childIndex;
    if (root) appendedByParent.set(parentKey, appended + 1);
    commands.push({
      commandId: `duplicate_${nextId}`,
      type: "insert_element",
      pageId,
      parentId: parentId ?? null,
      index,
      node: clone,
    });
    node.childIds.forEach((childId, index) => emit(childId, false, index));
  };
  roots.forEach((nodeId) => emit(nodeId, true));
  return {
    commands,
    rootIds: roots.flatMap((nodeId) => {
      const nextId = idMap.get(nodeId);
      return nextId ? [nextId] : [];
    }),
  };
}

function documentDeltaToParent(
  document: DesignDocument,
  parentId: string | null,
  delta: { x: number; y: number },
) {
  if (!parentId) return delta;
  const transform = getWorldTransform(document, parentId);
  const inverse = transform ? invertTransform(transform) : null;
  if (!inverse) return delta;
  return {
    x: inverse[0] * delta.x + inverse[2] * delta.y,
    y: inverse[1] * delta.x + inverse[3] * delta.y,
  };
}
