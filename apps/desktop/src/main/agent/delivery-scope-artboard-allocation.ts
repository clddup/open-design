import type { Transform } from "@opendesign/design-contracts";
import {
  DESIGN_DELIVERY_LEDGER_VERSION,
  type DesignDeliveryLedger,
} from "@opendesign/workspace-contracts";
import type {
  DesignApplyToolInput,
  DesignDeliveryScope,
  DesignFirstSliceToolInput,
} from "@/shared/design-agent-tools.js";
import type { InspectedHierarchy } from "./design-plan-registration.js";

export type DeliveryScopeArtboardAllocation = {
  targetId: string;
  label: string;
  pageId: string;
  frameId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  allocatedRevision?: number;
};

export type DeliveryScopeAllocation = {
  artboards: DeliveryScopeArtboardAllocation[];
  input: DesignApplyToolInput;
};

export function createScopeArtboardAllocation(
  scope: DesignDeliveryScope,
  pageId: string,
  inspection: InspectedHierarchy,
): DeliveryScopeAllocation {
  const artboards = allocateArtboards(scope, pageId, inspection);
  const rootCount = inspection.pageRootsById.get(pageId)?.size ?? 0;
  return {
    artboards,
    input: {
      label:
        artboards.length === 1
          ? `Allocate ${artboards[0]?.label ?? "delivery"} artboard`
          : `Allocate ${artboards.length} confirmed artboards`,
      summary:
        "Create every recorded delivery root as a real editable Frame before detailed rolling plans begin",
      commands: artboards.map((artboard, index) => ({
        commandId: `allocate_scope_${index + 1}`,
        type: "insert_element" as const,
        pageId: artboard.pageId,
        parentId: null,
        index: rootCount + index,
        node: {
          id: artboard.frameId,
          kind: "frame" as const,
          name: artboard.label,
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, artboard.x, artboard.y] as Transform,
          size: { width: artboard.width, height: artboard.height },
          exportSettings: [],
          opacity: 1,
          properties: {
            fills: [{ type: "solid" as const, color: "#ffffff", opacity: 1 }],
            strokes: [],
            strokeWidth: 0,
            cornerRadius: 0,
            clipsContent: true,
          },
          extensions: { agentTargetId: artboard.targetId },
        },
      })),
    },
  };
}

export function bindFirstSliceToScopeAllocation(
  scope: DesignDeliveryScope | undefined,
  allocations: ReadonlyMap<string, DeliveryScopeArtboardAllocation> | undefined,
  input: DesignFirstSliceToolInput,
): DesignFirstSliceToolInput {
  const target = scope?.targets.find(
    (candidate) => candidate.targetId === input.targets[0]?.targetId,
  );
  const allocation = target ? allocations?.get(target.targetId) : undefined;
  if (!target || !allocation) return input;
  const bound = structuredClone(input);
  const boundTarget = bound.targets[0];
  if (!boundTarget) return input;
  const submittedFrameId = boundTarget.frame.frameId;
  boundTarget.pageId = allocation.pageId;
  boundTarget.frame = {
    frameId: allocation.frameId,
    x: allocation.x,
    y: allocation.y,
    width: allocation.width,
    height: allocation.height,
  };
  for (const region of boundTarget.regions) {
    if (region.parentId === submittedFrameId) {
      region.parentId = allocation.frameId;
    }
  }
  return bound;
}

export function finalizeScopeAllocation(
  scope: DesignDeliveryScope,
  allocation: DeliveryScopeAllocation,
  revision: number,
): DeliveryScopeArtboardAllocation[] {
  if (allocation.artboards.length !== scope.targets.length) {
    throw new TypeError(
      "Delivery scope allocation must contain every recorded target exactly once",
    );
  }
  return allocation.artboards.map((artboard, index) => {
    if (scope.targets[index]?.targetId !== artboard.targetId) {
      throw new TypeError(
        "Delivery scope allocation order must match the recorded target order",
      );
    }
    return { ...structuredClone(artboard), allocatedRevision: revision };
  });
}

export function projectScopeAllocationIntoInspection(
  inspection: InspectedHierarchy | undefined,
  artboards: readonly DeliveryScopeArtboardAllocation[],
  revision: number,
): void {
  if (!inspection) return;
  inspection.revision = revision;
  for (const artboard of artboards) {
    inspection.nodesById.set(artboard.frameId, {
      childIds: [],
      componentId: null,
      id: artboard.frameId,
      kind: "frame",
      locked: false,
      parentId: null,
      size: { width: artboard.width, height: artboard.height },
      transform: [1, 0, 0, 1, artboard.x, artboard.y],
    });
    inspection.pageRootsById.get(artboard.pageId)?.add(artboard.frameId);
  }
}

export function scopeAllocationLedger(
  artboards: readonly DeliveryScopeArtboardAllocation[],
  revision: number,
): DesignDeliveryLedger {
  return {
    version: DESIGN_DELIVERY_LEDGER_VERSION,
    targets: artboards.map((artboard) => ({
      targetId: artboard.targetId,
      label: artboard.label,
      pageId: artboard.pageId,
      rootNodeId: artboard.frameId,
      reservedNodeIds: [artboard.frameId],
      status: "allocated" as const,
      allocatedRevision: revision,
    })),
    activeTargetId: artboards[0]?.targetId ?? null,
  };
}

function allocateArtboards(
  scope: DesignDeliveryScope,
  pageId: string,
  inspection: InspectedHierarchy,
): DeliveryScopeArtboardAllocation[] {
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
  const existingBounds = [
    ...(inspection.pageRootsById.get(pageId) ?? []),
  ].flatMap((rootId) => {
    const root = inspection.nodesById.get(rootId);
    return root ? [worldBounds(root)] : [];
  });
  const baseX =
    existingBounds.length === 0
      ? 0
      : Math.max(...existingBounds.map((bounds) => bounds.x + bounds.width)) +
        gap;
  const baseY =
    existingBounds.length === 0
      ? 0
      : Math.min(...existingBounds.map((bounds) => bounds.y));
  const columnOffsets = cumulativeOffsets(columnWidths, gap);
  const rowOffsets = cumulativeOffsets(rowHeights, gap);
  return scope.targets.map((target, index) => ({
    targetId: target.targetId,
    label: target.label,
    pageId,
    frameId: `${inspection.newNodeIdPrefix ?? ""}scope_${index + 1}`,
    x: baseX + (columnOffsets[index % columns] ?? 0),
    y: baseY + (rowOffsets[Math.floor(index / columns)] ?? 0),
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
