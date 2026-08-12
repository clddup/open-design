import type {
  DesignDeliveryLedger,
  DesignDeliveryTarget,
} from "@opendesign/workspace-contracts";
import {
  designPlanTargets,
  type DesignPlanTarget,
  type DesignPlanToolInput,
  type DesignVisualReviewToolInput,
} from "../../shared/design-agent-tools.js";

export type InspectedHierarchy = {
  documentId: string;
  nodesById: Map<
    string,
    {
      childIds: string[];
      id: string;
      kind: string;
      locked: boolean;
      parentId: string | null;
    }
  >;
  pageRootsById: Map<string, Set<string>>;
  revision: number;
};

export type DesignDeliveryTargetState = {
  artboardDescendantIds: Set<string>;
  artboardEstablished: boolean;
  captureCount: number;
  delivery: DesignDeliveryTarget;
  lastCaptureRevision: number | null;
  lastMaterialWriteRevision: number | null;
  lastReview: DesignVisualReviewToolInput | null;
  planned: DesignPlanTarget;
  reviewedCaptureCount: number;
  reviewedCaptureRevision: number | null;
};

export type DesignWorkflowState = {
  plan: DesignPlanToolInput;
  planRevision: number;
  targetOrder: string[];
  targetsById: Map<string, DesignDeliveryTargetState>;
};

export type DesignPlanRegistration = {
  changedTargetIds: string[];
  plan: DesignPlanToolInput;
  planRevision: number;
  state: DesignWorkflowState;
  status: "accepted" | "unchanged" | "amended";
};

export function registerDesignWorkflowPlan(options: {
  existing?: DesignWorkflowState;
  inspection: InspectedHierarchy;
  plan: DesignPlanToolInput;
  recoverableDelivery?: DesignDeliveryLedger;
}): DesignPlanRegistration {
  const { existing, inspection, plan, recoverableDelivery } = options;
  const targets = designPlanTargets(plan);
  assertUniquePlannedNodeIds(targets);
  if (existing && sameJson(existing.plan, plan)) {
    return {
      changedTargetIds: [],
      plan: structuredClone(existing.plan),
      planRevision: existing.planRevision,
      state: existing,
      status: "unchanged",
    };
  }
  assertMaterialTargetsRemainStable(existing, plan, targets);
  const visualSystemChanged =
    existing !== undefined &&
    !sameJson(existing.plan.visualSystem, plan.visualSystem);
  const targetsById = new Map<string, DesignDeliveryTargetState>();
  const changedTargetIds: string[] = [];
  for (const target of targets) {
    const current = existing?.targetsById.get(target.targetId);
    if (current && current.delivery.status !== "pending") {
      const targetChanged = !sameJson(current.planned, target);
      if (targetChanged || visualSystemChanged)
        changedTargetIds.push(target.targetId);
      targetsById.set(
        target.targetId,
        preserveMaterialTarget(
          current,
          target,
          inspection,
          targetChanged || visualSystemChanged,
        ),
      );
      continue;
    }
    targetsById.set(
      target.targetId,
      createTargetState(target, inspection, recoverableDelivery),
    );
    if (!current || !sameJson(current.planned, target)) {
      changedTargetIds.push(target.targetId);
    }
  }
  for (const targetId of existing?.targetOrder ?? []) {
    if (!targetsById.has(targetId)) changedTargetIds.push(targetId);
  }
  const state: DesignWorkflowState = {
    plan: structuredClone(plan),
    planRevision: (existing?.planRevision ?? 0) + 1,
    targetOrder: targets.map((target) => target.targetId),
    targetsById,
  };
  return {
    changedTargetIds: [...new Set(changedTargetIds)],
    plan: structuredClone(state.plan),
    planRevision: state.planRevision,
    state,
    status: existing ? "amended" : "accepted",
  };
}

function preserveMaterialTarget(
  current: DesignDeliveryTargetState,
  target: DesignPlanTarget,
  inspection: InspectedHierarchy,
  intentChanged: boolean,
): DesignDeliveryTargetState {
  const descendants = resolveExistingArtboardDescendants(inspection, target);
  const delivery = intentChanged
    ? {
        targetId: current.delivery.targetId,
        label: target.label,
        pageId: current.delivery.pageId,
        rootNodeId: current.delivery.rootNodeId,
        status: "drafted" as const,
        draftRevision: current.lastMaterialWriteRevision ?? inspection.revision,
      }
    : { ...structuredClone(current.delivery), label: target.label };
  return {
    ...current,
    artboardDescendantIds: descendants,
    artboardEstablished: true,
    captureCount: intentChanged ? 0 : current.captureCount,
    delivery,
    lastCaptureRevision: intentChanged ? null : current.lastCaptureRevision,
    lastReview: intentChanged ? null : current.lastReview,
    planned: structuredClone(target),
    reviewedCaptureCount: intentChanged ? 0 : current.reviewedCaptureCount,
    reviewedCaptureRevision: intentChanged
      ? null
      : current.reviewedCaptureRevision,
  };
}

