import {
  componentSourcePathKey,
  resolveComponentInstance,
} from "@opendesign/component-service";
import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import {
  MAX_DESIGN_SYSTEM_CATALOG_CHARACTERS,
  MAX_DESIGN_SYSTEM_CATALOG_COMPONENTS,
  MAX_DESIGN_SYSTEM_CATALOG_PROPERTIES,
  type DesignSystemComponentCatalog,
  type DesignSystemComponentCatalogEntry,
} from "../shared/design-system-component-catalog";

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
            componentPropertyOrder: [...component.componentPropertyOrder],
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
  return {
    componentCatalog: createComponentCatalog(
      document,
      nodeIds,
      scopedComponentIds,
    ),
    componentsById,
    instancesById,
    variantSetsById,
  };
}

function createComponentCatalog(
  document: DesignDocument,
  scopedNodeIds: ReadonlySet<string>,
  scopedComponentIds: ReadonlySet<string>,
): DesignSystemComponentCatalog {
  const usageCount = componentUsageCounts(document, undefined);
  const scopeUsageCount = componentUsageCounts(document, scopedNodeIds);
  const all = Object.values(document.componentsById)
    .map((component): DesignSystemComponentCatalogEntry => {
      const orderedPropertyNames = component.componentPropertyOrder.filter(
        (name) => component.componentPropertyDefinitions[name] !== undefined,
      );
      const properties = orderedPropertyNames
        .slice(0, MAX_DESIGN_SYSTEM_CATALOG_PROPERTIES)
        .map((name) => ({
          name,
          type: component.componentPropertyDefinitions[name].type,
        }));
      return {
        componentId: component.id,
        name: component.name,
        ...boundedDescription(component.description),
        availability: scopedComponentIds.has(component.id)
          ? "current-scope"
          : "design-file",
        usageCount: usageCount.get(component.id) ?? 0,
        scopeUsageCount: scopeUsageCount.get(component.id) ?? 0,
        ...(component.variantSetId
          ? { variantSetId: component.variantSetId }
          : {}),
        variantProperties: Object.fromEntries(
          Object.entries(component.variantProperties)
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, 12),
        ),
        properties,
        propertiesTruncated:
          orderedPropertyNames.length > MAX_DESIGN_SYSTEM_CATALOG_PROPERTIES,
      };
    })
    .sort(
      (left, right) =>
        Number(right.availability === "current-scope") -
          Number(left.availability === "current-scope") ||
        right.scopeUsageCount - left.scopeUsageCount ||
        right.usageCount - left.usageCount ||
        left.name.localeCompare(right.name) ||
        left.componentId.localeCompare(right.componentId),
    );
  const components: DesignSystemComponentCatalogEntry[] = [];
  let serializedCharacters = 2;
  for (const component of all) {
    if (components.length >= MAX_DESIGN_SYSTEM_CATALOG_COMPONENTS) break;
    const characters = JSON.stringify(component).length + 1;
    if (
      serializedCharacters + characters >
      MAX_DESIGN_SYSTEM_CATALOG_CHARACTERS
    ) {
      continue;
    }
    components.push(component);
    serializedCharacters += characters;
  }
  return {
    totalCount: all.length,
    truncated: all.length > components.length,
    components,
  };
}

function boundedDescription(
  description: string | undefined,
): Pick<
  DesignSystemComponentCatalogEntry,
  "description" | "descriptionTruncated"
> {
  if (!description) return {};
  if (description.length <= 240) return { description };
  return {
    description: `${description.slice(0, 239)}…`,
    descriptionTruncated: true,
  };
}

function componentUsageCounts(
  document: DesignDocument,
  scope: ReadonlySet<string> | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of Object.values(document.nodesById)) {
    if (node.kind !== "instance" || (scope && !scope.has(node.id))) continue;
    const componentId = node.properties.componentId;
    counts.set(componentId, (counts.get(componentId) ?? 0) + 1);
  }
  return counts;
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
