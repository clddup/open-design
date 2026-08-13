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
      size: { width: number; height: number };
      transform: [number, number, number, number, number, number];
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
    const refreshed = refreshEstablishedTargets(existing, inspection);
    return {
      changedTargetIds: [],
      plan: structuredClone(existing.plan),
      planRevision: existing.planRevision,
      state: refreshed,
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
  if (current.delivery.status === "allocated") {
    assertAllocatedArtboardMatchesInspection(inspection, target);
  }
  const descendants = resolveExistingArtboardDescendants(inspection, target);
  const delivery =
    intentChanged && isMaterialDelivery(current.delivery)
      ? {
          targetId: current.delivery.targetId,
          label: target.label,
          pageId: current.delivery.pageId,
          rootNodeId: current.delivery.rootNodeId,
          status: "drafted" as const,
          allocatedRevision:
            current.delivery.allocatedRevision ??
            current.lastMaterialWriteRevision ??
            inspection.revision,
          draftRevision:
            current.lastMaterialWriteRevision ?? inspection.revision,
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
  const inspectedArtboard = inspection.nodesById.get(target.artboard.frameId);
  const recovered = recoverableDelivery?.targets.find(
    (candidate) =>
      candidate.targetId === target.targetId &&
      candidate.pageId === target.pageId &&
      candidate.rootNodeId === target.artboard.frameId,
  );
  const recoveredAllocation =
    target.artboard.mode === "create" &&
    recovered?.allocatedRevision !== undefined;
  if (recoveredAllocation) {
    assertAllocatedArtboardMatchesInspection(inspection, target);
  }
  const artboardDescendantIds =
    target.artboard.mode === "existing" || recoveredAllocation
      ? resolveExistingArtboardDescendants(inspection, target)
      : new Set<string>();
  if (
    target.artboard.mode === "create" &&
    inspectedArtboard &&
    !recoveredAllocation
  ) {
    throw new Error(
      `design_workflow.artboard_already_exists: Planned create target ${target.artboard.frameId} already exists without matching allocation evidence; inspect it as an existing artboard instead`,
    );
  }
  const delivery = recoverDeliveryTarget(
    target,
    recovered,
    inspection.revision,
    target.artboard.mode === "existing" || recoveredAllocation,
    target.artboard.mode === "existing" &&
      inspectedSubtreeHasMaterialNode(
        inspection.nodesById,
        target.artboard.frameId,
      ),
  );
  return {
    artboardDescendantIds,
    artboardEstablished:
      target.artboard.mode === "existing" || recoveredAllocation,
    captureCount: 0,
    delivery,
    lastCaptureRevision: null,
    lastMaterialWriteRevision: isMaterialDelivery(delivery)
      ? (delivery.draftRevision ?? null)
      : null,
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
  artboardHasMaterial: boolean,
): DesignDeliveryTarget {
  const pending: DesignDeliveryTarget = {
    targetId: target.targetId,
    label: target.label,
    pageId: target.pageId,
    rootNodeId: target.artboard.frameId,
    status: "pending",
  };
  if (!artboardExists) return pending;
  if (!recovered || recovered.status === "pending") {
    if (artboardHasMaterial) {
      return {
        ...pending,
        status: "drafted",
        allocatedRevision: currentRevision,
        draftRevision: currentRevision,
      };
    }
    return {
      ...pending,
      status: "allocated",
      allocatedRevision: currentRevision,
    };
  }
  if (recovered.status === "allocated") {
    return { ...structuredClone(recovered), label: target.label };
  }
  if (
    recovered.status === "verified" &&
    recovered.verifiedRevision === currentRevision
  ) {
    return { ...structuredClone(recovered), label: target.label };
  }
  return {
    ...pending,
    status: "drafted",
    allocatedRevision: recovered.allocatedRevision ?? currentRevision,
    draftRevision: currentRevision,
  };
}

function inspectedSubtreeHasMaterialNode(
  nodesById: InspectedHierarchy["nodesById"],
  rootId: string,
): boolean {
  const pending = [...(nodesById.get(rootId)?.childIds ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) continue;
    if (node.kind !== "group" && node.kind !== "frame") return true;
    pending.push(...node.childIds);
  }
  return false;
}

function isMaterialDelivery(target: DesignDeliveryTarget): boolean {
  return target.status !== "pending" && target.status !== "allocated";
}

function refreshEstablishedTargets(
  existing: DesignWorkflowState,
  inspection: InspectedHierarchy,
): DesignWorkflowState {
  const targetsById = new Map<string, DesignDeliveryTargetState>();
  for (const targetId of existing.targetOrder) {
    const current = existing.targetsById.get(targetId);
    if (!current) continue;
    if (!current.artboardEstablished) {
      targetsById.set(targetId, current);
      continue;
    }
    if (current.planned.artboard.mode === "create") {
      assertAllocatedArtboardMatchesInspection(inspection, current.planned);
    } else {
      resolveExistingArtboardDescendants(inspection, current.planned);
    }
    targetsById.set(targetId, {
      ...current,
      artboardDescendantIds: resolveExistingArtboardDescendants(
        inspection,
        current.planned,
      ),
    });
  }
  return { ...existing, targetsById };
}

function assertAllocatedArtboardMatchesInspection(
  inspection: InspectedHierarchy,
  target: DesignPlanTarget,
): void {
  const frame = inspection.nodesById.get(target.artboard.frameId);
  if (
    !frame ||
    frame.kind !== "frame" ||
    frame.parentId !== null ||
    !inspection.pageRootsById
      .get(target.pageId)
      ?.has(target.artboard.frameId) ||
    frame.transform[0] !== 1 ||
    frame.transform[1] !== 0 ||
    frame.transform[2] !== 0 ||
    frame.transform[3] !== 1 ||
    frame.size.width !== target.artboard.width ||
    frame.size.height !== target.artboard.height
  ) {
    throw new Error(
      `design_workflow.allocated_artboard_invalid: Allocated artboard ${target.artboard.frameId} was deleted, resized, reparented, or structurally changed; inspect and amend the plan before continuing`,
    );
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
