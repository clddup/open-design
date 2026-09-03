import type {
  Point,
  VectorNetwork,
  VectorRegion,
} from "@opendesign/design-contracts";
import {
  serializeVectorRegion,
  validateVectorNetwork,
} from "./editable-vector.js";
import {
  materializeVectorNetwork,
  mergeVectorNetworks,
} from "./vector-materialization.js";
import type { VectorGeometryProvider, VectorPathInput } from "./vector-path.js";

const MAX_ERASER_POINTS = 4_096;
const MAX_ERASER_WEIGHT = 10_000;
const MIN_ERASER_WEIGHT = 0.1;
const CIRCLE_KAPPA = 0.552_284_749_830_793_6;

export type VectorEraserShape = "round" | "square";

export type VectorEraserFailure = {
  ok: false;
  code: "invalid-geometry" | "invalid-input";
  message: string;
};

export type VectorEraserPathResult =
  { ok: true; path: VectorPathInput } | VectorEraserFailure;

export type VectorEraseResult =
  | {
      ok: true;
      changed: boolean;
      network: VectorNetwork | null;
    }
  | VectorEraserFailure;

/** Builds the filled document-space footprint swept by one Eraser gesture. */
export function createVectorEraserPath(
  points: readonly Point[],
  weight: number,
  shape: VectorEraserShape,
  provider: VectorGeometryProvider,
): VectorEraserPathResult {
  if (!validEraserInput(points, weight, shape)) {
    return failure(
      "invalid-input",
      "Vector Eraser requires 1–4096 finite points, a supported shape, and a weight from 0.1 to 10000",
    );
  }
  const distinct = removeConsecutiveDuplicates(points);
  if (distinct.length === 1) {
    return {
      ok: true,
      path: {
        path:
          shape === "round"
            ? circlePath(distinct[0]!, weight / 2)
            : squarePath(distinct[0]!, weight / 2),
        fillRule: "nonzero",
      },
    };
  }
  const centerline = distinct
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${format(point.x)} ${format(point.y)}`,
    )
    .join(" ");
  const outlined = provider.outlineStroke(
    { path: centerline, fillRule: "nonzero" },
    {
      cap: shape === "round" ? "round" : "square",
      join: shape === "round" ? "round" : "miter",
      miterLimit: 4,
      width: weight,
    },
  );
  return outlined.ok
    ? {
        ok: true,
        path: { path: outlined.path, fillRule: outlined.fillRule },
      }
    : failure("invalid-geometry", outlined.message);
}

/**
 * Subtracts an Eraser footprint from independently painted closed regions.
 * The caller first materializes visible fills and strokes into this form, so
 * open strokes remain editable filled contours instead of being rasterized.
 */
export function erasePaintedVectorNetwork(
  network: VectorNetwork,
  eraser: VectorPathInput,
  provider: VectorGeometryProvider,
  idPrefix: string,
): VectorEraseResult {
  const issues = validateVectorNetwork(network);
  if (issues.length > 0 || network.regions.length === 0) {
    return failure(
      "invalid-input",
      issues[0]?.message ??
        "Vector Eraser requires materialized closed paint regions",
    );
  }
  const normalizedEraser = provider.normalize(eraser);
  if (!normalizedEraser.ok) {
    return failure("invalid-geometry", normalizedEraser.message);
  }
  if (normalizedEraser.empty) {
    return failure("invalid-input", "Vector Eraser footprint is empty");
  }

  let changed = false;
  const pieces: VectorNetwork[] = [];
  for (const [index, region] of network.regions.entries()) {
    const source = serializeVectorRegion(network, region.id);
    if (!source.ok) {
      return failure(
        "invalid-geometry",
        source.issues.map((issue) => issue.message).join("; "),
      );
    }
    const sourcePath = {
      path: source.path,
      fillRule: region.windingRule,
    } as const;
    const intersection = provider.combine(
      [sourcePath, normalizedEraser],
      "intersect",
    );
    if (!intersection.ok) {
      return failure("invalid-geometry", intersection.message);
    }
    const visible = intersection.empty
      ? provider.normalize(sourcePath)
      : provider.combine([sourcePath, normalizedEraser], "subtract");
    if (!visible.ok) return failure("invalid-geometry", visible.message);
    if (!intersection.empty) changed = true;
    if (visible.empty) continue;
    const materialized = materializeVectorNetwork(
      visible.path,
      visible.fillRule,
      `${idPrefix}_region_${index}`,
    );
    if (!materialized.ok) {
      return failure("invalid-geometry", materialized.message);
    }
    applyRegionAppearance(materialized.network, region);
    pieces.push(materialized.network);
  }

  if (!changed) {
    return { ok: true, changed: false, network: structuredClone(network) };
  }
  if (pieces.length === 0) {
    return { ok: true, changed: true, network: null };
  }
  const merged = mergeVectorNetworks(pieces);
  return merged.ok
    ? { ok: true, changed: true, network: merged.network }
    : failure("invalid-geometry", merged.message);
}

function applyRegionAppearance(
  network: VectorNetwork,
  source: VectorRegion,
): void {
  for (const region of network.regions) {
    if (source.fills !== undefined) {
      region.fills = structuredClone(source.fills);
    }
    if (source.fillStyleId !== undefined) {
      region.fillStyleId = source.fillStyleId;
    }
  }
}

function validEraserInput(
  points: readonly Point[],
  weight: number,
  shape: string,
): boolean {
  return (
    points.length > 0 &&
    points.length <= MAX_ERASER_POINTS &&
    points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ) &&
    Number.isFinite(weight) &&
    weight >= MIN_ERASER_WEIGHT &&
    weight <= MAX_ERASER_WEIGHT &&
    (shape === "round" || shape === "square")
  );
}

function removeConsecutiveDuplicates(points: readonly Point[]): Point[] {
  const distinct: Point[] = [];
  for (const point of points) {
    const previous = distinct.at(-1);
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      distinct.push({ x: point.x, y: point.y });
    }
  }
  return distinct;
}

function circlePath(center: Point, radius: number): string {
  const control = radius * CIRCLE_KAPPA;
  const { x, y } = center;
  return [
    `M${format(x + radius)} ${format(y)}`,
    `C${format(x + radius)} ${format(y + control)} ${format(x + control)} ${format(y + radius)} ${format(x)} ${format(y + radius)}`,
    `C${format(x - control)} ${format(y + radius)} ${format(x - radius)} ${format(y + control)} ${format(x - radius)} ${format(y)}`,
    `C${format(x - radius)} ${format(y - control)} ${format(x - control)} ${format(y - radius)} ${format(x)} ${format(y - radius)}`,
    `C${format(x + control)} ${format(y - radius)} ${format(x + radius)} ${format(y - control)} ${format(x + radius)} ${format(y)}Z`,
  ].join(" ");
}

function squarePath(center: Point, radius: number): string {
  const left = format(center.x - radius);
  const right = format(center.x + radius);
  const top = format(center.y - radius);
  const bottom = format(center.y + radius);
  return `M${left} ${top} L${right} ${top} L${right} ${bottom} L${left} ${bottom}Z`;
}

function format(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function failure(
  code: VectorEraserFailure["code"],
  message: string,
): VectorEraserFailure {
  return { ok: false, code, message };
}
