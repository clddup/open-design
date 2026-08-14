import {
  componentSourcePathKey,
  resolveComponentInstance,
} from "@opendesign/component-service";
import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";

export function createScopedComponentInspection(
  document: DesignDocument,
  nodeIds: ReadonlySet<string>,
  nodesById: Readonly<Record<string, DesignNode>>,
) {
  const scopedComponentIds = collectScopedComponentIds(document, nodeIds);
  const componentsById = Object.fromEntries(
    [...scopedComponentIds].flatMap((componentId) => {
      const component = document.componentsById[componentId];
      if (!component) return [];
      return [
        [
          component.id,
          {
            id: component.id,
            name: component.name,
            rootNodeId: component.rootNodeId,
            componentPropertyDefinitions: structuredClone(
              component.componentPropertyDefinitions,
            ),
            ...(component.variantSetId
              ? { variantSetId: component.variantSetId }
              : {}),
            variantProperties: structuredClone(component.variantProperties),
            sourceNodeIds: [
              ...componentSourceNodeIdsForInspection(
                document,
                component.rootNodeId,
              ),
            ],
          },
        ],
      ] as const;
    }),
  );
  const scopedVariantSetIds = new Set(
    [...scopedComponentIds].flatMap((componentId) => {
      const variantSetId = document.componentsById[componentId]?.variantSetId;
      return variantSetId ? [variantSetId] : [];
    }),
  );
  const variantSetsById = Object.fromEntries(
    [...scopedVariantSetIds].flatMap((variantSetId) => {
      const variantSet = document.variantSetsById[variantSetId];
      if (!variantSet) return [];
      return [
        [
          variantSet.id,
          {
            id: variantSet.id,
            name: variantSet.name,
            rootNodeId: variantSet.rootNodeId,
            defaultComponentId: variantSet.defaultComponentId,
            propertyOrder: [...variantSet.propertyOrder],
            componentPropertyDefinitions: structuredClone(
              variantSet.componentPropertyDefinitions,
            ),
            componentIds: Object.values(document.componentsById)
              .filter((component) => component.variantSetId === variantSet.id)
              .map((component) => component.id),
          },
        ],
      ] as const;
    }),
  );
  const instancesById: Record<string, unknown> = {};
  for (const node of Object.values(nodesById)) {
    if (node.kind !== "instance") continue;
    const resolution = resolveComponentInstance(document, node.id);
    instancesById[node.id] = !resolution.ok
      ? {
          componentId: node.properties.componentId,
          propertyAssignments: structuredClone(
            node.properties.componentProperties,
          ),
          issues: resolution.issues,
        }
      : {
          componentId: node.properties.componentId,
          resolvedComponentId: resolution.componentId,
          componentProperties: structuredClone(resolution.componentProperties),
          propertyAssignments: structuredClone(
            node.properties.componentProperties,
          ),
          overrides: structuredClone(node.properties.overrides),
          slots: structuredClone(resolution.slots),
          sourceNodes: resolution.overrideTargets.map((resolved) => ({
            sourcePath: [...resolved.sourcePath],
            sourceNodeId: resolved.sourceNodeId,
            kind: resolved.node.kind,
            name: resolved.node.name,
            componentPropertyReferences: structuredClone(
              document.nodesById[resolved.sourceNodeId]
                ?.componentPropertyReferences ?? {},
            ),
            projectionId:
              resolution.nodes.find(
                (candidate) =>
                  componentSourcePathKey(candidate.sourcePath) ===
                  componentSourcePathKey(resolved.sourcePath),
              )?.projectionId ?? null,
          })),
        };
  }
  return { componentsById, instancesById, variantSetsById };
}

function componentSourceNodeIdsForInspection(
  document: DesignDocument,
  rootNodeId: string,
): Set<string> {
  const result = new Set<string>();
  const visit = (nodeId: string) => {
    if (result.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;
    result.add(nodeId);
    node.childIds.forEach(visit);
  };
  visit(rootNodeId);
  return result;
}

function collectScopedComponentIds(
  document: DesignDocument,
  nodeIds: ReadonlySet<string>,
): Set<string> {
  const componentIds = new Set<string>();
  const pending = Object.values(document.componentsById)
    .filter((component) => nodeIds.has(component.rootNodeId))
    .map((component) => component.id);
  for (const nodeId of nodeIds) {
    const node = document.nodesById[nodeId];
    if (node?.kind === "instance") pending.push(node.properties.componentId);
  }
  while (pending.length > 0) {
    const componentId = pending.pop();
    if (!componentId || componentIds.has(componentId)) continue;
    componentIds.add(componentId);
    for (const sourceNodeId of componentSourceNodeIdsForInspection(
      document,
      document.componentsById[componentId]?.rootNodeId ?? "",
    )) {
      const source = document.nodesById[sourceNodeId];
      if (source?.kind === "instance")
        pending.push(source.properties.componentId);
    }
  }
  return componentIds;
}
