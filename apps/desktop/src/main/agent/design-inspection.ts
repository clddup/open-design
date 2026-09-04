import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import type { TrustedToolContext } from "@opendesign/agent-contracts";
import type { DesignLayoutQualityReport } from "@opendesign/editor-runtime";
import { designTargetQualityProfilesEqual } from "@opendesign/design-contracts";
import {
  componentStrategyOccurrencesForTarget,
  designPlanComponentStrategy,
  designPlanLogoExploration,
  type DesignPlanToolInput,
} from "@/shared/design-agent-tools.js";
import {
  inspectedNodeBelongsToPage,
  type DesignDeliveryTargetState,
  type InspectedHierarchy,
} from "./design-plan-registration";

export { parseInspectedHierarchy } from "./design-inspection-parser.js";

export function assertDeliveryTargetStructure(
  inspection: InspectedHierarchy,
  target: DesignDeliveryTargetState,
  plan: DesignPlanToolInput,
): DesignComponentStrategyReport {
  const artboardId = target.planned.artboard.frameId;
  const artboard = inspection.nodesById.get(artboardId);
  if (
    !artboard ||
    artboard.kind !== "frame" ||
    !inspectedNodeBelongsToPage(inspection, target.planned.pageId, artboardId)
  ) {
    throw designWorkflowError(
      "delivery_structure_incomplete",
      `Delivery target ${target.delivery.targetId} requires Frame ${artboardId} on Page ${target.planned.pageId}; inspect the current document and finish that target before capturing again`,
    );
  }
  if (target.planned.artboard.mode === "existing") {
    if (!inspectedSubtreeHasMaterialNode(inspection.nodesById, artboardId)) {
      throw designWorkflowError(
        "delivery_structure_incomplete",
        `Existing delivery artboard ${artboardId} has no real editable content; add or refine material layers inside the artboard before capturing again`,
      );
    }
    assertLogoExplorationEvidence(inspection, target, plan);
    return inspectDeclaredComponentStrategy(inspection, target, plan);
  }
  if (!inspectedSubtreeHasMaterialNode(inspection.nodesById, artboardId)) {
    throw designWorkflowError(
      "delivery_structure_incomplete",
      `Delivery artboard ${artboardId} has no real editable content`,
    );
  }
  assertLogoExplorationEvidence(inspection, target, plan);
  return inspectDeclaredComponentStrategy(inspection, target, plan);
}

function assertLogoExplorationEvidence(
  inspection: InspectedHierarchy,
  target: DesignDeliveryTargetState,
  plan: DesignPlanToolInput,
): void {
  const exploration = designPlanLogoExploration(plan);
  if (!exploration || exploration.targetId !== target.delivery.targetId) return;
  const artboardId = target.planned.artboard.frameId;
  for (const direction of exploration.directions) {
    const root = inspection.nodesById.get(direction.rootNodeId);
    if (
      !root ||
      (root.kind !== "frame" && root.kind !== "group") ||
      !inspectedParentChainReaches(
        inspection.nodesById,
        direction.rootNodeId,
        artboardId,
      )
    ) {
      throw designWorkflowError(
        "logo_exploration_incomplete",
        `Logo concept ${direction.conceptId} requires semantic Frame/Group ${direction.rootNodeId} inside exploration artboard ${artboardId}`,
      );
    }
    if (
      !inspection.nodesById.has(direction.masterNodeId) ||
      !inspectedParentChainReaches(
        inspection.nodesById,
        direction.masterNodeId,
        direction.rootNodeId,
      )
    ) {
      throw designWorkflowError(
        "logo_exploration_incomplete",
        `Logo concept ${direction.conceptId} requires its authored master ${direction.masterNodeId} beneath ${direction.rootNodeId}`,
      );
    }
  }
}

export type DesignComponentStrategyIssue = {
  code:
    | "semantic-root-missing"
    | "ordinary-root-invalid"
    | "component-main-unbound"
    | "component-instance-unlinked";
  decisionId: string;
  nodeId: string;
  componentId?: string;
  message: string;
};

export type DesignComponentStrategyReport = {
  version: 1;
  checkedOccurrenceCount: number;
  issueCount: number;
  issues: DesignComponentStrategyIssue[];
  blocking: false;
};

