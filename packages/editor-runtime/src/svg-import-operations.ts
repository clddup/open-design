import {
  DesignNodeSchema,
  MAX_TRANSACTION_COMMANDS,
  schemaValidationIssues,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
  type Transform,
} from "@opendesign/design-contracts";
import {
  SVG_INTERCHANGE_VERSION,
  type SvgImportResult,
  type SvgInterchangeIssue,
} from "@opendesign/import-export-service";
import { validateDocumentInvariants } from "./document.js";
import { multiplyTransforms } from "./geometry.js";

export type SvgImportOperationFailureCode =
  | "id-collision"
  | "invalid-import"
  | "invalid-target"
  | "invalid-tree"
  | "locked"
  | "not-found"
  | "operation-limit"
  | "unsupported-reference";

export interface SvgImportPlacement {
  pageId: string;
  parentId: string | null;
  index: number;
  transform: Transform;
  commandPrefix: string;
}

export type SvgImportOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      selectionNodeIds: [string];
      rootNodeId: string;
      issues: readonly SvgInterchangeIssue[];
    }
  | {
      ok: false;
      code: SvgImportOperationFailureCode;
      message: string;
    };

/**
 * Converts one parsed SVG candidate into a standard, atomic EditorRuntime
 * transaction plan. The service result remains detached until the caller
 * previews or applies the returned commands against an explicit Page target.
 */
export function planSvgImport(
  document: DesignDocument,
  imported: SvgImportResult,
  placement: SvgImportPlacement,
): SvgImportOperationPlan {
  if (!imported.ok) {
    return failure(
      "invalid-import",
      imported.issues[0]?.message ??
        "SVG import did not produce an editable tree",
    );
  }
  if (imported.version !== SVG_INTERCHANGE_VERSION) {
    return failure(
      "invalid-import",
      `SVG interchange version ${String(imported.version)} is not supported`,
    );
  }
  if (imported.issues.some((issue) => issue.severity === "error")) {
    return failure(
      "invalid-import",
      "A successful SVG import result cannot contain error-level fidelity issues",
    );
  }
  if (placement.commandPrefix.trim().length === 0) {
    return failure(
      "invalid-target",
      "SVG import commandPrefix cannot be empty",
    );
  }
  if (!isFiniteTransform(placement.transform)) {
    return failure(
      "invalid-target",
      "SVG import placement transform must contain six finite numbers",
    );
  }

  const page = document.pagesById[placement.pageId];
  if (!page) {
    return failure("not-found", `Page ${placement.pageId} does not exist`);
  }
  const targetParent = placement.parentId
    ? document.nodesById[placement.parentId]
    : undefined;
  if (placement.parentId && !targetParent) {
    return failure(
      "not-found",
      `Target parent ${placement.parentId} does not exist`,
    );
  }
  if (
    targetParent &&
    targetParent.kind !== "frame" &&
    targetParent.kind !== "group"
  ) {
    return failure(
      "invalid-target",
      "SVG can only be imported at the Page root, into a Frame, or into a Group",
    );
  }
  if (
    targetParent &&
    !nodeBelongsToPage(document, placement.pageId, targetParent.id)
  ) {
    return failure(
      "invalid-target",
      `Target parent ${targetParent.id} is outside Page ${placement.pageId}`,
    );
  }
  if (targetParent && isEffectivelyLocked(document, targetParent.id)) {
    return failure("locked", "SVG cannot be imported into a locked container");
  }
  const targetChildren = targetParent
    ? targetParent.childIds
    : page.rootNodeIds;
  if (
    !Number.isInteger(placement.index) ||
    placement.index < 0 ||
    placement.index > targetChildren.length
  ) {
    return failure(
      "invalid-target",
      `SVG import index ${placement.index} is outside the target range 0..${targetChildren.length}`,
    );
  }

  if (imported.nodes.length === 0) {
    return failure("invalid-tree", "SVG import tree cannot be empty");
  }
  if (imported.nodes.length > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Importing ${imported.nodes.length} SVG layers exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }

  const nodesById = new Map<string, DesignNode>();
  for (const node of imported.nodes) {
    const schemaIssues = schemaValidationIssues(DesignNodeSchema, node);
    if (schemaIssues.length > 0) {
      return failure(
        "invalid-tree",
        `SVG node ${readNodeId(node)} is invalid: ${schemaIssues[0]?.message ?? "schema mismatch"}`,
      );
    }
    if (nodesById.has(node.id)) {
      return failure(
        "invalid-tree",
        `SVG import tree contains duplicate node id ${node.id}`,
      );
    }
    if (document.nodesById[node.id]) {
      return failure(
        "id-collision",
        `SVG node ${node.id} already exists in the document`,
      );
    }
    if (nodeReferencesAsset(node)) {
      return failure(
        "unsupported-reference",
        `SVG node ${node.id} contains an asset reference without a typed imported asset`,
      );
    }
    nodesById.set(node.id, node);
  }

  const root = nodesById.get(imported.rootNodeId);
  if (!root) {
    return failure(
      "invalid-tree",
      `SVG root ${imported.rootNodeId} is missing from the imported nodes`,
    );
  }
  const roots = imported.nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1 || roots[0]?.id !== root.id) {
    return failure(
      "invalid-tree",
      "SVG import must contain exactly one declared root matching rootNodeId",
    );
  }

  const ordered = parentFirstOrder(root.id, nodesById);
  if (!ordered.ok) return ordered;
  if (ordered.nodeIds.length !== imported.nodes.length) {
    return failure(
      "invalid-tree",
      "Every SVG node must be reachable exactly once from the declared root",
    );
  }

  const projected = structuredClone(document);
  for (const node of imported.nodes) {
    projected.nodesById[node.id] = structuredClone(node);
  }
  const projectedRoot = projected.nodesById[root.id]!;
  projectedRoot.parentId = placement.parentId;
  projectedRoot.transform = multiplyTransforms(
    placement.transform,
    projectedRoot.transform,
  );
  const projectedTarget = placement.parentId
    ? projected.nodesById[placement.parentId]?.childIds
    : projected.pagesById[placement.pageId]?.rootNodeIds;
  if (!projectedTarget) {
    return failure(
      "invalid-target",
      "SVG import target hierarchy is unavailable",
    );
  }
  projectedTarget.splice(placement.index, 0, root.id);
  const projectedIssues = validateDocumentInvariants(projected);
  if (projectedIssues.length > 0) {
    return failure(
      "invalid-tree",
      `SVG import tree violates document invariants: ${projectedIssues[0]?.message ?? "invalid hierarchy"}`,
    );
  }

  const commands: DesignOperation[] = ordered.nodeIds.map((nodeId, index) => {
    const source = nodesById.get(nodeId)!;
    const isRoot = nodeId === root.id;
    const parentId = isRoot ? placement.parentId : source.parentId;
    const siblings = isRoot
      ? targetChildren
      : nodesById.get(source.parentId!)?.childIds;
    const childIndex = isRoot
      ? placement.index
      : (siblings?.indexOf(nodeId) ?? -1);
    return {
      commandId: `${placement.commandPrefix}_insert_${index.toString().padStart(4, "0")}`,
      type: "insert_element",
      pageId: placement.pageId,
      parentId,
      index: childIndex,
      node: {
        ...structuredClone(source),
        parentId,
        childIds: [],
        ...(isRoot
          ? {
              transform: multiplyTransforms(
                placement.transform,
                source.transform,
              ),
            }
          : {}),
      },
    };
  });

  return {
    ok: true,
    commands,
    selectionNodeIds: [root.id],
    rootNodeId: root.id,
    issues: imported.issues.map((issue) => ({ ...issue })),
  };
}

