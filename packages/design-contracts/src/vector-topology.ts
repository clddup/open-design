import type { VectorNetwork } from "./public-types.js";

export function vectorNetworkHasBranches(network: VectorNetwork): boolean {
  const degrees = new Map<string, number>();
  for (const segment of network.segments) {
    degrees.set(
      segment.startVertexId,
      (degrees.get(segment.startVertexId) ?? 0) + 1,
    );
    degrees.set(
      segment.endVertexId,
      (degrees.get(segment.endVertexId) ?? 0) + 1,
    );
  }
  return [...degrees.values()].some((degree) => degree > 2);
}
