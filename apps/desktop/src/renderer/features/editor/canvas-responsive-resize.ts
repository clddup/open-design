import type { DesignDocument, Size } from "@opendesign/design-contracts";
import type { LeaferOperationRequest } from "@opendesign/leafer-engine";

export type ResizeFrameHandler = (frameId: string, size: Size) => boolean;

export function responsiveFrameResizeRequest(
  document: DesignDocument,
  request: LeaferOperationRequest,
): { frameId: string; size: Size } | null {
  const selected = request.selectionNodeIds ?? [];
  if (request.kind !== "resize" || selected.length !== 1) return null;
  const frameId = selected[0];
  const frame = frameId ? document.nodesById[frameId] : undefined;
  if (frame?.kind !== "frame" || frame.childIds.length === 0) return null;
  const update = request.operations.find(
    (operation) =>
      operation.type === "update_properties" &&
      operation.nodeId === frameId &&
      operation.size !== undefined,
  );
  return update?.type === "update_properties" && update.size
    ? { frameId, size: update.size }
    : null;
}
