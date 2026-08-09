import type {
  DesignDocument,
  DesignNode,
  Point,
  Rect,
  Transform,
  ViewportState,
} from "@opendesign/design-contracts";

export const IDENTITY_TRANSFORM: Transform = [1, 0, 0, 1, 0, 0];

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

export function transformPoint(point: Point, transform: Transform): Point {
  const [a, b, c, d, e, f] = transform;
  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
  };
}

export function documentToScreen(point: Point, viewport: ViewportState): Point {
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY,
  };
}

export function screenToDocument(point: Point, viewport: ViewportState): Point {
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom,
  };
}

export function getWorldTransform(
  document: DesignDocument,
  nodeId: string,
): Transform | null {
  const chain: DesignNode[] = [];
  const seen = new Set<string>();
  let node: DesignNode | undefined = document.nodesById[nodeId];
  while (node) {
    if (seen.has(node.id)) return null;
    seen.add(node.id);
    chain.push(node);
    node = node.parentId ? document.nodesById[node.parentId] : undefined;
  }
  if (chain.length === 0) return null;

  return chain
    .reverse()
    .reduce<Transform>(
      (world, item) => multiplyTransforms(world, item.transform),
      IDENTITY_TRANSFORM,
    );
}

export function getNodeBounds(
  document: DesignDocument,
  nodeId: string,
): Rect | null {
  const node = document.nodesById[nodeId];
  const transform = getWorldTransform(document, nodeId);
  if (!node || !transform) return null;
  const corners = [
    transformPoint({ x: 0, y: 0 }, transform),
    transformPoint({ x: node.size.width, y: 0 }, transform),
    transformPoint({ x: 0, y: node.size.height }, transform),
    transformPoint({ x: node.size.width, y: node.size.height }, transform),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function getSelectionBounds(
  document: DesignDocument,
  nodeIds: readonly string[],
): Rect | null {
  const bounds = nodeIds
    .map((nodeId) => getNodeBounds(document, nodeId))
    .filter((value): value is Rect => value !== null);
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map((rect) => rect.x));
  const minY = Math.min(...bounds.map((rect) => rect.y));
  const maxX = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...bounds.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
