import type {
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import type { DesignLayoutQualityReport } from "@opendesign/editor-runtime";
import {
  componentStrategyOccurrencesForTarget,
  designPlanComponentStrategy,
  type DesignPlanToolInput,
} from "../../shared/design-agent-tools.js";
import {
  inspectedNodeBelongsToPage,
  type DesignDeliveryTargetState,
  type InspectedHierarchy,
} from "./design-plan-registration";

export function parseInspectedHierarchy(
  context: TrustedToolContext,
  result: TrustedToolResult,
): InspectedHierarchy {
  if (!validRevision(result.observedRevision)) {
    throw new Error(
      "design_workflow.inspection_invalid: Document inspection did not return a valid observed revision; inspect again",
    );
  }
  const content = recordValue(result.content);
  const document = recordValue(content?.document);
  if (
    !document ||
    document.documentId !== context.documentId ||
    document.revision !== result.observedRevision
  ) {
    throw new Error(
      "design_workflow.inspection_invalid: Document inspection identity or revision is invalid; inspect again",
    );
  }
  const rawPages = recordValue(document.pagesById);
  const rawNodes = recordValue(document.nodesById);
  if (!rawPages || !rawNodes) {
    throw new Error(
      "design_workflow.inspection_invalid: Document inspection hierarchy is missing; inspect again",
    );
  }
  const pageRootsById = new Map<string, Set<string>>();
  for (const [pageId, value] of Object.entries(rawPages)) {
    const page = recordValue(value);
    if (
      !page ||
      page.id !== pageId ||
      !Array.isArray(page.rootNodeIds) ||
      !page.rootNodeIds.every(safeHierarchyId) ||
      new Set(page.rootNodeIds).size !== page.rootNodeIds.length
    ) {
      throw new Error(
        "design_workflow.inspection_invalid: Document inspection contains an invalid Page hierarchy; inspect again",
      );
    }
    pageRootsById.set(pageId, new Set(page.rootNodeIds));
  }
  const nodesById: InspectedHierarchy["nodesById"] = new Map();
  for (const [nodeId, value] of Object.entries(rawNodes)) {
    const node = recordValue(value);
    if (
      !node ||
      node.id !== nodeId ||
      !safeHierarchyId(nodeId) ||
      typeof node.kind !== "string" ||
      typeof node.locked !== "boolean" ||
      !Array.isArray(node.childIds) ||
      !node.childIds.every(safeHierarchyId) ||
      new Set(node.childIds).size !== node.childIds.length ||
      !validInspectedSize(node.size) ||
      !validInspectedTransform(node.transform) ||
      !(
        node.parentId === null ||
        (typeof node.parentId === "string" && safeHierarchyId(node.parentId))
      )
    ) {
      throw new Error(
        "design_workflow.inspection_invalid: Document inspection contains an invalid node hierarchy; inspect again",
      );
    }
    const properties = recordValue(node.properties);
    const componentId =
      node.kind === "instance" && safeHierarchyId(properties?.componentId)
        ? properties.componentId
        : null;
    nodesById.set(nodeId, {
      childIds: [...node.childIds],
      componentId,
      id: nodeId,
      kind: node.kind,
      locked: node.locked,
      parentId: node.parentId,
      size: { width: node.size.width, height: node.size.height },
      transform: [...node.transform],
    });
  }
  for (const node of nodesById.values()) {
    if (node.parentId !== null && !nodesById.has(node.parentId)) {
      throw new Error(
        `design_workflow.inspection_invalid: Document inspection is missing parent ${node.parentId}; inspect again`,
      );
    }
    for (const childId of node.childIds) {
      if (nodesById.get(childId)?.parentId !== node.id) {
        throw new Error(
          `design_workflow.inspection_invalid: Document inspection contains inconsistent child ${childId}; inspect again`,
        );
      }
    }
    assertAcyclicInspectedParentChain(nodesById, node.id);
  }
  for (const roots of pageRootsById.values()) {
    for (const rootId of roots) {
      if (nodesById.get(rootId)?.parentId !== null) {
        throw new Error(
          "design_workflow.inspection_invalid: Document inspection contains an invalid Page root; inspect again",
        );
      }
    }
  }
  const componentsById: InspectedHierarchy["componentsById"] = new Map();
  for (const [componentId, value] of Object.entries(
    recordValue(document.componentsById) ?? {},
  )) {
    const component = recordValue(value);
    if (
      !component ||
      component.id !== componentId ||
      !safeHierarchyId(componentId) ||
      !safeHierarchyId(component.rootNodeId)
    ) {
      throw new Error(
        "design_workflow.inspection_invalid: Document inspection contains an invalid component definition; inspect again",
      );
    }
    componentsById.set(componentId, {
      id: componentId,
      rootNodeId: component.rootNodeId,
    });
  }
  return {
    componentsById,
    documentId: context.documentId,
    nodesById,
    pageRootsById,
    revision: result.observedRevision,
  };
}

export function assertDeliveryTargetStructure(
  inspection: InspectedHierarchy,
  target: DesignDeliveryTargetState,
  plan: DesignPlanToolInput,
): void {
  const artboardId = target.planned.artboard.frameId;
  const artboard = inspection.nodesById.get(artboardId);
  if (
    !artboard ||
    artboard.kind !== "frame" ||
    !inspectedNodeBelongsToPage(inspection, target.planned.pageId, artboardId)
  ) {
    throw new Error(
      `design_workflow.delivery_structure_incomplete: Delivery target ${target.delivery.targetId} requires Frame ${artboardId} on Page ${target.planned.pageId}; inspect the current document and finish that target before capturing again`,
    );
  }
  if (target.planned.artboard.mode === "existing") {
    if (!inspectedSubtreeHasMaterialNode(inspection.nodesById, artboardId)) {
      throw new Error(
        `design_workflow.delivery_structure_incomplete: Existing delivery artboard ${artboardId} has no real editable content; add or refine material layers inside the artboard before capturing again`,
      );
    }
    assertDeclaredComponentStrategy(inspection, target, plan);
    return;
  }
  for (const region of target.planned.composition.regions) {
    const regionNode = inspection.nodesById.get(region.nodeId);
    if (
      !regionNode ||
      (regionNode.kind !== "group" && regionNode.kind !== "frame") ||
      regionNode.parentId !== artboardId
    ) {
      throw new Error(
        `design_workflow.delivery_structure_incomplete: Planned region ${region.nodeId} must be a direct Group or Frame child of delivery artboard ${artboardId}; inspect the current document and finish that region before capturing again`,
      );
    }
    if (!inspectedSubtreeHasMaterialNode(inspection.nodesById, region.nodeId)) {
      throw new Error(
        `design_workflow.delivery_structure_incomplete: Planned region ${region.nodeId} is empty; add real editable design content before capturing the target again`,
      );
    }
  }
  assertDeclaredComponentStrategy(inspection, target, plan);
}

function assertDeclaredComponentStrategy(
  inspection: InspectedHierarchy,
  target: DesignDeliveryTargetState,
  plan: DesignPlanToolInput,
): void {
  const strategy = designPlanComponentStrategy(plan);
  if (!strategy) return;
  const occurrences = componentStrategyOccurrencesForTarget(
    strategy,
    target.delivery.targetId,
  );
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
      throw new Error(
        `design_workflow.component_strategy_incomplete: Declared semantic object ${occurrence.decisionId} requires node ${occurrence.nodeId} inside delivery artboard ${target.planned.artboard.frameId}; inspect the live hierarchy and implement the declared component decision before capturing again`,
      );
    }
    if (occurrence.decision === "ordinary") {
      if (node.kind !== "frame" && node.kind !== "group") {
        throw new Error(
          `design_workflow.component_strategy_incomplete: Ordinary semantic object ${occurrence.decisionId} must use a named Frame or Group root at ${occurrence.nodeId}; group its meaningful layers without manufacturing a Component, then inspect and capture again`,
        );
      }
      continue;
    }
    if (occurrence.decision === "component-main") {
      if (
        (node.kind !== "frame" && node.kind !== "group") ||
        inspection.componentsById.get(occurrence.componentId)?.rootNodeId !==
          occurrence.nodeId
      ) {
        throw new Error(
          `design_workflow.component_strategy_incomplete: Declared Component Main ${occurrence.componentId} must bind Frame/Group ${occurrence.nodeId}; create it with opendesign_manage_components, inspect the current document, and capture again`,
        );
      }
      continue;
    }
    if (
      node.kind !== "instance" ||
      node.componentId !== occurrence.componentId ||
      !inspection.componentsById.has(occurrence.componentId)
    ) {
      throw new Error(
        `design_workflow.component_strategy_incomplete: Declared instance ${occurrence.nodeId} must remain linked to Component ${occurrence.componentId}; place the planned Instance with opendesign_manage_components instead of copying primitive layers, then inspect and capture again`,
      );
    }
  }
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
    layoutQuality.artboardFrameId !== target.planned.artboard.frameId
  ) {
    throw new Error(
      "design_workflow.layout_quality_unavailable: The deterministic layout-quality report does not match the current delivery document, revision, Page, and Frame; inspect and capture the current target again",
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

function assertAcyclicInspectedParentChain(
  nodesById: InspectedHierarchy["nodesById"],
  nodeId: string,
): void {
  let current: string | null = nodeId;
  const visited = new Set<string>();
  while (current !== null) {
    if (visited.has(current)) {
      throw new Error(
        "design_workflow.inspection_invalid: Document inspection contains a parent cycle; inspect again after repairing the document",
      );
    }
    visited.add(current);
    current = nodesById.get(current)?.parentId ?? null;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeHierarchyId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  );
}

function validInspectedSize(
  value: unknown,
): value is { width: number; height: number } {
  const size = recordValue(value);
  return (
    size !== null &&
    typeof size.width === "number" &&
    Number.isFinite(size.width) &&
    size.width >= 0 &&
    typeof size.height === "number" &&
    Number.isFinite(size.height) &&
    size.height >= 0
  );
}

function validInspectedTransform(
  value: unknown,
): value is [number, number, number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function validRevision(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}
