import { projectComponentInstances } from "@opendesign/component-service";
import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import { materializeSharedStyles } from "@opendesign/style-service";
import { materializeVariableBindings } from "@opendesign/variable-service";
import {
  flattenFailure,
  type FlattenFailure,
} from "./vector-flatten-internal.js";

export function projectFlattenAppearance(
  document: DesignDocument,
  roots: readonly DesignNode[],
): { ok: true; document: DesignDocument } | FlattenFailure {
  const component = projectSelectedComponents(document, roots);
  if (!component.ok) return component;
  const projectedRoots = roots.map(
    (node) => component.document.nodesById[node.id] ?? node,
  );
  const nodeIds = flattenSubtreeNodeIds(component.document, projectedRoots);
  const styles = materializeSharedStyles(component.document);
  const styleIssue = styles.issues.find(
    (issue) => issue.nodeId && nodeIds.has(issue.nodeId),
  );
  if (styleIssue) {
    return flattenFailure("unsupported-topology", styleIssue.message);
  }
  const variables = materializeVariableBindings(styles.document);
  const variableIssue = variables.issues.find((issue) =>
    [...nodeIds].some((nodeId) => issueTargetsNode(issue.path, nodeId)),
  );
  return variableIssue
    ? flattenFailure("unsupported-topology", variableIssue.message)
    : { ok: true, document: variables.document };
}

function projectSelectedComponents(
  document: DesignDocument,
  roots: readonly DesignNode[],
): { ok: true; document: DesignDocument } | FlattenFailure {
  const scope = componentProjectionScope(document, roots);
  if (!scope.required) return { ok: true, document };
  try {
    const projected = projectComponentInstances(document);
    const issue = projected.issues.find((entry) =>
      scope.instanceIds.has(entry.instanceId),
    );
    return issue
      ? flattenFailure("unsupported-topology", issue.message)
      : { ok: true, document: projected.document };
  } catch (error) {
    return flattenFailure(
      "unsupported-topology",
      error instanceof Error
        ? error.message
        : "The selected Component projection cannot be resolved",
    );
  }
}

function componentProjectionScope(
  document: DesignDocument,
  roots: readonly DesignNode[],
): { required: boolean; instanceIds: ReadonlySet<string> } {
  const pending = [...roots];
  const visited = new Set<string>();
  const instanceIds = new Set<string>();
  let required = false;
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || visited.has(node.id)) continue;
    visited.add(node.id);
    if (node.kind === "instance" || node.componentPropertyReferences) {
      required = true;
    }
    if (node.kind === "instance") instanceIds.add(node.id);
    node.childIds.forEach((childId) =>
      pending.push(document.nodesById[childId]!),
    );
  }
  return { required, instanceIds };
}

function flattenSubtreeNodeIds(
  document: DesignDocument,
  roots: readonly DesignNode[],
): ReadonlySet<string> {
  const pending = [...roots];
  const nodeIds = new Set<string>();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || nodeIds.has(node.id)) continue;
    nodeIds.add(node.id);
    node.childIds.forEach((childId) =>
      pending.push(document.nodesById[childId]!),
    );
  }
  return nodeIds;
}

function jsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function issueTargetsNode(path: string, nodeId: string): boolean {
  const prefix = `/nodesById/${jsonPointer(nodeId)}`;
  return path === prefix || path.startsWith(`${prefix}/`);
}
