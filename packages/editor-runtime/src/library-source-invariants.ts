import {
  nodePaints,
  type ComponentDefinition,
  type DesignAsset,
  type DesignDocument,
  type DesignNode,
  type LibraryComponentSource,
} from "@opendesign/design-contracts";
import type { DocumentInvariantIssue } from "./layout-document-invariants.js";
import {
  styleCanApply,
  styleDefinition,
  styleTypeForReference,
} from "@opendesign/style-service";

export function validateLibrarySourceInvariants(
  document: DesignDocument,
): DocumentInvariantIssue[] {
  const issues: DocumentInvariantIssue[] = [];
  const assetsById = new Map<string, DesignAsset>(
    Object.entries(document.assetsById),
  );

  for (const [componentId, source] of Object.entries(
    document.libraryComponentsById,
  )) {
    const path = `/libraryComponentsById/${escapeJsonPointer(componentId)}`;
    if (document.componentsById[componentId]) {
      issues.push({
        path,
        message: "library component id conflicts with a local component",
      });
    }
    if (source.component.id !== componentId) {
      issues.push({
        path: `${path}/component/id`,
        message: "library component id must match its map key",
      });
    }
    validateSourceTree(source, path, issues);
    validateSourceDependencies(document, source, path, issues);
    validateSourceAssets(source, path, assetsById, issues);
    validateSourceStyles(document, source, path, issues);
  }

  for (const [variantSetId, source] of Object.entries(
    document.libraryVariantSetsById,
  )) {
    const path = `/libraryVariantSetsById/${escapeJsonPointer(variantSetId)}`;
    if (document.variantSetsById[variantSetId]) {
      issues.push({
        path,
        message: "library variant set id conflicts with a local variant set",
      });
    }
    if (source.variantSet.id !== variantSetId) {
      issues.push({
        path: `${path}/variantSet/id`,
        message: "library variant set id must match its map key",
      });
    }
    const members = componentDefinitions(document).filter(
      (component) => component.variantSetId === variantSetId,
    );
    if (members.length === 0) {
      issues.push({
        path: `${path}/variantSet`,
        message: "library variant set must contain at least one component",
      });
    }
    if (
      !members.some(
        (component) => component.id === source.variantSet.defaultComponentId,
      )
    ) {
      issues.push({
        path: `${path}/variantSet/defaultComponentId`,
        message:
          "library variant set default must reference one of its components",
      });
    }
  }

  return issues;
}

function validateSourceTree(
  source: LibraryComponentSource,
  path: string,
  issues: DocumentInvariantIssue[],
): void {
  const rootId = source.component.rootNodeId;
  const root = source.nodesById[rootId];
  if (!root) {
    issues.push({
      path: `${path}/component/rootNodeId`,
      message: `library component root ${rootId} does not exist in its source bundle`,
    });
    return;
  }
  if (root.kind !== "frame" && root.kind !== "group") {
    issues.push({
      path: `${path}/component/rootNodeId`,
      message: "library component roots must be Frames or Groups",
    });
  }
  if (root.parentId !== null) {
    issues.push({
      path: `${path}/nodesById/${escapeJsonPointer(rootId)}/parentId`,
      message: "library component root parent must be null inside its bundle",
    });
  }

  const occurrences = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (nodeId: string, expectedParentId: string | null): void => {
    const node = source.nodesById[nodeId];
    if (!node) {
      issues.push({
        path: `${path}/nodesById/${escapeJsonPointer(nodeId)}`,
        message: `library source node ${nodeId} does not exist`,
      });
      return;
    }
    occurrences.set(nodeId, (occurrences.get(nodeId) ?? 0) + 1);
    if (node.parentId !== expectedParentId) {
      issues.push({
        path: `${path}/nodesById/${escapeJsonPointer(nodeId)}/parentId`,
        message: `expected source parent ${expectedParentId ?? "null"}`,
      });
    }
    if (visiting.has(nodeId)) {
      issues.push({
        path: `${path}/nodesById/${escapeJsonPointer(nodeId)}`,
        message: "library source tree contains a cycle",
      });
      return;
    }
    if ((occurrences.get(nodeId) ?? 0) > 1) return;
    visiting.add(nodeId);
    for (const childId of node.childIds) visit(childId, nodeId);
    visiting.delete(nodeId);
  };
  visit(rootId, null);

  for (const [nodeId, node] of Object.entries(source.nodesById)) {
    const nodePath = `${path}/nodesById/${escapeJsonPointer(nodeId)}`;
    if (node.id !== nodeId) {
      issues.push({
        path: `${nodePath}/id`,
        message: "library source node id must match its map key",
      });
    }
    const count = occurrences.get(nodeId) ?? 0;
    if (count === 0) {
      issues.push({
        path: nodePath,
        message: "library source node is not reachable from its component root",
      });
    } else if (count > 1) {
      issues.push({
        path: nodePath,
        message: "library source node appears more than once in its bundle",
      });
    }
  }
}

