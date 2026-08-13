import type { DesignDocument, Transform } from "@opendesign/design-contracts";

export interface LayoutGuideAffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface LayoutGuideOverlaySpec {
  color: string;
  id: string;
  opacity: number;
  path: string;
}

export function createLayoutGuideOverlayPlan(
  document: DesignDocument,
  frameId: string | undefined,
): {
  fingerprint: string | null;
  specs: LayoutGuideOverlaySpec[];
} {
  const frame = frameId ? document.nodesById[frameId] : undefined;
  if (frame?.kind !== "frame") return { fingerprint: null, specs: [] };
  const guides = frame.properties.layoutGuides ?? [];
  const world = layoutGuideWorldTransform(document, frame.id);
  return {
    fingerprint: JSON.stringify({
      frameId: frame.id,
      guides,
      size: frame.size,
      world,
    }),
    specs: guides.map((guide) => ({
      color: guide.color,
      id: `${frame.id}:guide:${guide.id}`,
      opacity: guide.opacity,
      path: uniformGridPath(frame.size.width, frame.size.height, guide.size),
    })),
  };
}

export function layoutGuideDocumentTransform(
  document: DesignDocument,
  frameId: string,
  viewport: LayoutGuideAffineMatrix,
): LayoutGuideAffineMatrix {
  const world = layoutGuideWorldTransform(document, frameId);
  const right: LayoutGuideAffineMatrix = {
    a: world[0],
    b: world[1],
    c: world[2],
    d: world[3],
    e: world[4],
    f: world[5],
  };
  return {
    a: viewport.a * right.a + viewport.c * right.b,
    b: viewport.b * right.a + viewport.d * right.b,
    c: viewport.a * right.c + viewport.c * right.d,
    d: viewport.b * right.c + viewport.d * right.d,
    e: viewport.a * right.e + viewport.c * right.f + viewport.e,
    f: viewport.b * right.e + viewport.d * right.f + viewport.f,
  };
}

function uniformGridPath(width: number, height: number, step: number): string {
  const parts: string[] = [];
  let lineCount = 0;
  for (let x = step; x < width && lineCount < 4_096; x += step) {
    parts.push(`M ${x} 0 L ${x} ${height}`);
    lineCount += 1;
  }
  for (let y = step; y < height && lineCount < 4_096; y += step) {
    parts.push(`M 0 ${y} L ${width} ${y}`);
    lineCount += 1;
  }
  return parts.join(" ");
}

function layoutGuideWorldTransform(
  document: DesignDocument,
  nodeId: string,
): Transform {
  const chain: Transform[] = [];
  const visited = new Set<string>();
  let current = document.nodesById[nodeId];
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.unshift(current.transform);
    if (current.parentId === null) break;
    current = document.nodesById[current.parentId];
  }
  return chain.reduce(
    (world, transform) => [
      world[0] * transform[0] + world[2] * transform[1],
      world[1] * transform[0] + world[3] * transform[1],
      world[0] * transform[2] + world[2] * transform[3],
      world[1] * transform[2] + world[3] * transform[3],
      world[0] * transform[4] + world[2] * transform[5] + world[4],
      world[1] * transform[4] + world[3] * transform[5] + world[5],
    ],
    [1, 0, 0, 1, 0, 0] as Transform,
  );
}
