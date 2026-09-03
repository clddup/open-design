import type { Point } from "@opendesign/design-contracts";
import type {
  VectorFillRule,
  VectorGeometryProvider,
  VectorPathInput,
} from "./vector-path.js";

export type ShapeBuilderRegionSplitResult<T> =
  | { ok: true; regions: { data: T; path: VectorPathInput }[] }
  | { ok: false; message: string };

interface Contour {
  boundsArea: number;
  depth: number;
  parent: number | null;
  path: VectorPathInput;
}

/** Splits disconnected PathKit contours so a click selects one visual region. */
export function splitShapeBuilderRegions<T>(
  regions: readonly { data: T; path: VectorPathInput }[],
  provider: VectorGeometryProvider,
  maximum: number,
): ShapeBuilderRegionSplitResult<T> {
  const split: { data: T; path: VectorPathInput }[] = [];
  for (const region of regions) {
    const components = splitRegionComponents(region.path, provider);
    if (!components.ok) return components;
    for (const path of components.paths) {
      split.push({ data: region.data, path });
      if (split.length > maximum) {
        return {
          ok: false,
          message: `Shape Builder arrangement exceeds ${maximum} atomic regions`,
        };
      }
    }
  }
  return { ok: true, regions: split };
}

function splitRegionComponents(
  path: VectorPathInput,
  provider: VectorGeometryProvider,
): { ok: true; paths: VectorPathInput[] } | { ok: false; message: string } {
  const normalized = provider.normalize(path);
  if (!normalized.ok || normalized.empty) {
    return {
      ok: false,
      message: normalized.ok
        ? "Shape Builder atomic region is empty"
        : normalized.message,
    };
  }
  const contourPaths = normalized.path.match(/[Mm][^Mm]*/g) ?? [];
  const contours: Contour[] = [];
  for (const contourPath of contourPaths) {
    const contour = provider.normalize({
      path: contourPath,
      fillRule: normalized.fillRule,
    });
    if (!contour.ok || contour.empty || contour.bounds === null) {
      return {
        ok: false,
        message: contour.ok
          ? "Shape Builder contour is empty"
          : contour.message,
      };
    }
    contours.push({
      boundsArea: contour.bounds.width * contour.bounds.height,
      depth: 0,
      parent: null,
      path: { path: contourPath, fillRule: normalized.fillRule },
    });
  }
  if (contours.length === 0) {
    return { ok: false, message: "Shape Builder contour is missing" };
  }
  const hierarchy = assignContourHierarchy(contours, provider);
  if (!hierarchy.ok) return hierarchy;
  return {
    ok: true,
    paths: contours.flatMap((contour, index) =>
      contour.depth % 2 === 0
        ? [
            composePaintedComponent(
              contours,
              contour,
              index,
              normalized.fillRule,
            ),
          ]
        : [],
    ),
  };
}

function assignContourHierarchy(
  contours: Contour[],
  provider: VectorGeometryProvider,
): { ok: true } | { ok: false; message: string } {
  for (const [index, contour] of contours.entries()) {
    let parent: number | null = null;
    for (const [candidateIndex, candidate] of contours.entries()) {
      if (
        index === candidateIndex ||
        candidate.boundsArea <= contour.boundsArea ||
        (parent !== null &&
          candidate.boundsArea >= contours[parent]!.boundsArea)
      ) {
        continue;
      }
      const remainder = provider.combine(
        [contour.path, candidate.path],
        "subtract",
      );
      if (!remainder.ok) return { ok: false, message: remainder.message };
      if (remainder.empty) parent = candidateIndex;
    }
    contour.parent = parent;
  }
  for (const contour of contours) {
    const depth = contourDepth(contours, contour);
    if (depth === null) {
      return {
        ok: false,
        message: "Shape Builder contour hierarchy is cyclic",
      };
    }
    contour.depth = depth;
  }
  return { ok: true };
}

function contourDepth(
  contours: readonly Contour[],
  contour: Contour,
): number | null {
  let depth = 0;
  let parent = contour.parent;
  const visited = new Set<number>();
  while (parent !== null) {
    if (visited.has(parent)) return null;
    visited.add(parent);
    depth += 1;
    parent = contours[parent]?.parent ?? null;
  }
  return depth;
}

function composePaintedComponent(
  contours: readonly Contour[],
  outer: Contour,
  outerIndex: number,
  fillRule: VectorFillRule,
): VectorPathInput {
  const holes = contours
    .filter(
      (contour) =>
        contour.parent === outerIndex && contour.depth === outer.depth + 1,
    )
    .map((contour) => contour.path.path);
  return { path: [outer.path.path, ...holes].join(""), fillRule };
}

export function removeConsecutiveShapeBuilderPoints(
  points: readonly Point[],
): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      result.push({ x: point.x, y: point.y });
    }
  }
  return result;
}

export function formatShapeBuilderCoordinate(value: number): string {
  return Number(value.toFixed(6)).toString();
}