function createTargetState(
  target: DesignPlanTarget,
  inspection: InspectedHierarchy,
  recoverableDelivery: DesignDeliveryLedger | undefined,
): DesignDeliveryTargetState {
  if (
    target.artboard.mode === "create" &&
    inspection.nodesById.has(target.artboard.frameId)
  ) {
    throw new Error(
      `design_workflow.artboard_already_exists: Planned create target ${target.artboard.frameId} already exists; inspect it as an existing artboard instead`,
    );
  }
  const artboardDescendantIds =
    target.artboard.mode === "existing"
      ? resolveExistingArtboardDescendants(inspection, target)
      : new Set<string>();
  const recovered = recoverableDelivery?.targets.find(
    (candidate) =>
      candidate.targetId === target.targetId &&
      candidate.pageId === target.pageId &&
      candidate.rootNodeId === target.artboard.frameId,
  );
  const delivery = recoverDeliveryTarget(
    target,
    recovered,
    inspection.revision,
    target.artboard.mode === "existing",
  );
  return {
    artboardDescendantIds,
    artboardEstablished: target.artboard.mode === "existing",
    captureCount: 0,
    delivery,
    lastCaptureRevision: null,
    lastMaterialWriteRevision:
      delivery.status === "drafted" ? (delivery.draftRevision ?? null) : null,
    lastReview: null,
    planned: structuredClone(target),
    reviewedCaptureCount: 0,
    reviewedCaptureRevision: null,
  };
}

function assertMaterialTargetsRemainStable(
  existing: DesignWorkflowState | undefined,
  plan: DesignPlanToolInput,
  targets: readonly DesignPlanTarget[],
): void {
  if (!existing) return;
  const materialTargets = [...existing.targetsById.values()].filter(
    (target) => target.delivery.status !== "pending",
  );
  if (
    materialTargets.length > 0 &&
    existing.plan.outputMode !== plan.outputMode
  ) {
    throw new Error(
      "design_workflow.plan_amendment_invalid: Output mode cannot change after material design writes have started",
    );
  }
  const nextTargets = new Map(
    targets.map((target) => [target.targetId, target]),
  );
  for (const current of materialTargets) {
    const next = nextTargets.get(current.delivery.targetId);
    if (!next) {
      throw new Error(
        `design_workflow.plan_amendment_invalid: Material target ${current.delivery.targetId} cannot be removed from an amended plan`,
      );
    }
    if (
      next.pageId !== current.planned.pageId ||
      next.artboard.frameId !== current.planned.artboard.frameId
    ) {
      throw new Error(
        `design_workflow.plan_amendment_invalid: Material target ${current.delivery.targetId} must preserve its Page and artboard Frame ID`,
      );
    }
    const nextRegionIds = new Set(
      next.composition.regions.map((region) => region.nodeId),
    );
    const removedRegion = current.planned.composition.regions.find(
      (region) => !nextRegionIds.has(region.nodeId),
    );
    if (removedRegion) {
      throw new Error(
        `design_workflow.plan_amendment_invalid: Material region ${removedRegion.nodeId} must retain its stable node ID`,
      );
    }
  }
}

function assertUniquePlannedNodeIds(
  targets: readonly DesignPlanTarget[],
): void {
  const ids = new Set<string>();
  for (const target of targets) {
    for (const nodeId of [
      target.artboard.frameId,
      ...target.composition.regions.map((region) => region.nodeId),
    ]) {
      if (ids.has(nodeId)) {
        throw new Error(
          `design_workflow.plan_node_ambiguous: Planned node ID ${nodeId} is reused across delivery targets; inspect and define unique stable IDs`,
        );
      }
      ids.add(nodeId);
    }
  }
}

function resolveExistingArtboardDescendants(
  inspection: InspectedHierarchy,
  target: DesignPlanTarget,
): Set<string> {
  const frameId = target.artboard.frameId;
  const frame = inspection.nodesById.get(frameId);
  if (!frame || frame.kind !== "frame") {
    throw new Error(
      `design_workflow.existing_artboard_invalid: Existing artboard ${frameId} is missing or is not a Frame; inspect again and choose an existing Frame`,
    );
  }
  if (!inspectedNodeBelongsToPage(inspection, target.pageId, frameId)) {
    throw new Error(
      `design_workflow.existing_artboard_invalid: Existing artboard ${frameId} does not belong to Page ${target.pageId}; inspect again and choose a Frame on the target Page`,
    );
  }
  const descendants = new Set<string>();
  for (const node of inspection.nodesById.values()) {
    if (
      node.id !== frameId &&
      inspectedParentChainReaches(inspection.nodesById, node.id, frameId)
    ) {
      descendants.add(node.id);
    }
  }
  return descendants;
}

export function inspectedNodeBelongsToPage(
  inspection: InspectedHierarchy,
  pageId: string,
  nodeId: string,
): boolean {
  const roots = inspection.pageRootsById.get(pageId);
  if (!roots) return false;
  let current: string | null = nodeId;
  const visited = new Set<string>();
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const node = inspection.nodesById.get(current);
    if (!node) return false;
    if (node.parentId === null) return roots.has(node.id);
    current = node.parentId;
  }
  return false;
}

function inspectedParentChainReaches(
  nodesById: InspectedHierarchy["nodesById"],
  nodeId: string,
  ancestorId: string,
): boolean {
  let current = nodesById.get(nodeId)?.parentId ?? null;
  const visited = new Set<string>();
  while (current !== null && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = nodesById.get(current)?.parentId ?? null;
  }
  return false;
}

function recoverDeliveryTarget(
  target: DesignPlanTarget,
  recovered: DesignDeliveryTarget | undefined,
  currentRevision: number,
  artboardExists: boolean,
): DesignDeliveryTarget {
  const pending: DesignDeliveryTarget = {
    targetId: target.targetId,
    label: target.label,
    pageId: target.pageId,
    rootNodeId: target.artboard.frameId,
    status: "pending",
  };
  if (!recovered || !artboardExists || recovered.status === "pending")
    return pending;
  if (
    recovered.status === "verified" &&
    recovered.verifiedRevision === currentRevision
  ) {
    return { ...structuredClone(recovered), label: target.label };
  }
  return { ...pending, status: "drafted", draftRevision: currentRevision };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
