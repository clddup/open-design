import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import type {
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { isAgentDesignIdAllocation } from "@/shared/design-id-allocation.js";
import {
  DesignSystemComponentCatalogContract,
  type DesignSystemComponentCatalogEntry,
} from "@/shared/design-system-component-catalog.js";
import type { InspectedHierarchy } from "./design-plan-registration.js";

export function parseInspectedHierarchy(
  context: TrustedToolContext,
  result: TrustedToolResult,
): InspectedHierarchy {
  if (!validRevision(result.observedRevision)) {
    throw designWorkflowError(
      "inspection_invalid",
      "Document inspection did not return a valid observed revision; inspect again",
    );
  }
  const content = recordValue(result.content);
  const rawIdAllocation = content?.idAllocation;
  const idAllocation =
    rawIdAllocation === undefined
      ? undefined
      : isAgentDesignIdAllocation(rawIdAllocation, context.runId)
        ? rawIdAllocation
        : null;
  if (idAllocation === null) {
    throw designWorkflowError(
      "inspection_invalid",
      "Document inspection contains an invalid new-node ID allocation; inspect again",
    );
  }
  const document = recordValue(content?.document);
  if (
    !document ||
    document.documentId !== context.documentId ||
    document.revision !== result.observedRevision
  ) {
    throw designWorkflowError(
      "inspection_invalid",
      "Document inspection identity or revision is invalid; inspect again",
    );
  }
  const rawPages = recordValue(document.pagesById);
  const rawNodes = recordValue(document.nodesById);
  if (!rawPages || !rawNodes) {
    throw designWorkflowError(
      "inspection_invalid",
      "Document inspection hierarchy is missing; inspect again",
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
      throw designWorkflowError(
        "inspection_invalid",
        "Document inspection contains an invalid Page hierarchy; inspect again",
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
      throw designWorkflowError(
        "inspection_invalid",
        "Document inspection contains an invalid node hierarchy; inspect again",
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
      throw designWorkflowError(
        "inspection_invalid",
        `Document inspection is missing parent ${node.parentId}; inspect again`,
      );
    }
    for (const childId of node.childIds) {
      if (nodesById.get(childId)?.parentId !== node.id) {
        throw designWorkflowError(
          "inspection_invalid",
          `Document inspection contains inconsistent child ${childId}; inspect again`,
        );
      }
    }
    assertAcyclicInspectedParentChain(nodesById, node.id);
  }
  for (const roots of pageRootsById.values()) {
    for (const rootId of roots) {
      if (nodesById.get(rootId)?.parentId !== null) {
        throw designWorkflowError(
          "inspection_invalid",
          "Document inspection contains an invalid Page root; inspect again",
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
      throw designWorkflowError(
        "inspection_invalid",
        "Document inspection contains an invalid component definition; inspect again",
      );
    }
    componentsById.set(componentId, {
      id: componentId,
      rootNodeId: component.rootNodeId,
    });
  }
  const rawComponentCatalog = document.componentCatalog;
  const componentCatalogResult =
    rawComponentCatalog === undefined
      ? ({
          ok: true,
          value: { totalCount: 0, truncated: false, components: [] },
        } as const)
      : DesignSystemComponentCatalogContract.parse(rawComponentCatalog);
  if (!componentCatalogResult.ok) {
    const firstIssue = componentCatalogResult.issues[0];
    const path =
      firstIssue?.path && firstIssue.path !== "/"
        ? `/componentCatalog${firstIssue.path}`
        : "/componentCatalog";
    throw designWorkflowError(
      "inspection_invalid",
      firstIssue
        ? `Reusable component catalog is invalid: ${firstIssue.message}`
        : "Document inspection contains an invalid reusable component catalog",
      {
        path,
        recovery:
          "Inspect the current document again so the host can regenerate its exact-revision component catalog.",
      },
    );
  }
  const componentCatalog = componentCatalogResult.value;
  const catalogComponentsById = new Map<
    string,
    DesignSystemComponentCatalogEntry
  >(
    componentCatalog.components.map((component) => [
      component.componentId,
      structuredClone(component),
    ]),
  );
  return {
    catalogComponentsById,
    componentsById,
    documentId: context.documentId,
    ...(idAllocation === undefined
      ? {}
      : { newNodeIdPrefix: idAllocation.newNodeIdPrefix }),
    nodesById,
    pageRootsById,
    revision: result.observedRevision,
  };
}

function assertAcyclicInspectedParentChain(
  nodesById: InspectedHierarchy["nodesById"],
  nodeId: string,
): void {
  let current: string | null = nodeId;
  const visited = new Set<string>();
  while (current !== null) {
    if (visited.has(current)) {
      throw designWorkflowError(
        "inspection_invalid",
        "Document inspection contains a parent cycle; inspect again after repairing the document",
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
