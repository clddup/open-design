import {
  isFrameLikeNode,
  type DesignChangeSet,
  type DesignNode,
  type EllipseNode,
  type FrameNode,
  type GridTrack,
  type LineNode,
  type PolygonNode,
  type RectangleNode,
  type SliceNode,
  type StarNode,
  type TextNode,
  type VectorNode,
  type ViewportState,
} from "@opendesign/design-contracts";
import type { EditorRuntime, EditorSnapshot } from "@opendesign/editor-runtime";
import {
  navigateBooleanSelection,
  navigateLayerSelection,
  planImageNodeUpdate,
  planDeleteVectorNode,
  planVectorLayersLineCut,
  planVectorNetworkUpdates,
  planVectorSemanticEdit,
  resolveBooleanEditScope,
  resolveVectorEditCollectionScope,
  screenToDocument,
  isEffectivelyLocked,
} from "@opendesign/editor-runtime";
import {
  createImageExpandSession,
  type ImageAreaSelection,
  type ImageExpansionInsets,
} from "@opendesign/image-service";
import { navigateComponentSelection } from "@opendesign/component-service";
import { Icon } from "@opendesign/ui";
import type { DesignImageEditAction } from "@/shared/desktop-api";
import { IMAGE_EDIT_PROGRESS_LABEL_KEYS } from "../../design-tools/design-assets";
import {
  createLeaferEngineAdapter,
  resolveDesignTextRuns,
  type LeaferCreateRequest,
  type LeaferAutoLayoutSpacingChange,
  type LeaferAutoLayoutSpacingInputRequest,
  type LeaferCreateVectorRequest,
  type LeaferEngineAdapter,
  type LeaferEngineSyncInput,
  type LeaferFidelityWarning,
  type LeaferGenerationActivity,
  type LeaferImageCropCommitRequest,
  type LeaferImageCropState,
  type LeaferOperationKind,
  type LeaferOperationRequest,
  type LeaferTextRangeSelection,
  type LeaferTextStyleUpdate,
  type LeaferTextRunStyle,
  type LeaferVectorEditRequest,
  type LeaferVectorCutRequest,
  type LeaferVectorCutResponse,
  type LeaferVectorEditTool,
  type LeaferVectorLineCutRequest,
  type LeaferVectorLineCutResponse,
} from "@opendesign/leafer-engine";
import type {
  TextLayoutProvider,
  TextRunLayoutProvider,
} from "@opendesign/text-service";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import { useI18n } from "../../../i18n";
import { generationRevealFromEditorEvent } from "../generation-presentation";
import { commitCanvasOperation } from "../canvas-operation-commit";
import type { ResizeFrameHandler } from "../canvas-responsive-resize";
import { isTool } from "../../../state/editor";
import { DESIGN_ASSET_DRAG_MIME } from "../../design-tools/design-assets";
import { composeTextRunLayoutProviders } from "../../../services/text/text-run-provider-fallback";
import styles from "./Canvas.module.scss";
import {
  ImageAreaSelectionOverlay,
  type ImageAreaSelectionAction,
} from "./ImageAreaSelectionOverlay";
import { AutoLayoutSpacingInput } from "./AutoLayoutSpacingInput";
import { GridTrackInput } from "./GridTrackInput";
import { ImageExpandOverlay } from "./ImageExpandOverlay";
import { useCanvasInlineEditors } from "../use-canvas-inline-editors";

