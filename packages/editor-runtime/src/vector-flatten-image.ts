import type {
  DesignDocument,
  ImageNode,
  ImagePaint,
  RectangleNode,
  Transform,
} from "@opendesign/design-contracts";
import { resolveImagePlacement } from "@opendesign/image-service";

export type FlattenImageNodeResult =
  { ok: true; node: RectangleNode } | { ok: false; message: string };

/** Converts Image-node placement into the same region-local image fill. */
export function flattenImageNode(
  document: DesignDocument,
  node: ImageNode,
  transform: Transform,
): FlattenImageNodeResult {
  const paint = imageNodePaint(document, node);
  if (!paint.ok) return paint;
  return {
    ok: true,
    node: {
      ...node,
      kind: "rectangle",
      transform,
      properties: {
        cornerRadius: node.properties.cornerRadius,
        fills: [paint.paint],
        strokes: [],
        strokeWidth: 0,
      },
    },
  };
}

function imageNodePaint(
  document: DesignDocument,
  node: ImageNode,
): { ok: true; paint: ImagePaint } | { ok: false; message: string } {
  const asset = document.assetsById[node.properties.assetId];
  if (!asset || asset.kind !== "image") {
    return {
      ok: false,
      message: `Image ${node.id} references missing asset ${node.properties.assetId}`,
    };
  }
  const common = {
    type: "image" as const,
    assetId: asset.id,
    opacity: 1,
    ...(node.properties.filters === undefined
      ? {}
      : { filters: structuredClone(node.properties.filters) }),
  };
  if (node.properties.placement.mode === "stretch") {
    return { ok: true, paint: { ...common, fit: "fill" } };
  }
  if (node.properties.placement.mode === "fit") {
    return { ok: true, paint: { ...common, fit: "contain" } };
  }
  if (!asset.size || asset.size.width <= 0 || asset.size.height <= 0) {
    return {
      ok: false,
      message: `Image ${node.id} requires positive source dimensions to flatten ${node.properties.placement.mode} placement`,
    };
  }
  const placement = resolveImagePlacement({
    placement: node.properties.placement,
    sourceSize: asset.size,
    targetSize: node.size,
  });
  if (placement.mode !== "clip") {
    return {
      ok: false,
      message: `Image ${node.id} placement did not resolve to crop geometry`,
    };
  }
  return {
    ok: true,
    paint: {
      ...common,
      fit: "crop",
      offset: structuredClone(placement.offset),
      rotation: placement.rotation,
      scale: structuredClone(placement.scale),
    },
  };
}
