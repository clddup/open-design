import type {
  DesignChangeSet,
  DesignNode,
  EllipseNode,
  FrameNode,
  RectangleNode,
  TextNode,
  ViewportState,
} from "@opendesign/design-contracts";
import type { EditorRuntime, EditorSnapshot } from "@opendesign/editor-runtime";
import {
  createLeaferEngineAdapter,
  type LeaferCreateRequest,
  type LeaferEngineAdapter,
  type LeaferEngineSyncInput,
  type LeaferOperationKind,
  type LeaferOperationRequest,
} from "@opendesign/leafer-engine";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageKey, MessageParameters } from "../../shared/i18n/messages";
import { useI18n } from "../i18n";
import { isTool, type Tool } from "../state/editor";

export function Canvas({
  activePageId,
  runtime,
  snapshot,
  onTransactionError,
}: {
  activePageId: string;
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
  const tool = isTool(snapshot.state.tool) ? snapshot.state.tool : "select";

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
    snapshot.document,
    snapshot.state.selection,
    snapshot.state.viewport,
    tool,
  ]);

  return (
    <main
      aria-label={t("canvas.label")}
      className="canvas-area canvas-area--leafer"
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
    </main>
  );
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
  t: (key: MessageKey, parameters?: MessageParameters) => string,
): FrameNode | RectangleNode | EllipseNode | TextNode {
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
