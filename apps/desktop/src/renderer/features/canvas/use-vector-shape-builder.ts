import {
  planVectorShapeBuilderEdit,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import type {
  LeaferOperationRequest,
  LeaferVectorShapeBuildRequest,
  LeaferVectorShapeBuildResponse,
} from "@opendesign/leafer-engine";
import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  resetVectorPointSelection,
  type CanvasVectorEditState,
} from "./vector-edit-state";

interface VectorShapeBuilderOptions {
  activePageId: string;
  applyOperations: (request: LeaferOperationRequest) => boolean;
  messages: { applyMissing: string; stale: string; unavailable: string };
  onTransactionError: (message: string | null) => void;
  runtime: EditorRuntime;
  setVectorEditState: Dispatch<SetStateAction<CanvasVectorEditState | null>>;
  vectorEditStateRef: MutableRefObject<CanvasVectorEditState | null>;
}

type CommitContext = Omit<VectorShapeBuilderOptions, "activePageId"> & {
  currentPageId: () => string;
};

export function useVectorShapeBuilder({
  activePageId,
  applyOperations,
  messages,
  onTransactionError,
  runtime,
  setVectorEditState,
  vectorEditStateRef,
}: VectorShapeBuilderOptions): (
  request: LeaferVectorShapeBuildRequest,
) => Promise<LeaferVectorShapeBuildResponse> {
  const activePageIdRef = useRef(activePageId);
  activePageIdRef.current = activePageId;
  const { applyMissing, stale, unavailable } = messages;
  return useCallback(
    (request) =>
      commitShapeBuilder(request, {
        applyOperations,
        currentPageId: () => activePageIdRef.current,
        messages: { applyMissing, stale, unavailable },
        onTransactionError,
        runtime,
        setVectorEditState,
        vectorEditStateRef,
      }),
    [
      applyMissing,
      applyOperations,
      onTransactionError,
      runtime,
      setVectorEditState,
      stale,
      unavailable,
      vectorEditStateRef,
    ],
  );
}

async function commitShapeBuilder(
  request: LeaferVectorShapeBuildRequest,
  context: CommitContext,
): Promise<LeaferVectorShapeBuildResponse> {
  if (!matchesCurrentDocument(request, context)) {
    context.onTransactionError(context.messages.stale);
    return { ok: false };
  }
  try {
    const provider = await loadVectorGeometryProvider();
    if (!matchesCurrentDocument(request, context)) {
      context.onTransactionError(context.messages.stale);
      return { ok: false };
    }
    const plan = createPlan(request, context.runtime, provider);
    if (!plan.ok) {
      if (plan.code === "no-op") return { ok: true, nodeIds: request.nodeIds };
      context.onTransactionError(plan.message);
      return { ok: false };
    }
    const nodeIds = plan.shapeBuilderResult.selectionNodeIds;
    if (
      !context.applyOperations({
        kind: "vector",
        operations: [...plan.operations],
        selectionNodeIds: [...nodeIds],
      }) ||
      !updateVectorEditState(context, nodeIds)
    ) {
      return { ok: false };
    }
    return { ok: true, nodeIds };
  } catch (error) {
    context.onTransactionError(
      error instanceof Error ? error.message : context.messages.unavailable,
    );
    return { ok: false };
  }
}

function matchesCurrentDocument(
  request: LeaferVectorShapeBuildRequest,
  context: CommitContext,
): boolean {
  const document = context.runtime.getSnapshot().document;
  return (
    request.documentId === document.documentId &&
    request.pageId === context.currentPageId() &&
    request.expectedRevision === document.revision
  );
}

function createPlan(
  request: LeaferVectorShapeBuildRequest,
  runtime: EditorRuntime,
  provider: VectorGeometryProvider,
) {
  const token = crypto.randomUUID().replaceAll("-", "");
  return planVectorShapeBuilderEdit(
    runtime.getSnapshot().document,
    request.pageId,
    {
      action: request.mode,
      baseRevision: request.expectedRevision,
      geometryIdPrefix: `shape_builder_${token}`,
      nodeIds: request.nodeIds,
      points: request.points,
      ...(request.mode === "subtract"
        ? {}
        : { resultNodeId: `shape_builder_result_${token}` }),
    },
    provider,
  );
}

async function loadVectorGeometryProvider(): Promise<VectorGeometryProvider> {
  const { loadBrowserVectorGeometryProvider } =
    await import("@opendesign/geometry-service/browser-vector-path");
  return loadBrowserVectorGeometryProvider();
}

function updateVectorEditState(
  context: CommitContext,
  nodeIds: readonly string[],
): boolean {
  const document = context.runtime.getSnapshot().document;
  if (nodeIds.some((nodeId) => !document.nodesById[nodeId])) {
    context.onTransactionError(context.messages.applyMissing);
    return false;
  }
  const current = context.vectorEditStateRef.current;
  if (nodeIds.length === 0) {
    context.vectorEditStateRef.current = null;
    context.setVectorEditState(null);
    context.runtime.setSelection([]);
  } else if (current) {
    const next = resetVectorPointSelection(current, nodeIds, nodeIds.at(-1)!);
    context.vectorEditStateRef.current = next;
    context.setVectorEditState(next);
    context.runtime.setSelection(nodeIds, next.activeNodeId);
  }
  return true;
}
