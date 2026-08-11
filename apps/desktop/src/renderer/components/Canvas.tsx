import type {
  DesignChangeSet,
  DesignNode,
  EllipseNode,
  FrameNode,
  LineNode,
  PolygonNode,
  RectangleNode,
  StarNode,
  TextNode,
  ViewportState,
} from "@opendesign/design-contracts";
import type { EditorRuntime, EditorSnapshot } from "@opendesign/editor-runtime";
import {
  navigateBooleanSelection,
  resolveBooleanEditScope,
} from "@opendesign/editor-runtime";
import {
  createLeaferEngineAdapter,
  type LeaferCreateRequest,
  type LeaferEngineAdapter,
  type LeaferEngineSyncInput,
  type LeaferFidelityWarning,
  type LeaferOperationKind,
  type LeaferOperationRequest,
} from "@opendesign/leafer-engine";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { MutableRefObject } from "react";
import type { MessageKey, MessageParameters } from "../../shared/i18n/messages";
import { useI18n } from "../i18n";
import { isTool, type Tool } from "../state/editor";

export function Canvas({
  activePageId,
  captureRef,
  runtime,
  snapshot,
  onTransactionError,
}: {
  activePageId: string;
  captureRef?: MutableRefObject<CanvasPreviewCapture | null>;
  runtime: EditorRuntime;
  snapshot: EditorSnapshot;
  onTransactionError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLElement>(null);
  const adapter = useRef<LeaferEngineAdapter | null>(null);
  const latestInput = useRef<LeaferEngineSyncInput | null>(null);
  const changesByRevision = useRef(new Map<number, DesignChangeSet>());
  const transactionSequence = useRef(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [fidelityWarnings, setFidelityWarnings] = useState<
    readonly LeaferFidelityWarning[]
  >([]);
  const tool = isTool(snapshot.state.tool) ? snapshot.state.tool : "select";
  const booleanEditScope = useMemo(
    () =>
      resolveBooleanEditScope(
        snapshot.document,
        activePageId,
        snapshot.state.selection.nodeIds,
      ),
    [activePageId, snapshot.document, snapshot.state.selection.nodeIds],
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

  const handleCanvasKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      const currentSelection = runtime.getSnapshot().state.selection.nodeIds;
      const direction =
        event.key === "Enter"
          ? event.shiftKey
            ? "exit"
            : "enter"
          : event.key === "Escape"
            ? "exit"
            : event.key === "Tab"
              ? event.shiftKey
                ? "previous-operand"
                : "next-operand"
              : null;
      if (!direction || !selectBooleanTarget(currentSelection, direction)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [runtime, selectBooleanTarget],
  );

  const handleCanvasDoubleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".canvas-context-stack")
      ) {
        return;
      }
      const currentSelection = runtime.getSnapshot().state.selection.nodeIds;
      if (!selectBooleanTarget(currentSelection, "enter")) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [runtime, selectBooleanTarget],
  );

  useEffect(() => {
    const element = host.current;
    if (!captureRef || !element) return;
    const capture = () => captureCanvasPreview(element);
    captureRef.current = capture;
    return () => {
      if (captureRef.current === capture) captureRef.current = null;
    };
  }, [captureRef]);

  const applyOperations = useCallback(
    (request: LeaferOperationRequest) => {
      const current = runtime.getSnapshot();
      const result = runtime.apply({
        transactionId: `canvas_${Date.now()}_${++transactionSequence.current}`,
        documentId: current.document.documentId,
        baseRevision: current.document.revision,
        actor: { type: "user", id: "local-user" },
        label: operationLabel(request.kind, request.operations.length, t),
        commands: request.operations,
      });
      if (!result.ok) {
        onTransactionError(result.error.message);
        return false;
      }
      onTransactionError(null);
      return true;
    },
    [onTransactionError, runtime, t],
  );

  const createNode = useCallback(
    (request: LeaferCreateRequest) => {
      const current = runtime.getSnapshot();
      const parent = request.parentId
        ? current.document.nodesById[request.parentId]
        : undefined;
      if (
        request.parentId &&
        (!parent || (parent.kind !== "frame" && parent.kind !== "group"))
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
    return runtime.subscribe((event) => {
      if (event.type !== "document.changed") return;
      changesByRevision.current.set(
        event.result.changes.toRevision,
        event.result.changes,
      );
      if (changesByRevision.current.size <= 8) return;
      const oldest = [...changesByRevision.current.keys()].sort(
        (left, right) => left - right,
      )[0];
      if (oldest !== undefined) changesByRevision.current.delete(oldest);
    });
  }, [runtime]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    setRenderError(null);

    void createLeaferEngineAdapter(element, {
      onCreate: createNode,
      onError: (error) => {
        if (!disposed)
          setRenderError(error.message || t("canvas.renderFailed"));
      },
      onOperations: applyOperations,
      onSelectionChange: (nodeIds, anchorNodeId) => {
        runtime.setSelection(nodeIds, anchorNodeId);
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
    };
  }, [applyOperations, createNode, runtime, t, updateViewport]);

  useEffect(() => {
    const changes = changesByRevision.current.get(snapshot.document.revision);
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
      pageId: activePageId,
      selection: snapshot.state.selection,
      tool,
      viewport: snapshot.state.viewport,
    };
    latestInput.current = input;
    adapter.current?.sync(input);
  }, [
    activePageId,
    booleanEditScope,
    snapshot.document,
    snapshot.state.selection,
    snapshot.state.viewport,
    tool,
  ]);

  const seriousBooleanWarnings = fidelityWarnings.filter(
    (warning) =>
      warning.code === "boolean-geometry-failed" ||
      warning.code === "boolean-geometry-provider-failed" ||
      warning.code === "boolean-geometry-unsupported",
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
  const editScopeBoolean = booleanEditScope
    ? snapshot.document.nodesById[booleanEditScope.booleanId]
    : undefined;

  return (
    <main
      aria-label={t("canvas.label")}
      className="canvas-area canvas-area--leafer"
      onDoubleClick={handleCanvasDoubleClick}
      onKeyDown={handleCanvasKeyDown}
      onPointerDown={() => host.current?.focus()}
      ref={host}
      tabIndex={0}
    >
      {renderError && (
        <div className="canvas-status" role="alert">
          <span className="canvas-status__mark" />
          <strong>{t("canvas.unavailable")}</strong>
          <small>{renderError}</small>
        </div>
      )}
      {(booleanEditScope || activeWarning) && (
        <div className="canvas-context-stack">
          {booleanEditScope && editScopeBoolean?.kind === "boolean" && (
            <div className="canvas-edit-scope" role="status">
              <span className="canvas-edit-scope__mark" />
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
            <div className="canvas-fidelity-warning" role="alert">
              <span className="canvas-fidelity-warning__mark">!</span>
              <span>
                <strong>{t("canvas.booleanRenderWarning")}</strong>
                <small>{activeWarning.message}</small>
              </span>
              <span className="canvas-fidelity-warning__actions">
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

export type CanvasPreviewCapture = () => Promise<{
  bytes: Uint8Array;
  height: number;
  mimeType: "image/jpeg";
  width: number;
}>;

const MAX_CAPTURE_WIDTH = 1_280;
const MAX_CAPTURE_HEIGHT = 960;

async function captureCanvasPreview(host: HTMLElement) {
  const canvases = [...host.querySelectorAll("canvas")].filter(
    (canvas) => canvas.width > 0 && canvas.height > 0,
  );
  const source = canvases[0];
  if (!source) throw new Error("Canvas preview is not ready");
  const scale = Math.min(
    1,
    MAX_CAPTURE_WIDTH / source.width,
    MAX_CAPTURE_HEIGHT / source.height,
  );
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas preview encoder is unavailable");
  const background = getComputedStyle(host).backgroundColor;
  context.fillStyle =
    background && background !== "rgba(0, 0, 0, 0)" ? background : "#d9d9d7";
  context.fillRect(0, 0, width, height);
  for (const canvas of canvases) {
    if (canvas.width !== source.width || canvas.height !== source.height) {
      continue;
    }
    context.drawImage(canvas, 0, 0, width, height);
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    output.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Canvas preview failed")),
      "image/jpeg",
      0.88,
    );
  });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    height,
    mimeType: "image/jpeg" as const,
    width,
  };
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
    case "transform":
      return t("canvas.transformLayers");
  }
}

function createDesignNode(
  tool: Exclude<Tool, "select">,
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
    return {
      ...base,
      kind: "text",
      size: drawnSize ?? { width: 240, height: 48 },
      properties: {
        content: t("canvas.newText"),
        fontFamily: "Inter",
        fontSize: 24,
        fontWeight: 600,
        lineHeight: 32,
        letterSpacing: 0,
        textAlignHorizontal: "left",
        textAlignVertical: "top",
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
