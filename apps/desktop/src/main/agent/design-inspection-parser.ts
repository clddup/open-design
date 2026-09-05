import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import {
  DesignInspectionHierarchyContract,
  type DesignInspectionHierarchy,
} from "@/shared/design-inspection-hierarchy-contract.js";
import type { DesignSystemComponentCatalogEntry } from "@/shared/design-system-component-catalog.js";
import type {
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import type { DesignNode } from "@opendesign/design-contracts";
import type { InspectedHierarchy } from "./design-plan-registration.js";

type InspectionWireNode =
  DesignInspectionHierarchy["content"]["document"]["nodesById"][string];
type InspectedNode =
  InspectedHierarchy["nodesById"] extends Map<string, infer Node>
    ? Node
    : never;

export function parseInspectedHierarchy(
  context: TrustedToolContext,
  result: TrustedToolResult,
): InspectedHierarchy {
  const parsed = DesignInspectionHierarchyContract.parse(
    {
      observedRevision: result.observedRevision,
      content: result.content,
    },
    { documentId: context.documentId, runId: context.runId },
  );
  if (!parsed.ok) throw inspectionContractError(parsed.issues[0]);

  const inspection = parsed.value;
  const { document } = inspection.content;
  const componentCatalog = document.componentCatalog ?? {
    totalCount: 0,
    truncated: false,
    components: [],
  };
  return {
    catalogComponentsById: new Map<string, DesignSystemComponentCatalogEntry>(
      componentCatalog.components.map((component) => [
        component.componentId,
        structuredClone(component),
      ]),
    ),
    componentsById: componentMap(document),
    documentId: document.documentId,
    ...(inspection.content.idAllocation
      ? {
          newNodeIdPrefix: inspection.content.idAllocation.newNodeIdPrefix,
        }
      : {}),
    nodesById: nodeMap(document),
    pageRootsById: new Map(
      Object.entries(document.pagesById).map(([pageId, page]) => [
        pageId,
        new Set(page.rootNodeIds),
      ]),
    ),
    revision: inspection.observedRevision,
  };
}

function nodeMap(
  document: DesignInspectionHierarchy["content"]["document"],
): InspectedHierarchy["nodesById"] {
  return new Map(
    Object.entries(document.nodesById).map(([nodeId, node]) => [
      nodeId,
      projectInspectedNode(nodeId, node),
    ]),
  );
}

/** Project either validated source type without re-parsing committed snapshots. */
export function projectInspectedNode(
  id: string,
  node: DesignNode | InspectionWireNode,
): InspectedNode {
  const designRole = node.extensions?.designRole;
  return {
    ...(node.kind === "image" && node.properties?.assetId
      ? { assetId: node.properties.assetId }
      : {}),
    childIds: [...node.childIds],
    componentId:
      node.kind === "instance" ? (node.properties?.componentId ?? null) : null,
    ...(node.kind === "image" && typeof designRole === "string"
      ? { designRole }
      : {}),
    id,
    kind: node.kind,
    locked: node.locked,
    parentId: node.parentId,
    size: { width: node.size.width, height: node.size.height },
    transform: [...node.transform],
  };
}

function componentMap(
  document: DesignInspectionHierarchy["content"]["document"],
): InspectedHierarchy["componentsById"] {
  return new Map(
    Object.entries(document.componentsById ?? {}).map(
      ([componentId, component]) => [
        componentId,
        { id: componentId, rootNodeId: component.rootNodeId },
      ],
    ),
  );
}

function inspectionContractError(
  issue:
    | {
        message: string;
        path: string;
        recovery?: string;
      }
    | undefined,
): Error {
  return designWorkflowError(
    "inspection_invalid",
    issue?.message ?? "Document inspection hierarchy is invalid",
    {
      path: issue?.path ?? "/content/document",
      recovery:
        issue?.recovery ??
        "Inspect the current document again so the host can regenerate its exact-revision hierarchy.",
    },
  );
}