const MAX_COMPONENT_STRATEGY_ISSUES = 64;

export function inspectDeclaredComponentStrategy(
  inspection: InspectedHierarchy,
  target: DesignDeliveryTargetState,
  plan: DesignPlanToolInput,
): DesignComponentStrategyReport {
  const strategy = designPlanComponentStrategy(plan);
  if (!strategy) return componentStrategyReport(0, []);
  const occurrences = componentStrategyOccurrencesForTarget(
    strategy,
    target.delivery.targetId,
  );
  const issues: DesignComponentStrategyIssue[] = [];
  for (const occurrence of occurrences) {
    const node = inspection.nodesById.get(occurrence.nodeId);
    if (
      !node ||
      !inspectedParentChainReaches(
        inspection.nodesById,
        occurrence.nodeId,
        target.planned.artboard.frameId,
      )
    ) {
      issues.push({
        code: "semantic-root-missing",
        decisionId: occurrence.decisionId,
        nodeId: occurrence.nodeId,
        ...(occurrence.decision === "ordinary"
          ? {}
          : { componentId: occurrence.componentId }),
        message: `Declared semantic object ${occurrence.decisionId} requires node ${occurrence.nodeId} inside delivery artboard ${target.planned.artboard.frameId}.`,
      });
      continue;
    }
    if (occurrence.decision === "ordinary") {
      if (node.kind !== "frame" && node.kind !== "group") {
        issues.push({
          code: "ordinary-root-invalid",
          decisionId: occurrence.decisionId,
          nodeId: occurrence.nodeId,
          message: `Ordinary semantic object ${occurrence.decisionId} should use a named Frame or Group root at ${occurrence.nodeId}.`,
        });
      }
      continue;
    }
    if (occurrence.decision === "component-main") {
      if (
        (node.kind !== "frame" && node.kind !== "group") ||
        inspection.componentsById.get(occurrence.componentId)?.rootNodeId !==
          occurrence.nodeId
      ) {
        issues.push({
          code: "component-main-unbound",
          decisionId: occurrence.decisionId,
          nodeId: occurrence.nodeId,
          componentId: occurrence.componentId,
          message: `Declared Component Main ${occurrence.componentId} should bind Frame/Group ${occurrence.nodeId} on Page ${target.planned.pageId}.`,
        });
      }
      continue;
    }
    if (
      node.kind !== "instance" ||
      node.componentId !== occurrence.componentId ||
      !inspection.componentsById.has(occurrence.componentId)
    ) {
      issues.push({
        code: "component-instance-unlinked",
        decisionId: occurrence.decisionId,
        nodeId: occurrence.nodeId,
        componentId: occurrence.componentId,
        message: `Declared instance ${occurrence.nodeId} should remain linked to Component ${occurrence.componentId}.`,
      });
    }
  }
  return componentStrategyReport(occurrences.length, issues);
}

function componentStrategyReport(
  checkedOccurrenceCount: number,
  issues: DesignComponentStrategyIssue[],
): DesignComponentStrategyReport {
  return {
    version: 1,
    checkedOccurrenceCount,
    issueCount: issues.length,
    issues: issues.slice(0, MAX_COMPONENT_STRATEGY_ISSUES),
    blocking: false,
  };
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

export function assertLayoutQualityMatchesCapture(
  context: TrustedToolContext,
  target: DesignDeliveryTargetState,
  observedRevision: number,
  layoutQuality: DesignLayoutQualityReport,
): void {
  if (
    layoutQuality.documentId !== context.documentId ||
    layoutQuality.revision !== observedRevision ||
    layoutQuality.pageId !== target.planned.pageId ||
    layoutQuality.artboardFrameId !== target.planned.artboard.frameId ||
    !designTargetQualityProfilesEqual(
      layoutQuality.qualityProfile,
      target.planned.qualityProfile,
    )
  ) {
    throw designWorkflowError(
      "layout_quality_unavailable",
      "The deterministic layout-quality report does not match the current delivery document, revision, Page, and Frame; inspect and capture the current target again",
    );
  }
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
