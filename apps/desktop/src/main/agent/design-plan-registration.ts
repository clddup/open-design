import type {
  DesignDeliveryLedger,
  DesignDeliveryTarget,
} from "@opendesign/workspace-contracts";
import {
  componentStrategyOccurrencesForTarget,
  designPlanBriefFidelity,
  designPlanComponentStrategy,
  designPlanDesignIntent,
  designPlanSkillRefs,
  designPlanTargets,
  qualityProfileNodeIds,
  type DesignPlanTarget,
  type DesignPlanToolInput,
  type DesignVisualReviewToolInput,
} from "../../shared/design-agent-tools.js";

export type InspectedHierarchy = {
  componentsById: Map<string, { id: string; rootNodeId: string }>;
  documentId: string;
  newNodeIdPrefix?: string;
  nodesById: Map<
    string,
    {
      childIds: string[];
      componentId: string | null;
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
  const { existing, inspection, recoverableDelivery } = options;
  const plan = normalizePlanQualityProfiles(options.plan);
  const targets = designPlanTargets(plan);
  assertUniquePlannedNodeIds(plan, targets);
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
  assertMaterialComponentDecisionsRemainStable(existing, plan);
  const visualSystemChanged =
    existing !== undefined &&
    !sameJson(existing.plan.visualSystem, plan.visualSystem);
  const briefFidelityChanged =
    existing !== undefined &&
    !sameJson(
      designPlanBriefFidelity(existing.plan),
      designPlanBriefFidelity(plan),
    );
  const designIntentChanged =
    existing !== undefined &&
    !sameJson(
      designPlanDesignIntent(existing.plan),
      designPlanDesignIntent(plan),
    );
  const designSkillsChanged =
    existing !== undefined &&
    !sameJson(designPlanSkillRefs(existing.plan), designPlanSkillRefs(plan));
  const targetsById = new Map<string, DesignDeliveryTargetState>();
  const changedTargetIds: string[] = [];
  for (const target of targets) {
    const reservedNodeIds = plannedNodeIdsForTarget(plan, target.targetId);
    const current = existing?.targetsById.get(target.targetId);
    if (current && current.delivery.status !== "pending") {
      const targetChanged = !sameJson(current.planned, target);
      const componentStrategyChanged = !sameJson(
        existing ? componentOccurrences(existing.plan, target.targetId) : [],
        componentOccurrences(plan, target.targetId),
      );
      if (
        targetChanged ||
        visualSystemChanged ||
        componentStrategyChanged ||
        briefFidelityChanged ||
        designIntentChanged ||
        designSkillsChanged
      )
        changedTargetIds.push(target.targetId);
      targetsById.set(
        target.targetId,
        preserveMaterialTarget(
          current,
          target,
          inspection,
          reservedNodeIds,
          targetChanged ||
            visualSystemChanged ||
            componentStrategyChanged ||
            briefFidelityChanged ||
            designIntentChanged ||
            designSkillsChanged,
        ),
      );
      continue;
    }
    targetsById.set(
      target.targetId,
      createTargetState(
        target,
        inspection,
        recoverableDelivery,
        reservedNodeIds,
      ),
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

function assertMaterialComponentDecisionsRemainStable(
  existing: DesignWorkflowState | undefined,
  plan: DesignPlanToolInput,
): void {
  if (!existing) return;
  for (const target of existing.targetsById.values()) {
    if (!isMaterialDelivery(target.delivery)) continue;
    const previous = componentOccurrences(
      existing.plan,
      target.delivery.targetId,
    );
    const next = new Map(
      componentOccurrences(plan, target.delivery.targetId).map((occurrence) => [
        occurrence.nodeId,
        occurrence,
      ]),
    );
    for (const occurrence of previous) {
      const retained = next.get(occurrence.nodeId);
      if (!retained) {
        throw new Error(
          `design_workflow.plan_amendment_invalid: Material semantic object ${occurrence.decisionId} must retain stable node ${occurrence.nodeId} and an explicit component decision`,
        );
      }
      if (
        occurrence.decision !== "ordinary" &&
        (retained.decision !== occurrence.decision ||
          retained.componentId !== occurrence.componentId)
      ) {
        throw new Error(
          `design_workflow.plan_amendment_invalid: Declared Component occurrence ${occurrence.nodeId} must preserve its Main/Instance role and component ID after material design has started`,
        );
      }
    }
  }
}

function componentOccurrences(plan: DesignPlanToolInput, targetId: string) {
  const strategy = designPlanComponentStrategy(plan);
  return strategy
    ? componentStrategyOccurrencesForTarget(strategy, targetId)
    : [];
}

function preserveMaterialTarget(
  current: DesignDeliveryTargetState,
  target: DesignPlanTarget,
  inspection: InspectedHierarchy,
  reservedNodeIds: readonly string[],
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
          reservedNodeIds: [...reservedNodeIds],
          status: "drafted" as const,
          allocatedRevision:
            current.delivery.allocatedRevision ??
            current.lastMaterialWriteRevision ??
            inspection.revision,
          draftRevision:
            current.lastMaterialWriteRevision ?? inspection.revision,
        }
      : {
          ...structuredClone(current.delivery),
          label: target.label,
          reservedNodeIds: [...reservedNodeIds],
        };
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
  reservedNodeIds: readonly string[],
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
    reservedNodeIds,
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
    const currentQuality = current.planned.qualityProfile;
    const nextQuality = next.qualityProfile;
    if (currentQuality?.kind === "ui") {
      if (nextQuality?.kind !== "ui") {
        throw new Error(
          `design_workflow.plan_amendment_invalid: Material UI target ${current.delivery.targetId} must retain its executable UI quality profile`,
        );
      }
    }
  }
}

function normalizePlanQualityProfiles(
  plan: DesignPlanToolInput,
): DesignPlanToolInput {
  return {
    ...structuredClone(plan),
    targets: plan.targets.map((target) => {
      const qualityProfile = target.qualityProfile;
      if (qualityProfile.kind !== "ui") return structuredClone(target);
      const rootId = target.artboard.frameId;
      return {
        ...structuredClone(target),
        qualityProfile: {
          ...structuredClone(qualityProfile),
          safeAreaNodeIds: qualityProfile.safeAreaNodeIds.filter(
            (nodeId) => nodeId !== rootId,
          ),
          interactiveNodeIds: qualityProfile.interactiveNodeIds.filter(
            (nodeId) => nodeId !== rootId,
          ),
        },
      };
    }),
  };
}

function assertUniquePlannedNodeIds(
  plan: DesignPlanToolInput,
  targets: readonly DesignPlanTarget[],
): void {
  const targetByNodeId = new Map<string, string>();
  for (const target of targets) {
    for (const nodeId of plannedNodeIdsForTarget(plan, target.targetId)) {
      const ownerTargetId = targetByNodeId.get(nodeId);
      if (ownerTargetId !== undefined) {
        throw new Error(
          `design_workflow.plan_node_ambiguous: Planned node ID ${nodeId} is reserved by both ${ownerTargetId} and ${target.targetId}; inspect and define unique stable IDs for every delivery target`,
        );
      }
      targetByNodeId.set(nodeId, target.targetId);
    }
  }
}

export function resolveExistingArtboardDescendants(
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

export function reconcileEstablishedArtboardDescendants(
  state: DesignWorkflowState,
  inspection: InspectedHierarchy,
): void {
  for (const target of state.targetsById.values()) {
    if (
      !target.artboardEstablished ||
      !inspection.nodesById.has(target.planned.artboard.frameId)
    ) {
      continue;
    }
    target.artboardDescendantIds = resolveExistingArtboardDescendants(
      inspection,
      target.planned,
    );
  }
}

export function inspectedSubtreeIds(
  inspection: InspectedHierarchy | undefined,
  rootNodeId: string,
): Set<string> {
  if (!inspection?.nodesById.has(rootNodeId)) return new Set();
  const result = new Set<string>();
  const pending = [rootNodeId];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || result.has(nodeId)) continue;
    result.add(nodeId);
    pending.push(...(inspection.nodesById.get(nodeId)?.childIds ?? []));
  }
  return result;
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
  reservedNodeIds: readonly string[],
): DesignDeliveryTarget {
  const pending: DesignDeliveryTarget = {
    targetId: target.targetId,
    label: target.label,
    pageId: target.pageId,
    rootNodeId: target.artboard.frameId,
    reservedNodeIds: [...reservedNodeIds],
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
    return {
      ...structuredClone(recovered),
      label: target.label,
      reservedNodeIds: [...reservedNodeIds],
    };
  }
  if (
    recovered.status === "verified" &&
    recovered.verifiedRevision === currentRevision
  ) {
    return {
      ...structuredClone(recovered),
      label: target.label,
      reservedNodeIds: [...reservedNodeIds],
    };
  }
  return {
    ...pending,
    status: "drafted",
    allocatedRevision: recovered.allocatedRevision ?? currentRevision,
    draftRevision: currentRevision,
  };
}

export function plannedNodeIdsForTarget(
  plan: DesignPlanToolInput,
  targetId: string,
): string[] {
  const target = designPlanTargets(plan).find(
    (candidate) => candidate.targetId === targetId,
  );
  if (!target) return [];
  const nodeIds = new Set<string>([
    target.artboard.frameId,
    ...target.composition.regions.map((region) => region.nodeId),
    ...qualityProfileNodeIds(target.qualityProfile),
  ]);
  const strategy = designPlanComponentStrategy(plan);
  if (strategy) {
    for (const occurrence of componentStrategyOccurrencesForTarget(
      strategy,
      targetId,
    )) {
      nodeIds.add(occurrence.nodeId);
    }
  }
  return [...nodeIds];
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
