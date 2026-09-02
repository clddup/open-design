import type { VectorNetwork } from "@opendesign/design-contracts";

export function vectorNetworkSubset(
  network: VectorNetwork,
  pathIds: readonly string[],
): VectorNetwork {
  const includedPaths = new Set(pathIds);
  const paths = network.paths
    .filter((path) => includedPaths.has(path.id))
    .map((path) => structuredClone(path));
  const segmentIds = new Set(
    paths.flatMap((path) =>
      path.segments.map((reference) => reference.segmentId),
    ),
  );
  const segments = network.segments
    .filter((segment) => segmentIds.has(segment.id))
    .map((segment) => structuredClone(segment));
  const vertexIds = new Set(
    segments.flatMap((segment) => [segment.startVertexId, segment.endVertexId]),
  );
  return {
    vertices: network.vertices
      .filter((vertex) => vertexIds.has(vertex.id))
      .map((vertex) => structuredClone(vertex)),
    segments,
    paths,
    regions: network.regions
      .filter((region) =>
        region.loops.every((loop) => includedPaths.has(loop.pathId)),
      )
      .map((region) => structuredClone(region)),
  };
}
