import type { DesignDocument } from "@opendesign/design-contracts";
import { resolveVariableForConsumer } from "@opendesign/variable-service";

export function createScopedVariableInspection(
  document: DesignDocument,
  pageIds: readonly string[],
  nodesById: Record<string, DesignDocument["nodesById"][string]>,
) {
  const variableResolutionsByNodeId = Object.fromEntries(
    Object.values(nodesById).flatMap((node) => {
      const pageId = pageIds.find((candidate) =>
        pageNodeIds(document, candidate).has(node.id),
      );
      if (!pageId) return [];
      const bindings = nodeVariableBindings(node);
      if (Object.keys(bindings).length === 0) return [];
      return [
        [
          node.id,
          Object.fromEntries(
            Object.entries(bindings).map(([field, variableId]) => [
              field,
              resolveVariableForConsumer(document, variableId, {
                pageId,
                nodeId: node.id,
              }),
            ]),
          ),
        ],
      ];
    }),
  );

  return {
    variableCollectionOrder: [...document.variableCollectionOrder],
    variableCollectionsById: structuredClone(document.variableCollectionsById),
    variablesById: structuredClone(document.variablesById),
    variableResolutionsByNodeId,
    designSystemIds: {
      variableCollections: Object.keys(document.variableCollectionsById),
      variables: Object.keys(document.variablesById),
    },
  };
}

function nodeVariableBindings(
  node: DesignDocument["nodesById"][string],
): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const [field, alias] of Object.entries(node.boundVariables ?? {})) {
    bindings[field] = alias.id;
  }
  if (!hasPaintProperties(node)) return bindings;
  for (const paintField of ["fills", "strokes"] as const) {
    node.properties[paintField].forEach((paint, index) => {
      if (paint.type === "solid" && paint.boundVariables?.color) {
        bindings[`${paintField}.${index}.color`] =
          paint.boundVariables.color.id;
      }
    });
  }
  return bindings;
}

function hasPaintProperties(
  node: DesignDocument["nodesById"][string],
): node is Extract<
  DesignDocument["nodesById"][string],
  { properties: { fills: unknown } }
> {
  return "fills" in node.properties && "strokes" in node.properties;
}

function pageNodeIds(document: DesignDocument, pageId: string): Set<string> {
  const ids = new Set<string>();
  const visit = (nodeId: string) => {
    if (ids.has(nodeId)) return;
    ids.add(nodeId);
    document.nodesById[nodeId]?.childIds.forEach(visit);
  };
  document.pagesById[pageId]?.rootNodeIds.forEach(visit);
  return ids;
}
