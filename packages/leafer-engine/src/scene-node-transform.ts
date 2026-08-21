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

export function invertTransform(transform: Transform): Transform | null {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < Number.EPSILON) return null;
  const inverse = 1 / determinant;
  return [
    d * inverse,
    -b * inverse,
    -c * inverse,
    a * inverse,
    (c * f - d * e) * inverse,
    (b * e - a * f) * inverse,
  ];
}

export function transformPoint(
  point: { x: number; y: number },
  transform: Transform,
) {
  const [a, b, c, d, e, f] = transform;
  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
  };
}

/**
 * Conjugates one document-space transform into a Vector node's local space.
 * This keeps a shared transform box correct for nodes under different nested
 * translations, rotations and scales.
 */
export function documentTransformToLocal(
  worldTransform: Transform,
  documentTransform: Transform,
): Transform | null {
  const inverse = invertTransform(worldTransform);
  return inverse
    ? multiplyTransforms(
        inverse,
        multiplyTransforms(documentTransform, worldTransform),
      )
    : null;
}
