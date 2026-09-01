import type { VectorNetwork } from "@opendesign/design-contracts";

export type VectorLineSide = -1 | 1;

type ConnectivityFailure = {
  ok: false;
  code: "no-op" | "unsupported-topology";
  message: string;
};

export type ConnectedLineCutOwnershipResult =
  { ok: true; extractedPathIds: readonly string[] } | ConnectivityFailure;

interface LineCutPathComponent {
  affected: boolean;
  groupId: string;
  pathIds: readonly string[];
  side?: VectorLineSide;
}

export function resolveConnectedLineCutOwnership(
  network: VectorNetwork,
  partitionPathIds: ReadonlySet<string>,
  extractedSeedPathIds: ReadonlySet<string>,
  pathGroupById: ReadonlyMap<string, string>,
  pathSide: (pathId: string) => VectorLineSide | null,
): ConnectedLineCutOwnershipResult {
  const components: LineCutPathComponent[] = [];
  for (const pathIds of pathConnectivityGroups(network).values()) {
    const resolved = resolveLineCutPathComponent(
      pathIds,
      partitionPathIds,
      pathGroupById,
      pathSide,
    );
    if (!resolved.ok) return resolved;
    components.push(resolved.component);
  }
  const extracted = resolveExtractedComponents(
    network,
    components,
    partitionPathIds,
    extractedSeedPathIds,
    pathGroupById,
  );
  if (!extracted.ok) return extracted;
  return {
    ok: true,
    extractedPathIds: network.paths
      .map((path) => path.id)
      .filter((pathId) => extracted.pathIds.has(pathId)),
  };
}

function resolveExtractedComponents(
  network: VectorNetwork,
  components: readonly LineCutPathComponent[],
  partitionPathIds: ReadonlySet<string>,
  extractedSeedPathIds: ReadonlySet<string>,
  pathGroupById: ReadonlyMap<string, string>,
): { ok: true; pathIds: ReadonlySet<string> } | ConnectivityFailure {
  const extracted = new Set<string>();
  for (const groupId of new Set(components.map((item) => item.groupId))) {
    const grouped = components.filter((item) => item.groupId === groupId);
    const affected = grouped.filter((item) => item.affected);
    if (affected.length === 0) continue;
    const retainedSide = resolveRetainedSide(
      network,
      affected,
      groupId,
      partitionPathIds,
      extractedSeedPathIds,
      pathGroupById,
    );
    if (retainedSide === undefined) {
      return unsupported(
        `Drag Cut could not resolve a retained side for connected path group ${groupId}`,
      );
    }
    for (const component of affected) {
      if (component.side === retainedSide) continue;
      for (const pathId of component.pathIds) extracted.add(pathId);
    }
  }
  return extracted.size > 0
    ? { ok: true, pathIds: extracted }
    : noOp("Drag Cut did not separate the connected vector network");
}

function resolveRetainedSide(
  network: VectorNetwork,
  components: readonly LineCutPathComponent[],
  groupId: string,
  partitionPathIds: ReadonlySet<string>,
  extractedSeedPathIds: ReadonlySet<string>,
  pathGroupById: ReadonlyMap<string, string>,
): VectorLineSide | undefined {
  const anchorPathId = network.paths.find(
    (path) =>
      pathGroupById.get(path.id) === groupId &&
      partitionPathIds.has(path.id) &&
      !extractedSeedPathIds.has(path.id),
  )?.id;
  return components.find((item) => item.pathIds.includes(anchorPathId ?? ""))
    ?.side;
}

function resolveLineCutPathComponent(
  pathIds: readonly string[],
  partitionPathIds: ReadonlySet<string>,
  pathGroupById: ReadonlyMap<string, string>,
  pathSide: (pathId: string) => VectorLineSide | null,
): { ok: true; component: LineCutPathComponent } | ConnectivityFailure {
  const groupIds = new Set(
    pathIds.map((pathId) => pathGroupById.get(pathId)).filter(Boolean),
  );
  if (groupIds.size !== 1 || groupIds.has(undefined)) {
    return unsupported(
      "Drag Cut produced a path component with ambiguous source ownership",
    );
  }
  const groupId = [...groupIds][0];
  if (!groupId) {
    return unsupported("Drag Cut path component has no source ownership");
  }
  const affectedPathIds = pathIds.filter((pathId) =>
    partitionPathIds.has(pathId),
  );
  if (affectedPathIds.length === 0) {
    return {
      ok: true,
      component: { affected: false, groupId, pathIds },
    };
  }
  const sides = new Set(affectedPathIds.map(pathSide));
  if (sides.size !== 1 || sides.has(null)) {
    return unsupported(
      `Drag Cut path component ${affectedPathIds.join(", ")} spans both sides of the cut`,
    );
  }
  return {
    ok: true,
    component: {
      affected: true,
      groupId,
      pathIds,
      side: [...sides][0]!,
    },
  };
}

export function pathConnectivityGroups(
  network: VectorNetwork,
): ReadonlyMap<string, readonly string[]> {
  const adjacency = new Map(
    network.paths.map((path) => [path.id, new Set<string>()]),
  );
  const ownersByVertex = pathOwnersByVertex(network);
  for (const owners of ownersByVertex.values()) {
    connectPathOwners(adjacency, owners);
  }
  for (const region of network.regions) {
    connectPathOwners(
      adjacency,
      region.loops.map((loop) => loop.pathId),
    );
  }
  return collectPathGroups(network, adjacency);
}

export function sharedPathVertexIds(
  network: VectorNetwork,
): ReadonlySet<string> {
  return new Set(
    [...pathOwnersByVertex(network)]
      .filter(([, pathIds]) => pathIds.length > 1)
      .map(([vertexId]) => vertexId),
  );
}

function pathOwnersByVertex(
  network: VectorNetwork,
): ReadonlyMap<string, readonly string[]> {
  const segments = new Map(
    network.segments.map((segment) => [segment.id, segment]),
  );
  const owners = new Map<string, string[]>();
  for (const path of network.paths) {
    const vertexIds = new Set(
      path.segments.flatMap((reference) => {
        const segment = segments.get(reference.segmentId);
        return segment
          ? [segment.startVertexId, segment.endVertexId]
          : ([] as string[]);
      }),
    );
    for (const vertexId of vertexIds) {
      owners.set(vertexId, [...(owners.get(vertexId) ?? []), path.id]);
    }
  }
  return owners;
}

function connectPathOwners(
  adjacency: Map<string, Set<string>>,
  pathIds: readonly string[],
): void {
  const first = pathIds[0];
  if (!first) return;
  for (const pathId of pathIds.slice(1)) {
    adjacency.get(first)?.add(pathId);
    adjacency.get(pathId)?.add(first);
  }
}

function collectPathGroups(
  network: VectorNetwork,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, readonly string[]> {
  const groups = new Map<string, readonly string[]>();
  const visited = new Set<string>();
  for (const path of network.paths) {
    if (visited.has(path.id)) continue;
    const pathIds: string[] = [];
    const pending = [path.id];
    while (pending.length > 0) {
      const pathId = pending.shift()!;
      if (visited.has(pathId)) continue;
      visited.add(pathId);
      pathIds.push(pathId);
      pending.push(...(adjacency.get(pathId) ?? []));
    }
    groups.set(path.id, pathIds);
  }
  return groups;
}

function unsupported(message: string): ConnectivityFailure {
  return { ok: false, code: "unsupported-topology", message };
}

function noOp(message: string): ConnectivityFailure {
  return { ok: false, code: "no-op", message };
}