type ParentFirstResult =
  | { ok: true; nodeIds: string[] }
  | Extract<SvgImportOperationPlan, { ok: false }>;

function parentFirstOrder(
  rootNodeId: string,
  nodesById: ReadonlyMap<string, DesignNode>,
): ParentFirstResult {
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (
    nodeId: string,
    expectedParentId: string | null,
  ): string | null => {
    const node = nodesById.get(nodeId);
    if (!node) return `SVG child ${nodeId} is missing`;
    if (visiting.has(nodeId)) return `SVG node ${nodeId} creates a cycle`;
    if (visited.has(nodeId)) return `SVG node ${nodeId} appears more than once`;
    if (node.parentId !== expectedParentId) {
      return `SVG node ${nodeId} does not point back to its declared parent`;
    }
    visiting.add(nodeId);
    ordered.push(nodeId);
    for (const childId of node.childIds) {
      const problem = visit(childId, nodeId);
      if (problem) return problem;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return null;
  };

  const problem = visit(rootNodeId, null);
  return problem
    ? failure("invalid-tree", problem)
    : { ok: true, nodeIds: ordered };
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  targetNodeId: string,
): boolean {
  const pending = [...(document.pagesById[pageId]?.rootNodeIds ?? [])];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    if (nodeId === targetNodeId) return true;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (node) pending.push(...node.childIds);
  }
  return false;
}

function isEffectivelyLocked(
  document: DesignDocument,
  nodeId: string,
): boolean {
  const visited = new Set<string>();
  let current: DesignNode | undefined = document.nodesById[nodeId];
  while (current && !visited.has(current.id)) {
    if (current.locked) return true;
    visited.add(current.id);
    current = current.parentId
      ? document.nodesById[current.parentId]
      : undefined;
  }
  return false;
}

function nodeReferencesAsset(node: DesignNode): boolean {
  if (node.kind === "image") return true;
  if (
    node.kind !== "frame" &&
    node.kind !== "rectangle" &&
    node.kind !== "ellipse" &&
    node.kind !== "line" &&
    node.kind !== "text" &&
    node.kind !== "path" &&
    node.kind !== "vector" &&
    node.kind !== "boolean"
  ) {
    return false;
  }
  return [...node.properties.fills, ...node.properties.strokes].some(
    (paint) => paint.type === "image",
  );
}

function isFiniteTransform(value: readonly number[]): value is Transform {
  return value.length === 6 && value.every(Number.isFinite);
}

function readNodeId(node: unknown): string {
  if (
    typeof node === "object" &&
    node !== null &&
    "id" in node &&
    typeof node.id === "string"
  ) {
    return node.id;
  }
  return "<unknown>";
}

function failure(
  code: SvgImportOperationFailureCode,
  message: string,
): Extract<SvgImportOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