function validateSourceDependencies(
  document: DesignDocument,
  source: LibraryComponentSource,
  path: string,
  issues: DocumentInvariantIssue[],
): void {
  const declared = new Set(source.dependencyComponentIds);
  const used = new Set<string>();
  for (const node of Object.values(source.nodesById)) {
    if (node.kind !== "instance") continue;
    used.add(node.properties.componentId);
    if (!declared.has(node.properties.componentId)) {
      issues.push({
        path: `${path}/nodesById/${escapeJsonPointer(node.id)}/properties/componentId`,
        message: `nested component ${node.properties.componentId} is missing from dependencyComponentIds`,
      });
    }
  }
  for (const definition of Object.values(
    source.component.componentPropertyDefinitions,
  )) {
    if (definition.type === "INSTANCE_SWAP") {
      used.add(definition.defaultValue);
    }
    if (definition.type !== "INSTANCE_SWAP" && definition.type !== "SLOT") {
      continue;
    }
    for (const preferred of definition.preferredValues ?? []) {
      if (preferred.type === "COMPONENT") used.add(preferred.key);
    }
  }
  for (const [index, componentId] of source.dependencyComponentIds.entries()) {
    if (componentId === source.component.id) {
      issues.push({
        path: `${path}/dependencyComponentIds/${index}`,
        message: "library component cannot depend on itself",
      });
    }
    if (!componentDefinition(document, componentId)) {
      issues.push({
        path: `${path}/dependencyComponentIds/${index}`,
        message: `dependency component ${componentId} does not exist`,
      });
    }
    if (!used.has(componentId)) {
      issues.push({
        path: `${path}/dependencyComponentIds/${index}`,
        message: `dependency component ${componentId} is not used by the source tree`,
      });
    }
  }
}

function validateSourceAssets(
  source: LibraryComponentSource,
  path: string,
  assetsById: Map<string, DesignAsset>,
  issues: DocumentInvariantIssue[],
): void {
  for (const [assetId, asset] of Object.entries(source.assetsById)) {
    const assetPath = `${path}/assetsById/${escapeJsonPointer(assetId)}`;
    if (asset.id !== assetId) {
      issues.push({
        path: `${assetPath}/id`,
        message: "library asset id must match its map key",
      });
    }
    const existing = assetsById.get(assetId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(asset)) {
      issues.push({
        path: assetPath,
        message: `library asset ${assetId} conflicts with another asset payload`,
      });
    } else {
      assetsById.set(assetId, asset);
    }
  }
  for (const node of Object.values(source.nodesById)) {
    for (const assetId of nodeAssetIds(node)) {
      if (source.assetsById[assetId]) continue;
      issues.push({
        path: `${path}/nodesById/${escapeJsonPointer(node.id)}/properties`,
        message: `library source asset ${assetId} is missing from its source bundle`,
      });
    }
  }
}

function validateSourceStyles(
  document: DesignDocument,
  source: LibraryComponentSource,
  path: string,
  issues: DocumentInvariantIssue[],
): void {
  const fields = [
    "fillStyleId",
    "strokeStyleId",
    "effectStyleId",
    "textStyleId",
    "gridStyleId",
  ] as const;
  for (const node of Object.values(source.nodesById)) {
    const nodePath = `${path}/nodesById/${escapeJsonPointer(node.id)}`;
    for (const field of fields) {
      const styleId = node[field];
      if (!styleId) continue;
      const style = styleDefinition(document, styleId);
      if (!style) {
        issues.push({
          path: `${nodePath}/${field}`,
          message: `library source Style ${styleId} does not exist`,
        });
      } else if (!styleCanApply(node, field, style)) {
        issues.push({
          path: `${nodePath}/${field}`,
          message: `${field} requires a ${styleTypeForReference(field)} Style`,
        });
      }
    }
    if (node.kind !== "text") continue;
    for (const [index, run] of (node.properties.runs ?? []).entries()) {
      for (const [field, expectedType] of [
        ["textStyleId", "TEXT"],
        ["fillStyleId", "PAINT"],
      ] as const) {
        const styleId = run.style[field];
        if (!styleId) continue;
        if (styleDefinition(document, styleId)?.styleType !== expectedType) {
          issues.push({
            path: `${nodePath}/properties/runs/${index}/style/${field}`,
            message: `library source text run requires a ${expectedType} Style`,
          });
        }
      }
    }
  }
}

function componentDefinition(
  document: DesignDocument,
  componentId: string,
): ComponentDefinition | undefined {
  return (
    document.componentsById[componentId] ??
    document.libraryComponentsById[componentId]?.component
  );
}

function componentDefinitions(document: DesignDocument): ComponentDefinition[] {
  return [
    ...Object.values(document.componentsById),
    ...Object.values(document.libraryComponentsById).map(
      (source) => source.component,
    ),
  ];
}

function nodeAssetIds(node: DesignNode): string[] {
  const ids: string[] = [];
  if (node.kind === "image") ids.push(node.properties.assetId);
  for (const paint of nodePaints(node)) {
    if (paint.type === "image") ids.push(paint.assetId);
  }
  return ids;
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
