import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
} from "@opendesign/design-contracts";

export type SmartSelectionClones = {
  nodes: DesignNode[];
  rootIds: string[];
};

export function cloneSmartSelectionSubtrees(
  document: DesignDocument,
  rootIds: readonly string[],
  prefix: string,
): SmartSelectionClones {
  const idMap = collectCloneIds(document, rootIds, prefix);
  const nodes = [...idMap.keys()].map((id) => cloneNode(document, idMap, id));
  return { nodes, rootIds: rootIds.map((id) => idMap.get(id)!) };
}

export function attachSmartSelectionClones(
  document: DesignDocument,
  pageId: string,
  clones: SmartSelectionClones,
): void {
  clones.nodes.forEach((node) => {
    document.nodesById[node.id] = structuredClone(node);
  });
  for (const rootId of clones.rootIds) {
    const root = document.nodesById[rootId]!;
    if (root.parentId) document.nodesById[root.parentId]?.childIds.push(rootId);
    else document.pagesById[pageId]?.rootNodeIds.push(rootId);
  }
}

export function smartSelectionCloneInsertCommands(
  document: DesignDocument,
  pageId: string,
  clones: SmartSelectionClones,
  prefix: string,
): DesignOperation[] {
  return clones.nodes.map((source, index) => {
    const node = structuredClone(document.nodesById[source.id]!);
    node.childIds = [];
    const siblings = node.parentId
      ? document.nodesById[node.parentId]?.childIds
      : document.pagesById[pageId]?.rootNodeIds;
    return {
      commandId: `${prefix}_${index}`,
      type: "insert_element",
      pageId,
      parentId: node.parentId,
      index: Math.max(0, siblings?.indexOf(source.id) ?? 0),
      node,
    };
  });
}

function collectCloneIds(
  document: DesignDocument,
  rootIds: readonly string[],
  prefix: string,
): Map<string, string> {
  const idMap = new Map<string, string>();
  const reservedIds = new Set(Object.keys(document.nodesById));
  const visit = (id: string) => {
    if (idMap.has(id)) return;
    const node = document.nodesById[id];
    if (!node) return;
    const nextId = allocateCloneId(prefix, reservedIds);
    idMap.set(id, nextId);
    reservedIds.add(nextId);
    node.childIds.forEach(visit);
  };
  rootIds.forEach(visit);
  return idMap;
}

function cloneNode(
  document: DesignDocument,
  idMap: ReadonlyMap<string, string>,
  id: string,
): DesignNode {
  const node = structuredClone(document.nodesById[id]!);
  node.id = idMap.get(id)!;
  node.parentId = idMap.get(node.parentId ?? "") ?? node.parentId;
  node.childIds = node.childIds.map((childId) => idMap.get(childId)!);
  node.name = `${node.name} copy`.trim();
  return node;
}

function allocateCloneId(
  prefix: string,
  reservedIds: ReadonlySet<string>,
): string {
  let sequence = 1;
  while (reservedIds.has(`${prefix}_${sequence}`)) sequence += 1;
  return `${prefix}_${sequence}`;
}
