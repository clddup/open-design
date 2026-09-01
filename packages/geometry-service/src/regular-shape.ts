import {
  resolveRegularPolygonPoints,
  resolveStarPoints,
  type DesignNode,
  type Point,
  type Rect,
  type VectorNetwork,
} from "@opendesign/design-contracts";
import { serializeVectorNetwork } from "./editable-vector.js";

type RegularShapeNode = Extract<DesignNode, { kind: "polygon" | "star" }>;

export type RegularShapeGeometryResult =
  | {
      ok: true;
      bounds: Rect;
      network: VectorNetwork;
      path: string;
    }
  | { ok: false; message: string };

/**
 * Builds one disposable Vector Network for live rendering, Boolean geometry,
 * Flatten, and interchange. Figma applies Star cornerRadius to outer tips;
 * Polygon applies it to every authored vertex.
 */
export function resolveRegularShapeGeometry(
  node: RegularShapeNode,
): RegularShapeGeometryResult {
  const smoothing = node.properties.cornerSmoothing ?? 0;
  const points = regularShapePoints(node);
  const network = regularShapeNetwork(
    node.kind,
    points,
    node.properties.cornerRadius,
  );
  const serialized = serializeVectorNetwork(network, 0, smoothing);
  return serialized.ok
    ? {
        ok: true,
        bounds: serialized.bounds,
        network,
        path: serialized.path,
      }
    : {
        ok: false,
        message:
          serialized.issues[0]?.message ?? "Regular shape geometry is invalid",
      };
}

function regularShapePoints(node: RegularShapeNode): Point[] {
  return node.kind === "polygon"
    ? resolveRegularPolygonPoints(node.size, node.properties.pointCount)
    : resolveStarPoints(
        node.size,
        node.properties.pointCount,
        node.properties.innerRadius,
      );
}

function regularShapeNetwork(
  kind: RegularShapeNode["kind"],
  points: readonly Point[],
  cornerRadius: number,
): VectorNetwork {
  const vertices = points.map((point, index) => ({
    id: `regular_vertex_${index}`,
    x: point.x,
    y: point.y,
    ...((kind === "polygon" || index % 2 === 0) && cornerRadius > 0
      ? { cornerRadius }
      : {}),
  }));
  const segments = points.map((_, index) => ({
    id: `regular_segment_${index}`,
    startVertexId: vertices[index]!.id,
    endVertexId: vertices[(index + 1) % vertices.length]!.id,
  }));
  return {
    vertices,
    segments,
    paths: [
      {
        id: "regular_path",
        closed: true,
        segments: segments.map((segment) => ({
          segmentId: segment.id,
          reversed: false,
        })),
      },
    ],
    regions: [
      {
        id: "regular_region",
        windingRule: "nonzero",
        loops: [{ pathId: "regular_path", reversed: false }],
      },
    ],
  };
}
