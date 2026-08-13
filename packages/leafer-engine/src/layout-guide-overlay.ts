import type {
  DesignDocument,
  LayoutGuide,
  Transform,
} from "@opendesign/design-contracts";

export interface LayoutGuideAffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface LayoutGuideOverlaySpec {
  area: boolean;
  color: string;
  id: string;
  opacity: number;
  path: string;
}

export interface LayoutGuideOverlayElement {
  destroy(): void;
  remove(): void;
  set(properties: Record<string, unknown>): void;
}

export interface LayoutGuideOverlayLayer {
  add(element: LayoutGuideOverlayElement): void;
  visible?: boolean | number;
}

export function reconcileLayoutGuideElements(options: {
  areaIds: Set<string>;
  createElement: () => LayoutGuideOverlayElement;
  defaultColor: string;
  elements: Map<string, LayoutGuideOverlayElement>;
  fingerprint: string | null;
  layer: LayoutGuideOverlayLayer;
  plan: {
    fingerprint: string | null;
    specs: readonly LayoutGuideOverlaySpec[];
  };
}): { changed: boolean; fingerprint: string | null } {
  const {
    areaIds,
    createElement,
    defaultColor,
    elements,
    fingerprint,
    layer,
    plan,
  } = options;
  if (plan.fingerprint !== null && plan.fingerprint === fingerprint) {
    return { changed: false, fingerprint };
  }
  const expected = new Set<string>();
  for (const spec of plan.specs) {
    expected.add(spec.id);
    let element = elements.get(spec.id);
    if (!element) {
      element = createElement();
      elements.set(spec.id, element);
      layer.add(element);
    }
    if (spec.area) areaIds.add(spec.id);
    else areaIds.delete(spec.id);
    element.set(
      spec.area
        ? {
            fill: spec.color || defaultColor,
            path: spec.path,
            stroke: "rgba(0, 0, 0, 0)",
            strokeWidth: 0,
            opacity: spec.opacity,
          }
        : {
            fill: "rgba(0, 0, 0, 0)",
            path: spec.path,
            stroke: spec.color || defaultColor,
            opacity: spec.opacity,
          },
    );
  }
  for (const [id, element] of elements) {
    if (expected.has(id)) continue;
    element.remove();
    element.destroy();
    elements.delete(id);
    areaIds.delete(id);
  }
  layer.visible = expected.size > 0;
  return { changed: true, fingerprint: plan.fingerprint };
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
      area: guide.type !== "grid",
      color: guide.color,
      id: `${frame.id}:guide:${guide.id}`,
      opacity: guide.opacity,
      path:
        guide.type === "grid"
          ? uniformGridPath(frame.size.width, frame.size.height, guide.size)
          : axisGuidePath(frame.size.width, frame.size.height, guide),
    })),
  };
}

function axisGuidePath(
  frameWidth: number,
  frameHeight: number,
  guide: Exclude<LayoutGuide, { type: "grid" }>,
): string {
  const axisSize = guide.type === "columns" ? frameWidth : frameHeight;
  const crossSize = guide.type === "columns" ? frameHeight : frameWidth;
  const sectionSize =
    guide.alignment === "stretch"
      ? (axisSize - guide.margin * 2 - guide.gutter * (guide.count - 1)) /
        guide.count
      : guide.sectionSize;
  const span = sectionSize * guide.count + guide.gutter * (guide.count - 1);
  const origin =
    guide.alignment === "stretch"
      ? guide.margin
      : guide.alignment === "start"
        ? guide.offset
        : guide.alignment === "end"
          ? axisSize - guide.offset - span
          : (axisSize - span) / 2;
  return Array.from({ length: guide.count }, (_, index) => {
    const start = origin + index * (sectionSize + guide.gutter);
    const clippedStart = Math.max(0, start);
    const clippedEnd = Math.min(axisSize, start + sectionSize);
    if (clippedEnd <= clippedStart) return "";
    return guide.type === "columns"
      ? rectanglePath(clippedStart, 0, clippedEnd - clippedStart, crossSize)
      : rectanglePath(0, clippedStart, crossSize, clippedEnd - clippedStart);
  })
    .filter(Boolean)
    .join(" ");
}

function rectanglePath(
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
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