export function Canvas({
  activeAgentRunId,
  agentRunStatus,
  activePageId,
  generationActivity,
  harfBuzzTextRunLayoutProvider,
  layerHoverTarget,
  runtime,
  snapshot,
  onTransactionError,
  onAdjustAutoLayoutSpacing,
  onAssetDrop,
  imageEditActivity,
  onImageAreaEdit,
  onImageAreaSelectionControllerChange,
  onImageExpand,
  onImageExpandControllerChange,
  onImageCropControllerChange,
  onTextLayoutProviderReady,
  onTextEditingStyleControllerChange,
  onTextRangeSelectionChange,
  onReorderGridTracks,
  onSetGridTracks,
  onResizeFrame,
  selectionActions,
  showAgentRunStatus,
}: {
  activeAgentRunId: string | null;
  agentRunStatus?: {
    detail: string;
    hasCanvasChanges: boolean;
    phase: string;
    title: string;
  };
  activePageId: string;
  generationActivity?: LeaferGenerationActivity;
  harfBuzzTextRunLayoutProvider?: TextRunLayoutProvider<LeaferTextRunStyle>;
  layerHoverTarget?: LeaferEngineSyncInput["layerHoverTarget"];
  runtime: EditorRuntime;
  snapshot: EditorSnapshot;
  onTransactionError: (message: string | null) => void;
  onAdjustAutoLayoutSpacing: (
    frameId: string,
    expectedRevision: number,
    change: LeaferAutoLayoutSpacingChange,
  ) => boolean;
  onAssetDrop: (
    assetId: string,
    documentPoint: { x: number; y: number },
  ) => { ok: boolean };
  imageEditActivity?: {
    action: DesignImageEditAction;
    nodeName: string;
    status: "running" | "cancelling";
    onCancel: () => void;
  };
  onImageAreaEdit: (
    nodeId: string,
    action: ImageAreaSelectionAction,
    selection: ImageAreaSelection,
  ) => void;
  onImageAreaSelectionControllerChange: (
    controller: ((nodeId: string) => boolean) | null,
  ) => void;
  onImageExpand: (nodeId: string, expansion: ImageExpansionInsets) => void;
  onImageExpandControllerChange: (
    controller: ((nodeId: string) => boolean) | null,
  ) => void;
  onImageCropControllerChange: (
    controller: ((nodeId: string) => boolean) | null,
  ) => void;
  onTextLayoutProviderReady: (provider: TextLayoutProvider) => void;
  onTextEditingStyleControllerChange: (
    controller: ((style: LeaferTextStyleUpdate) => boolean) | null,
  ) => void;
  onTextRangeSelectionChange: (
    selection: LeaferTextRangeSelection | null,
  ) => void;
  onReorderGridTracks: (
    frameId: string,
    axis: "rows" | "columns",
    fromIndices: readonly number[],
    insertionIndex: number,
  ) => boolean;
  onSetGridTracks: (
    frameId: string,
    expectedRevision: number,
    axis: "rows" | "columns",
    indices: readonly number[],
    track: GridTrack,
  ) => boolean;
  onResizeFrame: ResizeFrameHandler;
  selectionActions?: ReactNode;
  showAgentRunStatus: boolean;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLElement>(null);
  const adapter = useRef<LeaferEngineAdapter | null>(null);
  const latestInput = useRef<LeaferEngineSyncInput | null>(null);
  const changesByRevision = useRef(new Map<number, DesignChangeSet>());
  const generationRevealByRevision = useRef(
    new Map<number, NonNullable<LeaferEngineSyncInput["generationReveal"]>>(),
  );
  const [renderError, setRenderError] = useState<string | null>(null);
  const [assetDropActive, setAssetDropActive] = useState(false);
  const [imageCropState, setImageCropState] =
    useState<LeaferImageCropState | null>(null);
  const [imageAreaSelection, setImageAreaSelection] = useState<{
    assetId: string;
    nodeId: string;
    pageId: string;
    revision: number;
  } | null>(null);
  const [imageExpand, setImageExpand] = useState<{
    assetId: string;
    nodeId: string;
    pageId: string;
    revision: number;
  } | null>(null);
  const reducedMotion = useReducedMotion();
  const [fidelityWarnings, setFidelityWarnings] = useState<
    readonly LeaferFidelityWarning[]
  >([]);
  const [textRunLayoutProvider, setTextRunLayoutProvider] = useState<
    TextRunLayoutProvider<LeaferTextRunStyle> | undefined
  >();
  const [vectorEditState, setVectorEditState] = useState<{
    activeNodeId: string;
    nodeIds: readonly string[];
    selectedSegmentIdsByNode: Readonly<Record<string, readonly string[]>>;
    selectedVertexIdsByNode: Readonly<Record<string, readonly string[]>>;
    tool: LeaferVectorEditTool;
  } | null>(null);
  const vectorEditStateRef = useRef(vectorEditState);
  vectorEditStateRef.current = vectorEditState;
  const tool = isTool(snapshot.state.tool) ? snapshot.state.tool : "select";
  const inlineEditors = useCanvasInlineEditors({
    revision: snapshot.document.revision,
    selection: snapshot.state.selection,
    tool,
  });
  const activeTextRunLayoutProvider = useMemo(() => {
    if (!textRunLayoutProvider) return undefined;
    return composeTextRunLayoutProviders(
      textRunLayoutProvider,
      harfBuzzTextRunLayoutProvider,
    );
  }, [harfBuzzTextRunLayoutProvider, textRunLayoutProvider]);
  const richTextResolution = useMemo(() => {
    if (!activeTextRunLayoutProvider) return undefined;
    return resolveDesignTextRuns(
      snapshot.document,
      activePageId,
      activeTextRunLayoutProvider,
    );
  }, [activePageId, activeTextRunLayoutProvider, snapshot.document]);

  useEffect(() => {
    if (activeTextRunLayoutProvider) {
      runtime.setTextRunLayoutProvider(activeTextRunLayoutProvider);
    }
  }, [activeTextRunLayoutProvider, runtime]);
  const booleanEditScope = useMemo(
    () =>
      resolveBooleanEditScope(
        snapshot.document,
        activePageId,
        snapshot.state.selection.nodeIds,
      ),
    [activePageId, snapshot.document, snapshot.state.selection.nodeIds],
  );
  const vectorEditCollectionScope = useMemo(
    () =>
      resolveVectorEditCollectionScope(
        snapshot.document,
        activePageId,
        snapshot.state.selection.nodeIds,
        tool === "select" ? (vectorEditState?.nodeIds ?? []) : [],
        tool === "select" ? (vectorEditState?.activeNodeId ?? null) : null,
        vectorEditState?.selectedVertexIdsByNode ?? {},
        vectorEditState?.selectedSegmentIdsByNode ?? {},
      ),
    [
      activePageId,
      snapshot.document,
      snapshot.state.selection.nodeIds,
      tool,
      vectorEditState,
    ],
  );
  const vectorEditScope = useMemo(
    () =>
      vectorEditCollectionScope?.nodes.find(
        (scope) => scope.nodeId === vectorEditCollectionScope.activeNodeId,
      ) ?? null,
    [vectorEditCollectionScope],
  );

  useEffect(() => {
    if (vectorEditState && !vectorEditCollectionScope) {
      setVectorEditState(null);
    }
  }, [vectorEditCollectionScope, vectorEditState]);

  useEffect(() => {
    if (activeAgentRunId === null) {
      adapter.current?.finishGenerationPresentation();
    }
  }, [activeAgentRunId]);

  const startImageAreaSelection = useCallback(
    (nodeId: string) => {
      const current = runtime.getSnapshot();
      const node = current.document.nodesById[nodeId];
      const asset =
        node?.kind === "image"
          ? current.document.assetsById[node.properties.assetId]
          : undefined;
      if (
        imageEditActivity !== undefined ||
        tool !== "select" ||
        imageCropState !== null ||
        imageExpand !== null ||
        vectorEditStateRef.current !== null ||
        current.state.selection.nodeIds.length !== 1 ||
        current.state.selection.nodeIds[0] !== nodeId ||
        node?.kind !== "image" ||
        isEffectivelyLocked(current.document, nodeId) ||
        !asset?.size ||
        asset.kind !== "image" ||
        asset.source.type !== "data" ||
        (asset.mimeType !== "image/png" &&
          asset.mimeType !== "image/jpeg" &&
          asset.mimeType !== "image/webp")
      ) {
        return false;
      }
      setImageAreaSelection({
        assetId: node.properties.assetId,
        nodeId,
        pageId: activePageId,
        revision: current.document.revision,
      });
      return true;
    },
    [
      activePageId,
      imageCropState,
      imageEditActivity,
      imageExpand,
      runtime,
      tool,
    ],
  );

  useEffect(() => {
    onImageAreaSelectionControllerChange(startImageAreaSelection);
    return () => onImageAreaSelectionControllerChange(null);
  }, [onImageAreaSelectionControllerChange, startImageAreaSelection]);

  useEffect(() => {
    if (!imageAreaSelection) return;
    const current = snapshot;
    const node = current.document.nodesById[imageAreaSelection.nodeId];
    if (
      activePageId !== imageAreaSelection.pageId ||
      current.document.revision !== imageAreaSelection.revision ||
      tool !== "select" ||
      current.state.selection.nodeIds.length !== 1 ||
      current.state.selection.nodeIds[0] !== imageAreaSelection.nodeId ||
      node?.kind !== "image" ||
      node.properties.assetId !== imageAreaSelection.assetId
    ) {
      setImageAreaSelection(null);
    }
  }, [activePageId, imageAreaSelection, snapshot, tool]);

  const startImageExpand = useCallback(
    (nodeId: string) => {
      const current = runtime.getSnapshot();
      const node = current.document.nodesById[nodeId];
      const asset =
        node?.kind === "image"
          ? current.document.assetsById[node.properties.assetId]
          : undefined;
      if (
        imageEditActivity !== undefined ||
        tool !== "select" ||
        imageCropState !== null ||
        imageAreaSelection !== null ||
        vectorEditStateRef.current !== null ||
        current.state.selection.nodeIds.length !== 1 ||
        current.state.selection.nodeIds[0] !== nodeId ||
        node?.kind !== "image" ||
        node.layoutSizing?.horizontal === "fill" ||
        node.layoutSizing?.vertical === "fill" ||
        isEffectivelyLocked(current.document, nodeId) ||
        !asset?.size ||
        asset.kind !== "image" ||
        asset.source.type !== "data" ||
        (asset.mimeType !== "image/png" &&
          asset.mimeType !== "image/jpeg" &&
          asset.mimeType !== "image/webp")
      ) {
        return false;
      }
      try {
        createImageExpandSession(node.size);
      } catch {
        return false;
      }
      setImageExpand({
        assetId: node.properties.assetId,
        nodeId,
        pageId: activePageId,
        revision: current.document.revision,
      });
      return true;
    },
    [
      activePageId,
      imageAreaSelection,
      imageCropState,
      imageEditActivity,
      runtime,
      tool,
    ],
  );

  useEffect(() => {
    onImageExpandControllerChange(startImageExpand);
    return () => onImageExpandControllerChange(null);
  }, [onImageExpandControllerChange, startImageExpand]);

  useEffect(() => {
    if (!imageExpand) return;
    const node = snapshot.document.nodesById[imageExpand.nodeId];
    if (
      activePageId !== imageExpand.pageId ||
      snapshot.document.revision !== imageExpand.revision ||
      tool !== "select" ||
      snapshot.state.selection.nodeIds.length !== 1 ||
      snapshot.state.selection.nodeIds[0] !== imageExpand.nodeId ||
      node?.kind !== "image" ||
      node.properties.assetId !== imageExpand.assetId
    ) {
      setImageExpand(null);
    }
  }, [activePageId, imageExpand, snapshot, tool]);

  const enterVectorEdit = useCallback(
    (nodeIds: readonly string[]) => {
      if (nodeIds.length === 0) return false;
      const current = runtime.getSnapshot();
      const editableVectorNodeIds = nodeIds.filter((nodeId) => {
        const node = current.document.nodesById[nodeId];
        return (
          node !== undefined &&
          (node.kind === "path" || node.kind === "vector") &&
          "network" in node.properties
        );
      });
      if (editableVectorNodeIds.length !== nodeIds.length) {
        return false;
      }
      const activeNodeId = current.state.selection.anchorNodeId;
      const activeVectorNodeId =
        activeNodeId && editableVectorNodeIds.includes(activeNodeId)
          ? activeNodeId
          : editableVectorNodeIds.at(-1)!;
      const nextState = {
        activeNodeId: activeVectorNodeId,
        nodeIds: [...editableVectorNodeIds],
        selectedSegmentIdsByNode: Object.fromEntries(
          editableVectorNodeIds.map((nodeId) => [nodeId, []]),
        ),
        selectedVertexIdsByNode: Object.fromEntries(
          editableVectorNodeIds.map((nodeId) => [nodeId, []]),
        ),
        tool: "move" as const,
      };
      vectorEditStateRef.current = nextState;
      setVectorEditState(nextState);
      return true;
    },
    [runtime],
  );

  const exitVectorEdit = useCallback(() => {
    vectorEditStateRef.current = null;
    setVectorEditState(null);
    requestAnimationFrame(() => host.current?.focus());
  }, []);

  const changeVectorEditScope = useCallback(
    (request: { mode: "add" | "toggle"; nodeId: string }) => {
      const current = vectorEditStateRef.current;
      if (!current) return;
      const containsNode = current.nodeIds.includes(request.nodeId);
      if (
        request.mode === "toggle" &&
        containsNode &&
        current.nodeIds.length === 1
      ) {
        vectorEditStateRef.current = null;
        setVectorEditState(null);
        return;
      }
      const nodeIds =
        request.mode === "toggle" && containsNode
          ? current.nodeIds.filter((nodeId) => nodeId !== request.nodeId)
          : containsNode
            ? [...current.nodeIds]
            : [...current.nodeIds, request.nodeId];
      const selectedVertexIdsByNode = Object.fromEntries(
        nodeIds.map((nodeId) => [
          nodeId,
          current.selectedVertexIdsByNode[nodeId] ?? [],
        ]),
      );
      const selectedSegmentIdsByNode = Object.fromEntries(
        nodeIds.map((nodeId) => [
          nodeId,
          current.selectedSegmentIdsByNode[nodeId] ?? [],
        ]),
      );
      const activeNodeId = nodeIds.includes(request.nodeId)
        ? request.nodeId
        : current.activeNodeId === request.nodeId
          ? nodeIds.at(-1)!
          : current.activeNodeId;
      const snapshot = runtime.getSnapshot();
      if (
        !resolveVectorEditCollectionScope(
          snapshot.document,
          activePageId,
          nodeIds,
          nodeIds,
          activeNodeId,
          selectedVertexIdsByNode,
          selectedSegmentIdsByNode,
        )
      ) {
        return;
      }
      const next = {
        ...current,
        activeNodeId,
        nodeIds,
        selectedSegmentIdsByNode,
        selectedVertexIdsByNode,
      };
      vectorEditStateRef.current = next;
      setVectorEditState(next);
      runtime.setSelection(nodeIds, activeNodeId);
    },
    [activePageId, runtime],
  );

  const selectBooleanTarget = useCallback(
    (
      nodeIds: readonly string[],
      direction: "enter" | "exit" | "next-operand" | "previous-operand",
    ) => {
      const current = runtime.getSnapshot();
      const target = navigateBooleanSelection(
        current.document,
        activePageId,
        nodeIds,
        direction,
      );
      if (!target) return false;
      runtime.setSelection([target], target);
      return true;
    },
    [activePageId, runtime],
  );

  const navigateSelection = useCallback(
    (direction: "enter" | "exit" | "next-sibling" | "previous-sibling") => {
      const current = runtime.getSnapshot();
      const selection = current.state.selection;
      const nodeId =
        selection.nodeIds.length === 1 ? selection.nodeIds[0] : undefined;
      const node = nodeId ? current.document.nodesById[nodeId] : undefined;
      if (node?.kind === "instance") {
        const result = navigateComponentSelection(
          current.document,
          node.id,
          selection.componentTarget,
          direction,
        );
        if (result) {
          runtime.setSelection(
            [result.instanceId],
            result.instanceId,
            result.componentTarget,
          );
          return true;
        }
      }
      if (selection.componentTarget) return false;
      const target = navigateLayerSelection(
        current.document,
        activePageId,
        selection.nodeIds,
        direction,
      );
      if (!target) return false;
      runtime.setSelection([target], target);
      return true;
    },
    [activePageId, runtime],
  );

  const handleCanvasKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (imageCropState && (event.key === "Enter" || event.key === "Escape")) {
        if (event.key === "Enter") adapter.current?.finishImageCrop();
        else adapter.current?.cancelImageCrop();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        vectorEditScope &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        ["q", "v", "x"].includes(event.key.toLowerCase())
      ) {
        const nextTool =
          event.key.toLowerCase() === "x"
            ? "cut"
            : event.key.toLowerCase() === "q"
              ? "lasso"
              : "move";
        setVectorEditState((current) =>
          current ? { ...current, tool: nextTool } : current,
        );
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const currentSelection = runtime.getSnapshot().state.selection.nodeIds;
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        enterVectorEdit(currentSelection)
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        runtime.setSelection([]);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const direction =
        event.key === "Enter"
          ? event.shiftKey
            ? "exit"
            : "enter"
          : event.key === "Tab"
            ? event.shiftKey
              ? "previous-sibling"
              : "next-sibling"
            : null;
      if (!direction || !navigateSelection(direction)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [
      enterVectorEdit,
      imageCropState,
      navigateSelection,
      runtime,
      vectorEditScope,
    ],
  );

  const handleCanvasDoubleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest(`.${styles.contextStack}`)
      ) {
        return;
      }
      const currentSelection = runtime.getSnapshot().state.selection.nodeIds;
      if (
        currentSelection.length === 1 &&
        adapter.current?.startImageCrop(currentSelection[0])
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (enterVectorEdit(currentSelection)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!selectBooleanTarget(currentSelection, "enter")) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [enterVectorEdit, runtime, selectBooleanTarget],
  );

  const acceptsAssetDrag = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes(DESIGN_ASSET_DRAG_MIME);

  const handleAssetDragOver = (event: DragEvent<HTMLElement>) => {
    if (!acceptsAssetDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setAssetDropActive(true);
  };

  const handleAssetDrop = (event: DragEvent<HTMLElement>) => {
    if (!acceptsAssetDrag(event)) return;
    event.preventDefault();
    setAssetDropActive(false);
    const assetId = event.dataTransfer.getData(DESIGN_ASSET_DRAG_MIME);
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(assetId)) {
      onTransactionError(t("sidebar.assetActionFailed"));
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const current = runtime.getSnapshot().state.viewport;
    const point = screenToDocument(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      current,
    );
    onAssetDrop(assetId, point);
  };

  const applyOperations = useCallback(
    (request: LeaferOperationRequest) =>
      commitCanvasOperation({
        request,
        runtime,
        onResizeFrame,
        onTransactionError,
        label: operationLabel(request.kind, request.operations.length, t),
        transactionId: `canvas_${crypto.randomUUID().replaceAll("-", "")}`,
      }),
    [onResizeFrame, onTransactionError, runtime, t],
  );

  const applyImageCrop = useCallback(
    (request: LeaferImageCropCommitRequest) => {
      const current = runtime.getSnapshot();
      const plan = planImageNodeUpdate(current.document, {
        action: "set-placement",
        pageId: activePageId,
        nodeId: request.nodeId,
        placement: request.placement,
      });
      if (!plan.ok) {
        if (plan.code === "no-op") return true;
        onTransactionError(plan.message);
        return false;
      }
      return applyOperations({ kind: "image", operations: plan.commands });
    },
    [activePageId, applyOperations, onTransactionError, runtime],
  );

  const applyVectorEdit = useCallback(
    (request: LeaferVectorEditRequest) => {
      const current = runtime.getSnapshot();
      const plan = request.deleteNode
        ? planDeleteVectorNode(current.document, activePageId, request.nodeId)
        : planVectorNetworkUpdates(
            current.document,
            activePageId,
            request.edits,
          );
      if (!plan.ok) {
        onTransactionError(plan.message);
        return false;
      }
      const accepted = applyOperations({
        kind: "vector",
        operations: [...plan.operations],
      });
      if (accepted && request.deleteNode) setVectorEditState(null);
      return accepted;
    },
    [activePageId, applyOperations, onTransactionError, runtime],
  );

  const applyVectorPathAction = useCallback(
    (
      action:
        | { action: "set-closed"; closed: boolean; pathId?: string }
        | { action: "reverse-path"; pathId?: string }
        | {
            action: "connect-endpoints";
            vertexIds: readonly [string, string];
          }
        | {
            action: "disconnect-vertex";
            pathId: string;
            vertexId: string;
          },
    ) => {
      const current = runtime.getSnapshot();
      const nodeId = vectorEditState?.activeNodeId;
      if (!nodeId) return false;
      const plan = planVectorSemanticEdit(
        current.document,
        activePageId,
        nodeId,
        action,
      );
      if (!plan.ok) {
        onTransactionError(plan.message);
        return false;
      }
      const accepted = applyOperations({
        kind: "vector",
        operations: [...plan.operations],
      });
      const cutResult = plan.cutResult;
      if (accepted && cutResult) {
        setVectorEditState((state) =>
          state?.nodeIds.includes(nodeId)
            ? {
                ...state,
                selectedSegmentIdsByNode: {
                  ...state.selectedSegmentIdsByNode,
                  [nodeId]: [],
                },
                selectedVertexIdsByNode: {
                  ...state.selectedVertexIdsByNode,
                  [nodeId]: [...cutResult.cutVertexIds],
                },
              }
            : state,
        );
      }
      return accepted;
    },
    [
      activePageId,
      applyOperations,
      onTransactionError,
      runtime,
      vectorEditState?.activeNodeId,
    ],
  );

  const applyVectorCut = useCallback(
    (request: LeaferVectorCutRequest): LeaferVectorCutResponse => {
      const current = runtime.getSnapshot();
      const plan = planVectorSemanticEdit(
        current.document,
        activePageId,
        request.nodeId,
        {
          action: "cut-path",
          at: request.at,
          pathId: request.pathId,
        },
      );
      if (!plan.ok || !plan.cutResult) {
        onTransactionError(
          plan.ok ? t("canvas.vectorCutUnavailable") : plan.message,
        );
        return { ok: false };
      }
      const cutResult = plan.cutResult;
      const accepted = applyOperations({
        kind: "vector",
        operations: [...plan.operations],
      });
      if (!accepted) return { ok: false };
      const applied = runtime.getSnapshot().document.nodesById[request.nodeId];
      if (
        !applied ||
        (applied.kind !== "path" && applied.kind !== "vector") ||
        !("network" in applied.properties)
      ) {
        onTransactionError(t("canvas.vectorCutApplyMissing"));
        return { ok: false };
      }
      setVectorEditState((state) =>
        state?.nodeIds.includes(request.nodeId)
          ? {
              ...state,
              selectedSegmentIdsByNode: {
                ...state.selectedSegmentIdsByNode,
                [request.nodeId]: [],
              },
              selectedVertexIdsByNode: {
                ...state.selectedVertexIdsByNode,
                [request.nodeId]: [...cutResult.cutVertexIds],
              },
            }
          : state,
      );
      return {
        ok: true,
        network: applied.properties.network,
        selectedVertexIds: cutResult.cutVertexIds,
      };
    },
    [activePageId, applyOperations, onTransactionError, runtime, t],
  );

  const applyVectorLineCut = useCallback(
    (request: LeaferVectorLineCutRequest): LeaferVectorLineCutResponse => {
      const current = runtime.getSnapshot();
      const targets = request.nodeIds.map((nodeId) => ({
        nodeId,
        resultNodeId: `vector_cut_${crypto.randomUUID().replaceAll("-", "")}`,
      }));
      const plan = planVectorLayersLineCut(
        current.document,
        activePageId,
        targets,
        request.start,
        request.end,
      );
      if (!plan.ok || !plan.layerLineCutResult) {
        onTransactionError(
          plan.ok ? t("canvas.vectorLineCutUnavailable") : plan.message,
        );
        return { ok: false };
      }
      const accepted = applyOperations({
        kind: "vector",
        operations: [...plan.operations],
      });
      if (!accepted) return { ok: false };
      const resultNodeIds = plan.layerLineCutResult.resultNodeIds;
      const applied = runtime.getSnapshot().document;
      if (resultNodeIds.some((nodeId) => !applied.nodesById[nodeId])) {
        onTransactionError(t("canvas.vectorLineCutApplyMissing"));
        return { ok: false };
      }
      setVectorEditState(null);
      runtime.setSelection([...resultNodeIds], resultNodeIds.at(-1));
      requestAnimationFrame(() => host.current?.focus());
      return { ok: true, resultNodeIds };
    },
    [activePageId, applyOperations, onTransactionError, runtime, t],
  );

  const createNode = useCallback(
    (request: LeaferCreateRequest) => {
      const current = runtime.getSnapshot();
      const parent = request.parentId
        ? current.document.nodesById[request.parentId]
        : undefined;
      if (
        request.parentId &&
        (!parent || (!isFrameLikeNode(parent) && parent.kind !== "group"))
      ) {
        return false;
      }
      const target =
        parent?.childIds ??
        current.document.pagesById[request.pageId]?.rootNodeIds;
      if (!target) return false;

      const id = `${request.tool}_${Date.now()}_${current.document.revision}`;
      const node = createDesignNode(
        request.tool,
        id,
        request.parentId,
        { x: request.x, y: request.y },
        request.dragged
          ? { width: request.width, height: request.height }
          : undefined,
        request.start && request.end
          ? { start: request.start, end: request.end }
          : undefined,
        t,
      );
      const accepted = applyOperations({
        kind: "transform",
        operations: [
          {
            commandId: `insert_${id}`,
            type: "insert_element",
            pageId: request.pageId,
            parentId: request.parentId,
            index: target.length,
            node,
          },
        ],
      });
      if (accepted) {
        runtime.setSelection([id], id);
        runtime.setTool("select");
      }
      return accepted;
    },
    [applyOperations, runtime, t],
  );

  const createVectorNode = useCallback(
    (request: LeaferCreateVectorRequest) => {
      const current = runtime.getSnapshot();
      const parent = request.parentId
        ? current.document.nodesById[request.parentId]
        : undefined;
      if (
        request.parentId &&
        (!parent || (!isFrameLikeNode(parent) && parent.kind !== "group"))
      ) {
        return false;
      }
      const target =
        parent?.childIds ??
        current.document.pagesById[request.pageId]?.rootNodeIds;
      if (!target) return false;

      const id = `vector_${Date.now()}_${current.document.revision}`;
      const node: VectorNode = {
        id,
        name: t("canvas.newNode", { kind: t("node.vector") }),
        parentId: request.parentId,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, request.x, request.y],
        size: { width: request.width, height: request.height },
        exportSettings: [],
        opacity: 1,
        extensions: {},
        kind: "vector",
        properties: {
          network: request.network,
          fillRule: "nonzero",
          fills: request.closed
            ? [{ type: "solid", color: "#4f7fff", opacity: 1 }]
            : [],
          strokes: request.closed
            ? []
            : [{ type: "solid", color: "#151515", opacity: 1 }],
          strokeWidth: request.closed ? 0 : 2,
          strokeAlign: "center",
          strokeCap: "round",
          strokeJoin: "round",
          dashPattern: [],
        },
      };
      const accepted = applyOperations({
        kind: "transform",
        operations: [
          {
            commandId: `insert_${id}`,
            type: "insert_element",
            pageId: request.pageId,
            parentId: request.parentId,
            index: target.length,
            node,
          },
        ],
      });
      if (accepted) runtime.setSelection([id], id);
      return accepted;
    },
    [applyOperations, runtime, t],
  );

  const updateViewport = useCallback(
    (viewport: ViewportState) => {
      const current = runtime.getSnapshot().state.viewport;
      if (sameViewport(current, viewport)) return;
      runtime.setViewport(viewport);
    },
    [runtime],
  );

  useEffect(() => {
    changesByRevision.current.clear();
    generationRevealByRevision.current.clear();
    return runtime.subscribe((event, nextSnapshot) => {
      if (event.type !== "document.changed") return;
      changesByRevision.current.set(
        event.result.changes.toRevision,
        event.result.changes,
      );
      const reveal = generationRevealFromEditorEvent(
        event,
        nextSnapshot.document,
        activePageId,
        performance.now(),
      );
      if (reveal) {
        generationRevealByRevision.current.set(
          event.result.changes.toRevision,
          reveal,
        );
      }
      if (changesByRevision.current.size <= 8) return;
      const oldest = [...changesByRevision.current.keys()].sort(
        (left, right) => left - right,
      )[0];
      if (oldest !== undefined) {
        changesByRevision.current.delete(oldest);
        generationRevealByRevision.current.delete(oldest);
      }
    });
  }, [activePageId, runtime]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    setRenderError(null);

    void createLeaferEngineAdapter(element, {
      onAutoLayoutSpacingCommit: ({ change, expectedRevision, frameId }) =>
        onAdjustAutoLayoutSpacing(frameId, expectedRevision, change),
      onAutoLayoutSpacingInputRequest: (request) =>
        inlineEditors.openAutoLayoutSpacing(request, element),
      onCreate: createNode,
      onCreateVector: createVectorNode,
      onError: (error) => {
        if (!disposed)
          setRenderError(error.message || t("canvas.renderFailed"));
      },
      onImageCropCommit: applyImageCrop,
      onImageCropStateChange: setImageCropState,
      onGridTrackReorder: ({ axis, frameId, fromIndices, insertionIndex }) =>
        onReorderGridTracks(frameId, axis, fromIndices, insertionIndex),
      onGridTrackInputRequest: (request) =>
        inlineEditors.openGridTrack(request, element),
      onGridTrackResize: ({ axis, expectedRevision, frameId, index, value }) =>
        onSetGridTracks(frameId, expectedRevision, axis, [index], {
          type: "fixed",
          value,
        }),
      onOperations: applyOperations,
      onSelectionChange: (nodeIds, anchorNodeId, componentTarget) => {
        runtime.setSelection(nodeIds, anchorNodeId, componentTarget);
      },
      onTextRangeSelectionChange,
      onVectorCut: applyVectorCut,
      onVectorEdit: applyVectorEdit,
      onVectorEditActiveNodeChange: (nodeId) => {
        setVectorEditState((current) => {
          if (!current?.nodeIds.includes(nodeId)) return current;
          const next = { ...current, activeNodeId: nodeId };
          vectorEditStateRef.current = next;
          return next;
        });
      },
      onVectorEditExit: exitVectorEdit,
      onVectorEditScopeChange: changeVectorEditScope,
      onVectorLineCut: applyVectorLineCut,
      onVectorEditSelectionChange: (nodeId, selection) => {
        setVectorEditState((current) => {
          if (!current?.nodeIds.includes(nodeId)) return current;
          const next = {
            ...current,
            activeNodeId: nodeId,
            selectedSegmentIdsByNode: {
              ...current.selectedSegmentIdsByNode,
              [nodeId]: [...selection.segmentIds],
            },
            selectedVertexIdsByNode: {
              ...current.selectedVertexIdsByNode,
              [nodeId]: [...selection.vertexIds],
            },
          };
          vectorEditStateRef.current = next;
          return next;
        });
      },
      onWarningsChange: (warnings) => {
        setFidelityWarnings((current) =>
          sameFidelityWarnings(current, warnings) ? current : [...warnings],
        );
      },
      onViewportChange: updateViewport,
    })
      .then((engine) => {
        if (disposed) {
          engine.dispose();
          return;
        }
        adapter.current = engine;
        onImageCropControllerChange((nodeId) => engine.startImageCrop(nodeId));
        onTextEditingStyleControllerChange((style) =>
          engine.updateTextEditingStyle(style),
        );
        onTextLayoutProviderReady(engine.textLayoutProvider);
        runtime.setTextRunLayoutProvider(engine.textRunLayoutProvider);
        setTextRunLayoutProvider(() => engine.textRunLayoutProvider);
        if (latestInput.current) engine.sync(latestInput.current);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setRenderError(
            error instanceof Error ? error.message : t("canvas.renderFailed"),
          );
        }
      });

    return () => {
      disposed = true;
      adapter.current?.dispose();
      adapter.current = null;
      onImageCropControllerChange(null);
      onTextEditingStyleControllerChange(null);
      setImageCropState(null);
      setTextRunLayoutProvider(undefined);
      onTextRangeSelectionChange(null);
    };
  }, [
    applyImageCrop,
    applyOperations,
    applyVectorCut,
    applyVectorEdit,
    applyVectorLineCut,
    changeVectorEditScope,
    createNode,
    createVectorNode,
    exitVectorEdit,
    inlineEditors.openAutoLayoutSpacing,
    inlineEditors.openGridTrack,
    onImageCropControllerChange,
    onReorderGridTracks,
    onSetGridTracks,
    onAdjustAutoLayoutSpacing,
    onTextLayoutProviderReady,
    onTextEditingStyleControllerChange,
    onTextRangeSelectionChange,
    runtime,
    t,
    updateViewport,
  ]);

  useEffect(() => {
    const changes = changesByRevision.current.get(snapshot.document.revision);
    const generationReveal = generationRevealByRevision.current.get(
      snapshot.document.revision,
    );
    const input: LeaferEngineSyncInput = {
      ...(booleanEditScope
        ? {
            booleanEditScope: {
              booleanId: booleanEditScope.booleanId,
              readOnly: booleanEditScope.readOnly,
              selectedOperandIds: booleanEditScope.selectedOperandIds,
            },
          }
        : {}),
      document: snapshot.document,
      ...(changes ? { changes } : {}),
      ...(generationActivity ? { generationActivity } : {}),
      ...(generationReveal ? { generationReveal } : {}),
      pageId: activePageId,
      ...(layerHoverTarget ? { layerHoverTarget } : {}),
      ...(!snapshot.state.selection.componentTarget &&
      snapshot.state.selection.nodeIds.length === 1 &&
      snapshot.document.nodesById[snapshot.state.selection.nodeIds[0] ?? ""]
        ?.kind === "frame"
        ? { layoutGuideFrameId: snapshot.state.selection.nodeIds[0] }
        : {}),
      ...(tool === "select" &&
      !snapshot.state.selection.componentTarget &&
      snapshot.state.selection.nodeIds.length === 1 &&
      snapshot.document.nodesById[snapshot.state.selection.nodeIds[0] ?? ""]
        ?.kind === "frame"
        ? {
            autoLayoutSpacingFrameId: snapshot.state.selection.nodeIds[0],
            gridEditorFrameId: snapshot.state.selection.nodeIds[0],
          }
        : {}),
      reducedMotion,
      ...(richTextResolution
        ? { textRunProjection: richTextResolution.projection }
        : {}),
      selection: snapshot.state.selection,
      tool,
      ...(vectorEditCollectionScope
        ? {
            vectorEditScope: {
              activeNodeId: vectorEditCollectionScope.activeNodeId,
              nodes: vectorEditCollectionScope.nodes.map((scope) => ({
                nodeId: scope.nodeId,
                readOnly: scope.readOnly,
                selectedSegmentIds: scope.selectedSegmentIds,
                selectedVertexIds: scope.selectedVertexIds,
              })),
              tool: vectorEditState?.tool ?? "move",
            },
          }
        : {}),
      viewport: snapshot.state.viewport,
    };
    latestInput.current = input;
    adapter.current?.sync(input);
  }, [
    activePageId,
    booleanEditScope,
    generationActivity,
    layerHoverTarget,
    snapshot.document,
    reducedMotion,
    richTextResolution,
    snapshot.state.selection,
    snapshot.state.viewport,
    tool,
    vectorEditState?.tool,
    vectorEditCollectionScope,
  ]);

  const seriousBooleanWarnings = fidelityWarnings.filter(
    (warning) =>
      warning.code === "boolean-geometry-failed" ||
      warning.code === "boolean-geometry-provider-failed" ||
      warning.code === "boolean-geometry-unsupported",
  );
  const selectedRichTextWarning = richTextResolution?.warnings.find(
    (warning) =>
      warning.nodeId === snapshot.state.selection.anchorNodeId &&
      warning.code === "rich-text-layout-failed",
  );
  const selectedBooleanId =
    booleanEditScope?.booleanId ??
    (snapshot.state.selection.nodeIds.length === 1 &&
    snapshot.document.nodesById[snapshot.state.selection.nodeIds[0] ?? ""]
      ?.kind === "boolean"
      ? snapshot.state.selection.nodeIds[0]
      : undefined);
  const activeWarning =
    seriousBooleanWarnings.find(
      (warning) => warning.nodeId === selectedBooleanId,
    ) ?? seriousBooleanWarnings[0];
  const warningBoolean = activeWarning
    ? snapshot.document.nodesById[activeWarning.nodeId]
    : undefined;
  const imageCropNode = imageCropState
    ? snapshot.document.nodesById[imageCropState.nodeId]
    : undefined;
  const editScopeBoolean = booleanEditScope
    ? snapshot.document.nodesById[booleanEditScope.booleanId]
    : undefined;
  const editScopeVector = vectorEditScope
    ? snapshot.document.nodesById[vectorEditScope.nodeId]
    : undefined;
  const vectorEditLayerCount = vectorEditCollectionScope?.nodes.length ?? 0;
  const editScopeVectorClosed =
    editScopeVector &&
    (editScopeVector.kind === "path" || editScopeVector.kind === "vector") &&
    "network" in editScopeVector.properties
      ? editScopeVector.properties.network.paths.find(
          (path) => path.id === vectorEditScope?.activePathId,
        )?.closed
      : undefined;

  return (
    <main
      aria-label={t("canvas.label")}
      className={`${styles.root} ${styles.leafer}${
        assetDropActive ? ` ${styles.assetDrop}` : ""
      }`}
      onDragLeave={(event) => {
        const related = event.relatedTarget;
        if (!(
          related instanceof Node && event.currentTarget.contains(related)
        )) {
          setAssetDropActive(false);
        }
      }}
      onDragOver={handleAssetDragOver}
      onDrop={handleAssetDrop}
      onDoubleClick={handleCanvasDoubleClick}
      onKeyDown={handleCanvasKeyDown}
      onPointerDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(
            `.${styles.contextStack}, .${styles.selectionQuickActions}`,
          )
        ) {
          return;
        }
        host.current?.focus();
      }}
      ref={host}
      tabIndex={0}
    >
      {assetDropActive && (
        <div className={styles.assetDropHint} role="status">
          <Icon name="lucide:image" size={15} />
          {t("canvas.dropImageAsset")}
        </div>
      )}
      {inlineEditors.autoLayoutSpacing &&
        (() => {
          const request = inlineEditors.autoLayoutSpacing;
          return (
            <AutoLayoutSpacingInput
              label={t(autoLayoutSpacingInputLabel(request.kind))}
              onClose={inlineEditors.closeAutoLayoutSpacing}
              onCommit={(change) =>
                onAdjustAutoLayoutSpacing(
                  request.frameId,
                  request.expectedRevision,
                  change,
                )
              }
              request={request}
            />
          );
        })()}
      {inlineEditors.gridTrack &&
        (() => {
          const request = inlineEditors.gridTrack;
          return (
            <GridTrackInput
              fixedLabel={t("properties.autoLayoutFixed")}
              fillLabel={t("properties.autoLayoutFill")}
              hugLabel={t("properties.autoLayoutHug")}
              label={t("properties.autoLayoutTrackSelection", {
                count: request.tracks.length,
                label: t(
                  request.axis === "columns"
                    ? "properties.autoLayoutColumns"
                    : "properties.autoLayoutRows",
                ),
              })}
              mixedLabel={t("properties.mixed")}
              onClose={inlineEditors.closeGridTrack}
              onCommit={(track) =>
                onSetGridTracks(
                  request.frameId,
                  request.expectedRevision,
                  request.axis,
                  request.tracks.map((item) => item.index),
                  track,
                )
              }
              request={request}
            />
          );
        })()}
      {imageAreaSelection &&
        (() => {
          const node = snapshot.document.nodesById[imageAreaSelection.nodeId];
          const asset =
            snapshot.document.assetsById[imageAreaSelection.assetId];
          if (node?.kind !== "image" || !asset?.size) return null;
          return (
            <ImageAreaSelectionOverlay
              document={snapshot.document}
              node={node}
              onCancel={() => setImageAreaSelection(null)}
              onSubmit={(action, selection) => {
                setImageAreaSelection(null);
                onImageAreaEdit(node.id, action, selection);
              }}
              sourceSize={asset.size}
              viewport={snapshot.state.viewport}
            />
          );
        })()}
      {imageExpand &&
        (() => {
          const node = snapshot.document.nodesById[imageExpand.nodeId];
          if (node?.kind !== "image") return null;
          return (
            <ImageExpandOverlay
              document={snapshot.document}
              node={node}
              onCancel={() => setImageExpand(null)}
              onSubmit={(expansion) => {
                setImageExpand(null);
                onImageExpand(node.id, expansion);
              }}
              viewport={snapshot.state.viewport}
            />
          );
        })()}
      {generationActivity && (
        <span aria-live="polite" className="visually-hidden" role="status">
          {generationActivity.label}
        </span>
      )}
      {showAgentRunStatus && agentRunStatus && (
        <div
          aria-label={t("agent.runStatus")}
          className={styles.agentRunStatus}
          data-canvas-agent-status=""
          data-canvas-changed={
            agentRunStatus.hasCanvasChanges ? "true" : "false"
          }
          data-phase={agentRunStatus.phase}
          role="status"
        >
          <span aria-hidden="true" className={styles.agentRunMark} />
          <span>
            <strong>{agentRunStatus.title}</strong>
            <small>{agentRunStatus.detail}</small>
          </span>
        </div>
      )}
      {selectionActions &&
        tool === "select" &&
        !imageCropState &&
        !imageAreaSelection &&
        !imageExpand &&
        !vectorEditScope &&
        !booleanEditScope && (
          <div className={styles.selectionQuickActions}>{selectionActions}</div>
        )}
      {renderError && (
        <div className={styles.status} role="alert">
          <span className={styles.statusMark} />
          <strong>{t("canvas.unavailable")}</strong>
          <small>{renderError}</small>
        </div>
      )}
      {(imageEditActivity ||
        imageCropState ||
        vectorEditScope ||
        booleanEditScope ||
        activeWarning ||
        selectedRichTextWarning) && (
        <div className={styles.contextStack}>
          {imageEditActivity && (
            <div className={styles.editScope} role="status">
              <span className={styles.contextMark} />
              <span>
                <strong>
                  {t("canvas.imageEditRunning", {
                    name: imageEditActivity.nodeName,
                  })}
                </strong>
                <small>
                  {t(IMAGE_EDIT_PROGRESS_LABEL_KEYS[imageEditActivity.action])}
                </small>
              </span>
              <button
                disabled={imageEditActivity.status === "cancelling"}
                onClick={imageEditActivity.onCancel}
                type="button"
              >
                {imageEditActivity.status === "cancelling"
                  ? t("properties.imageCancellingEdit")
                  : t("common.cancel")}
              </button>
            </div>
          )}
          {imageCropState && (
            <div className={styles.editScope} role="status">
              <span className={styles.contextMark} />
              <span>
                <strong>
                  {t("canvas.imageCropping", {
                    name: imageCropNode?.name || t("node.image"),
                  })}
                </strong>
                <small>{t("canvas.imageCroppingHint")}</small>
              </span>
              <span className={styles.imageCropTools}>
                <label>
                  <span>{t("canvas.imageCropZoom")}</span>
                  <input
                    aria-label={t("canvas.imageCropZoom")}
                    max={6_400}
                    min={100}
                    onChange={(event) =>
                      adapter.current?.updateImageCropZoom(
                        Number(event.target.value) / 100,
                      )
                    }
                    step={1}
                    type="range"
                    value={Math.round(imageCropState.placement.zoom * 100)}
                  />
                  <output>
                    {Math.round(imageCropState.placement.zoom * 100)}%
                  </output>
                </label>
                <button
                  onClick={() => adapter.current?.resetImageCrop()}
                  type="button"
                >
                  {t("canvas.imageCropReset")}
                </button>
                <button
                  onClick={() => adapter.current?.cancelImageCrop()}
                  type="button"
                >
                  {t("canvas.imageCropCancel")}
                  <kbd>Esc</kbd>
                </button>
                <button
                  className={styles.primaryContextAction}
                  onClick={() => adapter.current?.finishImageCrop()}
                  type="button"
                >
                  {t("canvas.imageCropDone")}
                  <kbd>Enter</kbd>
                </button>
              </span>
            </div>
          )}
          {selectedRichTextWarning && (
            <div
              className={`${styles.editScope} ${styles.fidelityWarning}`}
              role="alert"
            >
              <span className={styles.warningMark} />
              <span>
                <strong>{t("canvas.richTextFallback")}</strong>
                <small>{selectedRichTextWarning.message}</small>
              </span>
            </div>
          )}
          {vectorEditScope &&
            editScopeVector &&
            (editScopeVector.kind === "path" ||
              editScopeVector.kind === "vector") && (
              <div className={styles.editScope} role="status">
                <span className={styles.contextMark} />
                <span>
                  <strong>
                    {t("canvas.vectorEditing", {
                      name: editScopeVector.name || t("node.vector"),
                    })}
                  </strong>
                  <small>
                    {vectorEditLayerCount > 1
                      ? `${t("canvas.vectorEditingLayers", {
                          count: vectorEditLayerCount,
                        })} · `
                      : ""}
                    {vectorEditScope.readOnly
                      ? t("canvas.vectorEditingReadOnly")
                      : vectorEditState?.tool === "cut"
                        ? t("canvas.vectorCutHint")
                        : vectorEditState?.tool === "lasso"
                          ? t("canvas.vectorLassoHint")
                          : t("canvas.vectorEditingHint", {
                              pathCount:
                                vectorEditScope.selectedSegmentIds.length,
                              pointCount:
                                vectorEditScope.selectedVertexIds.length,
                            })}
                  </small>
                </span>
                <span className={styles.vectorTools}>
                  <span
                    aria-label={t("canvas.vectorEditTool")}
                    className={styles.vectorModes}
                    role="group"
                  >
                    {(
                      [
                        ["move", "canvas.vectorToolMove", "V"],
                        ["cut", "canvas.vectorToolCut", "X"],
                        ["lasso", "canvas.vectorToolLasso", "Q"],
                      ] as const
                    ).map(([mode, label, shortcut]) => (
                      <button
                        aria-keyshortcuts={shortcut}
                        aria-pressed={vectorEditState?.tool === mode}
                        disabled={vectorEditScope.readOnly && mode === "cut"}
                        key={mode}
                        onClick={() => {
                          setVectorEditState((current) =>
                            current ? { ...current, tool: mode } : current,
                          );
                          requestAnimationFrame(() => host.current?.focus());
                        }}
                        title={`${t(label)} (${shortcut})`}
                        type="button"
                      >
                        {t(label)}
                      </button>
                    ))}
                  </span>
                  <span
                    aria-label={t("canvas.vectorPointMode")}
                    className={styles.vectorModes}
                    role="group"
                  >
                    {(
                      [
                        ["corner", "canvas.vectorPointCorner"],
                        ["smooth", "canvas.vectorPointSmooth"],
                        ["mirrored", "canvas.vectorPointMirrored"],
                        ["independent", "canvas.vectorPointIndependent"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        aria-pressed={vectorEditScope.pointMode === mode}
                        disabled={
                          vectorEditScope.readOnly ||
                          vectorEditScope.selectedVertexIds.length === 0
                        }
                        key={mode}
                        onClick={() => {
                          adapter.current?.setVectorPointMode(mode);
                          requestAnimationFrame(() => host.current?.focus());
                        }}
                        title={t(label)}
                        type="button"
                      >
                        {t(label)}
                      </button>
                    ))}
                  </span>
                  <span
                    aria-label={t("canvas.vectorPathActions")}
                    className={styles.vectorActions}
                    role="group"
                  >
                    <button
                      disabled={
                        vectorEditScope.readOnly ||
                        vectorEditScope.selectedVertexIds.length !== 2
                      }
                      onClick={() => {
                        const [firstVertexId, secondVertexId] =
                          vectorEditScope.selectedVertexIds;
                        if (firstVertexId && secondVertexId) {
                          applyVectorPathAction({
                            action: "connect-endpoints",
                            vertexIds: [firstVertexId, secondVertexId],
                          });
                        }
                        requestAnimationFrame(() => host.current?.focus());
                      }}
                      type="button"
                    >
                      {t("canvas.vectorConnectEndpoints")}
                    </button>
                    <button
                      disabled={
                        vectorEditScope.readOnly ||
                        vectorEditScope.selectedVertexIds.length !== 1 ||
                        vectorEditScope.activePathId === undefined
                      }
                      onClick={() => {
                        const [vertexId] = vectorEditScope.selectedVertexIds;
                        if (vertexId && vectorEditScope.activePathId) {
                          applyVectorPathAction({
                            action: "disconnect-vertex",
                            pathId: vectorEditScope.activePathId,
                            vertexId,
                          });
                        }
                        requestAnimationFrame(() => host.current?.focus());
                      }}
                      type="button"
                    >
                      {t("canvas.vectorDisconnectVertex")}
                    </button>
                    <button
                      disabled={
                        vectorEditScope.readOnly ||
                        editScopeVectorClosed === undefined
                      }
                      onClick={() => {
                        if (editScopeVectorClosed !== undefined) {
                          applyVectorPathAction({
                            action: "set-closed",
                            closed: !editScopeVectorClosed,
                            pathId: vectorEditScope.activePathId,
                          });
                        }
                        requestAnimationFrame(() => host.current?.focus());
                      }}
                      type="button"
                    >
                      {editScopeVectorClosed
                        ? t("canvas.vectorPathOpen")
                        : t("canvas.vectorPathClose")}
                    </button>
                    <button
                      disabled={
                        vectorEditScope.readOnly ||
                        vectorEditScope.activePathId === undefined
                      }
                      onClick={() => {
                        applyVectorPathAction({
                          action: "reverse-path",
                          pathId: vectorEditScope.activePathId,
                        });
                        requestAnimationFrame(() => host.current?.focus());
                      }}
                      type="button"
                    >
                      {t("canvas.vectorPathReverse")}
                    </button>
                  </span>
                </span>
                <button
                  aria-label={t("canvas.exitVectorEditing")}
                  onClick={exitVectorEdit}
                  type="button"
                >
                  {t("common.done")}
                  <kbd>Esc</kbd>
                </button>
              </div>
            )}
          {booleanEditScope && editScopeBoolean?.kind === "boolean" && (
            <div className={styles.editScope} role="status">
              <span className={styles.contextMark} />
              <span>
                <strong>
                  {t("canvas.booleanEditing", {
                    name: editScopeBoolean.name || t("node.boolean"),
                  })}
                </strong>
                <small>
                  {booleanEditScope.readOnly
                    ? t("canvas.booleanEditingReadOnly")
                    : t("canvas.booleanEditingHint")}
                </small>
              </span>
              <button
                aria-label={t("canvas.exitBooleanEditing")}
                onClick={() => {
                  runtime.setSelection(
                    [booleanEditScope.booleanId],
                    booleanEditScope.booleanId,
                  );
                  requestAnimationFrame(() => host.current?.focus());
                }}
                type="button"
              >
                {t("common.done")}
                <kbd>Esc</kbd>
              </button>
            </div>
          )}
          {activeWarning && warningBoolean?.kind === "boolean" && (
            <div className={styles.fidelityWarning} role="alert">
              <span className={styles.warningMark}>!</span>
              <span>
                <strong>{t("canvas.booleanRenderWarning")}</strong>
                <small>{activeWarning.message}</small>
              </span>
              <span className={styles.warningActions}>
                {!booleanEditScope && (
                  <button
                    onClick={() => {
                      selectBooleanTarget([warningBoolean.id], "enter");
                      requestAnimationFrame(() => host.current?.focus());
                    }}
                    type="button"
                  >
                    {t("canvas.editBooleanSources")}
                  </button>
                )}
                {activeWarning.code === "boolean-geometry-provider-failed" && (
                  <button
                    onClick={() => {
                      adapter.current?.retryBooleanGeometry();
                      requestAnimationFrame(() => host.current?.focus());
                    }}
                    type="button"
                  >
                    {t("canvas.retryBooleanRendering")}
                  </button>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function operationLabel(
  kind: LeaferOperationKind,
  count: number,
  t: (key: MessageKey, parameters?: MessageParameters) => string,
) {
  switch (kind) {
    case "move":
      return t(count === 1 ? "canvas.moveLayer" : "canvas.moveLayers");
    case "resize":
      return t("canvas.resizeLayer");
    case "rotate":
      return t("canvas.rotateLayers");
    case "skew":
      return t("canvas.skewLayers");
    case "text":
      return t("canvas.editText");
    case "vector":
      return t("canvas.editVector");
    case "image":
      return t("history.updateImagePlacement");
    case "transform":
      return t("canvas.transformLayers");
  }
}

function autoLayoutSpacingInputLabel(
  kind: LeaferAutoLayoutSpacingInputRequest["kind"],
): MessageKey {
  if (kind === "gap") return "properties.autoLayoutGap";
  if (kind === "counter-gap") return "properties.autoLayoutCounterGap";
  return `properties.padding.${kind.slice("padding-".length)}` as MessageKey;
}

function createDesignNode(
  tool: LeaferCreateRequest["tool"],
  id: string,
  parentId: string | null,
  point: { x: number; y: number },
  drawnSize: DesignNode["size"] | undefined,
  lineEndpoints:
    | {
        start: { x: number; y: number };
        end: { x: number; y: number };
      }
    | undefined,
  t: (key: MessageKey, parameters?: MessageParameters) => string,
):
  | FrameNode
  | SliceNode
  | RectangleNode
  | EllipseNode
  | LineNode
  | PolygonNode
  | StarNode
  | TextNode {
  const base = {
    id,
    name: t("canvas.newNode", { kind: t(`node.${tool}` as MessageKey) }),
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, point.x, point.y] as DesignNode["transform"],
    exportSettings: [],
    opacity: 1,
    extensions: {},
  };
  const shape = {
    fills: [{ type: "solid" as const, color: "#4f7fff", opacity: 1 }],
    strokes: [],
    strokeWidth: 0,
  };
  if (tool === "frame") {
    return {
      ...base,
      kind: "frame",
      size: drawnSize ?? { width: 320, height: 240 },
      properties: { ...shape, cornerRadius: 12, clipsContent: true },
    };
  }
  if (tool === "slice") {
    return {
      ...base,
      kind: "slice",
      size: drawnSize ?? { width: 320, height: 240 },
      properties: {},
    };
  }
  if (tool === "ellipse") {
    return {
      ...base,
      kind: "ellipse",
      size: drawnSize ?? { width: 120, height: 120 },
      properties: shape,
    };
  }
  if (tool === "line" || tool === "arrow") {
    return {
      ...base,
      kind: "line",
      size: drawnSize ?? { width: 160, height: 0 },
      properties: {
        fills: [],
        strokes: [{ type: "solid", color: "#151515", opacity: 1 }],
        strokeWidth: 2,
        strokeAlign: "center",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [],
        start: lineEndpoints?.start ?? { x: 0, y: 0.5 },
        end: lineEndpoints?.end ?? { x: 1, y: 0.5 },
        startEndpoint: "none",
        endEndpoint: tool === "arrow" ? "line-arrow" : "none",
      },
    };
  }
  if (tool === "polygon") {
    return {
      ...base,
      kind: "polygon",
      size: drawnSize ?? { width: 120, height: 120 },
      properties: {
        ...shape,
        pointCount: 3,
        cornerRadius: 0,
      },
    };
  }
  if (tool === "star") {
    return {
      ...base,
      kind: "star",
      size: drawnSize ?? { width: 120, height: 120 },
      properties: {
        ...shape,
        pointCount: 5,
        innerRadius: 0.382,
        cornerRadius: 0,
      },
    };
  }
  if (tool === "text") {
    const layout = drawnSize
      ? ({
          textResize: "fixed",
          textWrap: "word",
          textOverflow: "clip",
        } as const)
      : ({
          textResize: "auto-width",
          textWrap: "none",
          textOverflow: "visible",
        } as const);
    return {
      ...base,
      kind: "text",
      size: drawnSize ?? { width: 240, height: 48 },
      properties: {
        content: t("canvas.newText"),
        fontFamily: "Inter",
        fontStyleName: "Semi Bold",
        fontSize: 24,
        fontWeight: 600,
        fontSlant: "normal",
        lineHeight: 32,
        letterSpacing: 0,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        listSpacing: 0,
        hangingList: false,
        textCase: "original",
        textDecoration: "none",
        textAlignHorizontal: "left",
        textAlignVertical: "top",
        ...layout,
        textTruncation: "disabled",
        maxLines: null,
        fills: [{ type: "solid", color: "#151515", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
    };
  }
  return {
    ...base,
    kind: "rectangle",
    size: drawnSize ?? { width: 160, height: 112 },
    properties: { ...shape, cornerRadius: 12 },
  };
}

function sameViewport(left: ViewportState, right: ViewportState) {
  return (
    Math.abs(left.panX - right.panX) < 0.000_001 &&
    Math.abs(left.panY - right.panY) < 0.000_001 &&
    Math.abs(left.zoom - right.zoom) < 0.000_001 &&
    Math.abs(left.width - right.width) < 0.000_001 &&
    Math.abs(left.height - right.height) < 0.000_001
  );
}

function sameFidelityWarnings(
  left: readonly LeaferFidelityWarning[],
  right: readonly LeaferFidelityWarning[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (warning, index) =>
        warning.code === right[index]?.code &&
        warning.message === right[index]?.message &&
        warning.nodeId === right[index]?.nodeId,
    )
  );
}
