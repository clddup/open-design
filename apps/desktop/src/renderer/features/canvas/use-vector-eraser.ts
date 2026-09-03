import {
  planVectorLayersErase,
  type EditorRuntime,
  type VectorEraserOperationPlan,
} from "@opendesign/editor-runtime";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import type {
  LeaferOperationRequest,
  LeaferVectorEraseRequest,
  LeaferVectorEraseResponse,
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

interface VectorEraserCommitOptions {
  activePageId: string;
  applyOperations: (request: LeaferOperationRequest) => boolean;
  messages: { applyMissing: string; stale: string; unavailable: string };
  onTransactionError: (message: string | null) => void;
  runtime: EditorRuntime;
  setVectorEditState: Dispatch<SetStateAction<CanvasVectorEditState | null>>;
  vectorEditStateRef: MutableRefObject<CanvasVectorEditState | null>;
}

type VectorEraserCommitContext = Omit<
  VectorEraserCommitOptions,
  "activePageId" | "messages"
> & {
  currentPageId: () => string;
  messages: VectorEraserCommitOptions["messages"];
};

export function useVectorEraserCommit({
  activePageId,
  applyOperations,
  messages,
  onTransactionError,
  runtime,
  setVectorEditState,
  vectorEditStateRef,
}: VectorEraserCommitOptions): (
  request: LeaferVectorEraseRequest,
) => Promise<LeaferVectorEraseResponse> {
  const activePageIdRef = useRef(activePageId);
  activePageIdRef.current = activePageId;
  const { applyMissing, stale, unavailable } = messages;

  return useCallback(
    (request) =>
      commitVectorErase(request, {
        applyOperations,
        currentPageId: () => activePageIdRef.current,
        messages: { applyMissing, stale, unavailable },
        onTransactionError,
        runtime,
        setVectorEditState,
        vectorEditStateRef,
      }),
    [
      applyOperations,
      applyMissing,
      onTransactionError,
      runtime,
      setVectorEditState,
      stale,
      unavailable,
      vectorEditStateRef,
    ],
  );
}

async function commitVectorErase(
  request: LeaferVectorEraseRequest,
  context: VectorEraserCommitContext,
): Promise<LeaferVectorEraseResponse> {
  if (!matchesCurrentDocument(request, context)) {
    return staleFailure(context.messages.stale, context.onTransactionError);
  }
  try {
    const provider = await loadVectorGeometryProvider();
    if (!matchesCurrentDocument(request, context)) {
      return staleFailure(context.messages.stale, context.onTransactionError);
    }
    const plan = createErasePlan(request, context.runtime, provider);
    if (!plan.ok) {
      if (plan.code === "no-op") return unchangedResponse(request.nodeIds);
      context.onTransactionError(plan.message);
      return { ok: false };
    }
    if (
      !context.applyOperations({
        kind: "vector",
        operations: [...plan.operations],
      }) ||
      !updateVectorEditState(context, plan.eraserResult)
    ) {
      return { ok: false };
    }
    return { ok: true, ...plan.eraserResult };
  } catch (error) {
    context.onTransactionError(
      error instanceof Error ? error.message : context.messages.unavailable,
    );
    return { ok: false };
  }
}

function matchesCurrentDocument(
  request: LeaferVectorEraseRequest,
  context: VectorEraserCommitContext,
): boolean {
  const current = context.runtime.getSnapshot().document;
  return (
    request.documentId === current.documentId &&
    request.pageId === context.currentPageId() &&
    request.expectedRevision === current.revision
  );
}

function createErasePlan(
  request: LeaferVectorEraseRequest,
  runtime: EditorRuntime,
  provider: VectorGeometryProvider,
): VectorEraserOperationPlan {
  return planVectorLayersErase(
    runtime.getSnapshot().document,
    request.pageId,
    request.nodeIds.map((nodeId, index) => ({
      geometryIdPrefix: eraserGeometryPrefix(index),
      nodeId,
    })),
    request.points,
    request.weight,
    request.shape,
    provider,
  );
}

async function loadVectorGeometryProvider(): Promise<VectorGeometryProvider> {
  const { loadBrowserVectorGeometryProvider } =
    await import("@opendesign/geometry-service/browser-vector-path");
  return loadBrowserVectorGeometryProvider();
}

function updateVectorEditState(
  options: Omit<VectorEraserCommitOptions, "activePageId" | "applyOperations">,
  result: {
    deletedNodeIds: readonly string[];
    remainingNodeIds: readonly string[];
  },
): boolean {
  const remainingNodeIds = result.remainingNodeIds.filter(
    (nodeId) => options.runtime.getSnapshot().document.nodesById[nodeId],
  );
  if (remainingNodeIds.length !== result.remainingNodeIds.length) {
    options.onTransactionError(options.messages.applyMissing);
    return false;
  }
  const currentState = options.vectorEditStateRef.current;
  if (remainingNodeIds.length === 0) {
    options.vectorEditStateRef.current = null;
    options.setVectorEditState(null);
    options.runtime.setSelection([]);
  } else if (currentState) {
    const activeNodeId = remainingNodeIds.includes(currentState.activeNodeId)
      ? currentState.activeNodeId
      : remainingNodeIds.at(-1)!;
    const nextState = resetVectorPointSelection(
      currentState,
      remainingNodeIds,
      activeNodeId,
    );
    options.vectorEditStateRef.current = nextState;
    options.setVectorEditState(nextState);
    options.runtime.setSelection(remainingNodeIds, activeNodeId);
  }
  return true;
}

function staleFailure(
  message: string,
  onTransactionError: (message: string | null) => void,
): LeaferVectorEraseResponse {
  onTransactionError(message);
  return { ok: false };
}

function unchangedResponse(
  nodeIds: readonly string[],
): LeaferVectorEraseResponse {
  return { ok: true, deletedNodeIds: [], remainingNodeIds: [...nodeIds] };
}

function eraserGeometryPrefix(index: number): string {
  return `eraser_${index}_${crypto.randomUUID().replaceAll("-", "")}`;
}
