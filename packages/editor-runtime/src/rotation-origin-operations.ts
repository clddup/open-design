import type {
  DesignDocument,
  DesignOperation,
  RelativePoint,
} from "@opendesign/design-contracts";
import { isEffectivelyLocked, nodeBelongsToPage } from "./layer-operations.js";

export type RotationOriginOperationFailureCode =
  "invalid-target" | "locked" | "no-op" | "not-found";

export type RotationOriginOperationPlan =
  | { ok: true; commands: DesignOperation[]; nodeId: string }
  | { ok: false; code: RotationOriginOperationFailureCode; message: string };

export function planSetNodeRotationOrigin(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
  origin: RelativePoint | null,
  commandPrefix: string,
): RotationOriginOperationPlan {
  if (!document.pagesById[pageId]) {
    return failure("not-found", `Page ${pageId} does not exist`);
  }
  const node = document.nodesById[nodeId];
  if (!node) return failure("not-found", `Layer ${nodeId} does not exist`);
  if (!nodeBelongsToPage(document, pageId, nodeId)) {
    return failure(
      "invalid-target",
      `Layer ${nodeId} does not belong to Page ${pageId}`,
    );
  }
  if (isEffectivelyLocked(document, nodeId)) {
    return failure("locked", "Locked layers cannot change rotation origin");
  }
  const next = isDefaultOrigin(origin) ? null : origin;
  if (sameOrigin(node.rotationOrigin, next)) {
    return failure("no-op", "Layer already uses this rotation origin");
  }
  return {
    ok: true,
    nodeId,
    commands: [
      {
        commandId: `${commandPrefix}_set_rotation_origin`,
        type: "update_properties",
        nodeId,
        rotationOrigin: next,
      },
    ],
  };
}

function isDefaultOrigin(origin: RelativePoint | null): boolean {
  return origin === null || (origin.x === 0.5 && origin.y === 0.5);
}

function sameOrigin(
  current: RelativePoint | undefined,
  next: RelativePoint | null,
): boolean {
  if (!current && next === null) return true;
  return current?.x === next?.x && current?.y === next?.y;
}

function failure(
  code: RotationOriginOperationFailureCode,
  message: string,
): Extract<RotationOriginOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
