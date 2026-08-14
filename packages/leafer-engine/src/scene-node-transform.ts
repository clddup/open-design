import type { DesignNode, Transform } from "@opendesign/design-contracts";

export function getVisibleWorldTransform(
  nodesById: Readonly<Record<string, DesignNode>>,
  nodeId: string,
): Transform | null {
  const chain: DesignNode[] = [];
  const visited = new Set<string>();
  let current = nodesById[nodeId];
  while (current) {
    if (visited.has(current.id) || !current.visible) return null;
    visited.add(current.id);
    chain.unshift(current);
    if (current.parentId === null) break;
    current = nodesById[current.parentId];
    if (!current) return null;
  }
  if (chain.length === 0) return null;
  return chain.reduce<Transform>(
    (world, item) => multiplyTransforms(world, item.transform),
    [1, 0, 0, 1, 0, 0],
  );
}

export function multiplyTransforms(
  left: Transform,
  right: Transform,
): Transform {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}
