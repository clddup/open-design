import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { LeaferOperationRequest } from "@opendesign/leafer-engine";
import {
  responsiveFrameResizeRequest,
  type ResizeFrameHandler,
} from "./canvas-responsive-resize";

export function commitCanvasOperation({
  label,
  onResizeFrame,
  onTransactionError,
  request,
  runtime,
  transactionId,
}: {
  label: string;
  onResizeFrame: ResizeFrameHandler;
  onTransactionError: (message: string | null) => void;
  request: LeaferOperationRequest;
  runtime: EditorRuntime;
  transactionId: string;
}): boolean {
  const current = runtime.getSnapshot();
  const responsive = responsiveFrameResizeRequest(current.document, request);
  if (responsive) return onResizeFrame(responsive.frameId, responsive.size);
  const flowChild = request.operations.find((operation) => {
    if (
      operation.type !== "update_properties" ||
      (operation.transform === undefined && operation.size === undefined)
    ) {
      return false;
    }
    const node = current.document.nodesById[operation.nodeId];
    const parent = node?.parentId
      ? current.document.nodesById[node.parentId]
      : undefined;
    return (
      parent?.kind === "frame" &&
      parent.properties.autoLayout !== undefined &&
      parent.properties.autoLayout.mode !== "none" &&
      node?.layoutPositioning !== "absolute"
    );
  });
  if (flowChild?.type === "update_properties") {
    onTransactionError(
      `Layer ${flowChild.nodeId} participates in Auto Layout. Reorder it in Layers or edit the parent layout settings.`,
    );
    return false;
  }
  const result = runtime.apply({
    transactionId,
    documentId: current.document.documentId,
    baseRevision: current.document.revision,
    actor: { type: "user", id: "local-user" },
    label,
    commands: request.operations,
  });
  onTransactionError(result.ok ? null : result.error.message);
  return result.ok;
}
