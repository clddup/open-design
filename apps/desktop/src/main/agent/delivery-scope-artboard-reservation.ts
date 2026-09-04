import {
  DESIGN_DELIVERY_LEDGER_VERSION,
  type DesignDeliveryLedger,
} from "@opendesign/workspace-contracts";
import type { DesignDeliveryScope } from "@/shared/design-agent-tools.js";
import type { InspectedHierarchy } from "./design-plan-registration.js";

export type DeliveryScopeArtboardReservation = {
  targetId: string;
  label: string;
  pageId: string;
  frameId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DeliveryScopeReservation = {
  artboards: DeliveryScopeArtboardReservation[];
};

export function createScopeArtboardReservation(
  scope: DesignDeliveryScope,
  pageId: string,
  inspection: InspectedHierarchy,
): DeliveryScopeReservation {
  return { artboards: reserveArtboards(scope, pageId, inspection) };
}

export function nextArtboardOrigin(
  pageId: string,
  inspection: InspectedHierarchy,
): { x: number; y: number } {
  const existingBounds = [
    ...(inspection.pageRootsById.get(pageId) ?? []),
  ].flatMap((rootId) => {
    const root = inspection.nodesById.get(rootId);
    return root ? [worldBounds(root)] : [];
  });
  if (existingBounds.length === 0) return { x: 0, y: 0 };
  return {
    x:
      Math.max(...existingBounds.map((bounds) => bounds.x + bounds.width)) +
      160,
    y: Math.min(...existingBounds.map((bounds) => bounds.y)),
  };
}

export function finalizeScopeReservation(
  scope: DesignDeliveryScope,
  reservation: DeliveryScopeReservation,
): DeliveryScopeArtboardReservation[] {
  if (reservation.artboards.length !== scope.targets.length) {
    throw new TypeError(
      "Delivery scope reservation must contain every recorded target exactly once",
    );
  }
  return reservation.artboards.map((artboard, index) => {
    if (scope.targets[index]?.targetId !== artboard.targetId) {
      throw new TypeError(
        "Delivery scope reservation order must match the recorded target order",
      );
    }
    return structuredClone(artboard);
  });
}

export function scopeReservationLedger(
  artboards: readonly DeliveryScopeArtboardReservation[],
): DesignDeliveryLedger {
  return {
    version: DESIGN_DELIVERY_LEDGER_VERSION,
    targets: artboards.map((artboard) => ({
      targetId: artboard.targetId,
      label: artboard.label,
      pageId: artboard.pageId,
      rootNodeId: artboard.frameId,
      reservedNodeIds: [artboard.frameId],
      status: "pending" as const,
    })),
    activeTargetId: artboards[0]?.targetId ?? null,
  };
}

function reserveArtboards(
  scope: DesignDeliveryScope,
  pageId: string,
  inspection: InspectedHierarchy,
): DeliveryScopeArtboardReservation[] {
  const gap = 160;
  const columns = Math.min(4, Math.ceil(Math.sqrt(scope.targets.length)));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from(
    { length: Math.ceil(scope.targets.length / columns) },
    () => 0,
  );
  scope.targets.forEach((target, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(
      columnWidths[column] ?? 0,
      target.artboard.width,
    );
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, target.artboard.height);
  });
  const origin = nextArtboardOrigin(pageId, inspection);
  const columnOffsets = cumulativeOffsets(columnWidths, gap);
  const rowOffsets = cumulativeOffsets(rowHeights, gap);
  return scope.targets.map((target, index) => ({
    targetId: target.targetId,
    label: target.label,
    pageId,
    frameId: `${inspection.newNodeIdPrefix ?? ""}scope_${index + 1}`,
    x: origin.x + (columnOffsets[index % columns] ?? 0),
    y: origin.y + (rowOffsets[Math.floor(index / columns)] ?? 0),
    width: target.artboard.width,
    height: target.artboard.height,
  }));
}

function cumulativeOffsets(values: readonly number[], gap: number): number[] {
  const result: number[] = [];
  let offset = 0;
  for (const value of values) {
    result.push(offset);
    offset += value + gap;
  }
  return result;
}

function worldBounds(
  node: InspectedHierarchy["nodesById"] extends Map<string, infer T>
    ? T
    : never,
): { x: number; y: number; width: number; height: number } {
  const [a, b, c, d, tx, ty] = node.transform;
  const points = [
    [0, 0],
    [node.size.width, 0],
    [0, node.size.height],
    [node.size.width, node.size.height],
  ].map(([x, y]) => ({ x: a * x + c * y + tx, y: b * x + d * y + ty }));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
