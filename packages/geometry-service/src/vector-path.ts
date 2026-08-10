// Source consumers compile this workspace entry directly, so keep its private
// PathKit declarations attached to the entry rather than leaking them globally.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./pathkit-wasm.d.ts" />

import type { Rect, Transform } from "@opendesign/design-contracts";
import PathKitInit, {
  type PathKitEnumValue,
  type PathKitInitOptions,
  type PathKitModule,
  type PathKitPath,
} from "pathkit-wasm/bin/pathkit.js";

export const VECTOR_GEOMETRY_PROVIDER_ID = "skia-pathkit" as const;
export const VECTOR_GEOMETRY_PROVIDER_VERSION = "1.0.0" as const;

export type VectorFillRule = "nonzero" | "evenodd";
export type VectorBooleanOperation =
  "union" | "subtract" | "intersect" | "exclude";
export type VectorStrokeCap = "butt" | "round" | "square";
export type VectorStrokeJoin = "miter" | "round" | "bevel";

export interface VectorPathInput {
  path: string;
  fillRule?: VectorFillRule;
}

export interface VectorStrokeOptions {
  width: number;
  cap: VectorStrokeCap;
  join: VectorStrokeJoin;
  miterLimit: number;
}

export interface VectorDashOptions {
  on: number;
  off: number;
  phase: number;
}

export type VectorGeometryFailureCode =
  "insufficient-paths" | "invalid-input" | "operation-failed" | "parse-failed";

export type VectorGeometryResult =
  | {
      ok: true;
      path: string;
      fillRule: VectorFillRule;
      bounds: Rect | null;
      empty: boolean;
      provider: typeof VECTOR_GEOMETRY_PROVIDER_ID;
      providerVersion: typeof VECTOR_GEOMETRY_PROVIDER_VERSION;
    }
  | {
      ok: false;
      code: VectorGeometryFailureCode;
      message: string;
    };

export interface VectorGeometryProvider {
  readonly id: typeof VECTOR_GEOMETRY_PROVIDER_ID;
  readonly version: typeof VECTOR_GEOMETRY_PROVIDER_VERSION;
  combine(
    paths: readonly VectorPathInput[],
    operation: VectorBooleanOperation,
  ): VectorGeometryResult;
  normalize(path: VectorPathInput): VectorGeometryResult;
  transform(path: VectorPathInput, transform: Transform): VectorGeometryResult;
  dash(path: VectorPathInput, options: VectorDashOptions): VectorGeometryResult;
  outlineStroke(
    path: VectorPathInput,
    options: VectorStrokeOptions,
  ): VectorGeometryResult;
}

export type CreatePathKitGeometryProviderOptions =
  | {
      locateFile: (file: string) => string;
      wasmBinary?: ArrayBuffer | ArrayBufferView;
    }
  | {
      locateFile?: (file: string) => string;
      wasmBinary: ArrayBuffer | ArrayBufferView;
    };

const PATH_PATTERN = /^[\t\n\r ,.+\-0-9AaCcEeHhLlMmQqSsTtVvZz]+$/;
const MAX_PATH_CHARACTERS = 200_000;
const MAX_TOTAL_PATH_CHARACTERS = 2_000_000;
const MAX_BOOLEAN_INPUTS = 128;
const MAX_STROKE_WIDTH = 1_000_000;
const MAX_MITER_LIMIT = 1_000;
const MAX_DASH_LENGTH = 1_000_000;
const MAX_DASH_PHASE = 1_000_000_000;
const MAX_TRANSFORM_COMPONENT = 1_000_000_000;

export async function createPathKitGeometryProvider(
  options: CreatePathKitGeometryProviderOptions,
): Promise<VectorGeometryProvider> {
  if (options.locateFile === undefined && options.wasmBinary === undefined) {
    throw new TypeError(
      "PathKit initialization requires an explicit locateFile or wasmBinary",
    );
  }
  const initOptions: PathKitInitOptions = {
    ...(options.locateFile === undefined
      ? {}
      : { locateFile: options.locateFile }),
    ...(options.wasmBinary === undefined
      ? {}
      : { wasmBinary: options.wasmBinary }),
  };
  const module = await PathKitInit(initOptions);
  return new PathKitGeometryProvider(module);
}

class PathKitGeometryProvider implements VectorGeometryProvider {
  readonly id = VECTOR_GEOMETRY_PROVIDER_ID;
  readonly version = VECTOR_GEOMETRY_PROVIDER_VERSION;

  constructor(private readonly module: PathKitModule) {}

  combine(
    paths: readonly VectorPathInput[],
    operation: VectorBooleanOperation,
  ): VectorGeometryResult {
    if (!isBooleanOperation(operation)) {
      return failure("invalid-input", "Unsupported boolean geometry operation");
    }
    if (paths.length < 2) {
      return failure(
        "insufficient-paths",
        "Boolean geometry requires at least two paths",
      );
    }
    if (paths.length > MAX_BOOLEAN_INPUTS) {
      return failure(
        "invalid-input",
        `Boolean geometry accepts at most ${MAX_BOOLEAN_INPUTS} paths per operation`,
      );
    }
    const validated = validatePathInputs(paths);
    if (!validated.ok) return validated;
    const opened = this.#openPaths(validated.paths);
    if (!opened.ok) return opened.failure;
    try {
      const result = opened.paths[0];
      if (result === undefined) {
        return failure("operation-failed", "Boolean result path is missing");
      }
      const pathOperation = toPathOperation(this.module, operation);
      for (const operand of opened.paths.slice(1)) {
        if (result.op(operand, pathOperation) === null) {
          return failure(
            "operation-failed",
            `PathKit could not complete ${operation}`,
          );
        }
      }
      return pathResult(result);
    } finally {
      opened.paths.forEach((path) => path.delete());
    }
  }

  normalize(path: VectorPathInput): VectorGeometryResult {
    const validated = validatePathInputs([path]);
    if (!validated.ok) return validated;
    const opened = this.#openPaths(validated.paths);
    if (!opened.ok) return opened.failure;
    const source = opened.paths[0];
    try {
      if (source === undefined || source.simplify() === null) {
        return failure("operation-failed", "PathKit could not simplify path");
      }
      return pathResult(source);
    } finally {
      opened.paths.forEach((candidate) => candidate.delete());
    }
  }

  transform(path: VectorPathInput, transform: Transform): VectorGeometryResult {
    const validated = validatePathInputs([path]);
    if (!validated.ok) return validated;
    if (
      transform.length !== 6 ||
      !transform.every(
        (value) =>
          Number.isFinite(value) && Math.abs(value) <= MAX_TRANSFORM_COMPONENT,
      )
    ) {
      return failure(
        "invalid-input",
        "Vector transform is outside supported finite limits",
      );
    }
    const opened = this.#openPaths(validated.paths);
    if (!opened.ok) return opened.failure;
    const source = opened.paths[0];
    try {
      if (source === undefined) {
        return failure("operation-failed", "Vector source path is missing");
      }
      const [a, b, c, d, e, f] = transform;
      // PathKit accepts a row-major 3x3 matrix. OpenDesign stores the common
      // Canvas/SVG tuple [a, b, c, d, e, f].
      if (source.transform(a, c, e, b, d, f, 0, 0, 1) === null) {
        return failure("operation-failed", "PathKit could not transform path");
      }
      return pathResult(source);
    } finally {
      opened.paths.forEach((candidate) => candidate.delete());
    }
  }

  dash(
    path: VectorPathInput,
    options: VectorDashOptions,
  ): VectorGeometryResult {
    const validated = validatePathInputs([path]);
    if (!validated.ok) return validated;
    if (
      !Number.isFinite(options.on) ||
      options.on <= 0 ||
      options.on > MAX_DASH_LENGTH ||
      !Number.isFinite(options.off) ||
      options.off <= 0 ||
      options.off > MAX_DASH_LENGTH ||
      !Number.isFinite(options.phase) ||
      Math.abs(options.phase) > MAX_DASH_PHASE
    ) {
      return failure(
        "invalid-input",
        "Dash options are outside supported finite limits",
      );
    }
    const opened = this.#openPaths(validated.paths);
    if (!opened.ok) return opened.failure;
    const source = opened.paths[0];
    try {
      if (
        source === undefined ||
        source.dash(options.on, options.off, options.phase) === null
      ) {
        return failure("operation-failed", "PathKit could not dash path");
      }
      return pathResult(source);
    } finally {
      opened.paths.forEach((candidate) => candidate.delete());
    }
  }

  outlineStroke(
    path: VectorPathInput,
    options: VectorStrokeOptions,
  ): VectorGeometryResult {
    const validated = validatePathInputs([path]);
    if (!validated.ok) return validated;
    if (
      !Number.isFinite(options.width) ||
      options.width <= 0 ||
      options.width > MAX_STROKE_WIDTH ||
      !Number.isFinite(options.miterLimit) ||
      options.miterLimit <= 0 ||
      options.miterLimit > MAX_MITER_LIMIT ||
      !isStrokeCap(options.cap) ||
      !isStrokeJoin(options.join)
    ) {
      return failure(
        "invalid-input",
        "Stroke outline options are outside supported finite limits",
      );
    }
    const opened = this.#openPaths(validated.paths);
    if (!opened.ok) return opened.failure;
    const source = opened.paths[0];
    try {
      if (
        source === undefined ||
        source.stroke({
          width: options.width,
          cap: toStrokeCap(this.module, options.cap),
          join: toStrokeJoin(this.module, options.join),
          miter_limit: options.miterLimit,
        }) === null
      ) {
        return failure(
          "operation-failed",
          "PathKit could not convert the stroke to an outline",
        );
      }
      return pathResult(source);
    } finally {
      opened.paths.forEach((candidate) => candidate.delete());
    }
  }

  #openPaths(
    paths: readonly Required<VectorPathInput>[],
  ):
    | { ok: true; paths: PathKitPath[] }
    | { ok: false; failure: VectorGeometryResult & { ok: false } } {
    const opened: PathKitPath[] = [];
    for (const [index, input] of paths.entries()) {
      const path = this.module.FromSVGString(input.path);
      if (path === null) {
        opened.forEach((candidate) => candidate.delete());
        return {
          ok: false,
          failure: failure(
            "parse-failed",
            `PathKit rejected vector path at index ${index}`,
          ),
        };
      }
      path.setFillType(
        input.fillRule === "evenodd"
          ? this.module.FillType.EVENODD
          : this.module.FillType.WINDING,
      );
      opened.push(path);
    }
    return { ok: true, paths: opened };
  }
}

function validatePathInputs(
  paths: readonly VectorPathInput[],
):
  | { ok: true; paths: Required<VectorPathInput>[] }
  | (VectorGeometryResult & { ok: false }) {
  let totalCharacters = 0;
  const normalized: Required<VectorPathInput>[] = [];
  for (const [index, input] of paths.entries()) {
    const path = input.path.trim();
    totalCharacters += path.length;
    if (
      path.length === 0 ||
      path.length > MAX_PATH_CHARACTERS ||
      !PATH_PATTERN.test(path) ||
      (input.fillRule !== undefined &&
        input.fillRule !== "nonzero" &&
        input.fillRule !== "evenodd")
    ) {
      return failure(
        "invalid-input",
        `Vector path at index ${index} is invalid`,
      );
    }
    normalized.push({ path, fillRule: input.fillRule ?? "nonzero" });
  }
  if (totalCharacters > MAX_TOTAL_PATH_CHARACTERS) {
    return failure(
      "invalid-input",
      `Vector operation exceeds ${MAX_TOTAL_PATH_CHARACTERS} total path characters`,
    );
  }
  return { ok: true, paths: normalized };
}

function pathResult(path: PathKitPath): VectorGeometryResult {
  const pathData = path.toSVGString();
  const empty = pathData.length === 0;
  const bounds = empty ? null : normalizeBounds(path.computeTightBounds());
  if (!empty && bounds === null) {
    return failure(
      "operation-failed",
      "PathKit returned non-finite vector bounds",
    );
  }
  return {
    ok: true,
    path: pathData,
    fillRule: path.getFillTypeString(),
    bounds,
    empty,
    provider: VECTOR_GEOMETRY_PROVIDER_ID,
    providerVersion: VECTOR_GEOMETRY_PROVIDER_VERSION,
  };
}

function normalizeBounds(bounds: {
  fLeft: number;
  fTop: number;
  fRight: number;
  fBottom: number;
}): Rect | null {
  const values = [bounds.fLeft, bounds.fTop, bounds.fRight, bounds.fBottom];
  if (!values.every(Number.isFinite)) return null;
  const width = bounds.fRight - bounds.fLeft;
  const height = bounds.fBottom - bounds.fTop;
  if (width < 0 || height < 0) return null;
  return { x: bounds.fLeft, y: bounds.fTop, width, height };
}

function toPathOperation(
  module: PathKitModule,
  operation: VectorBooleanOperation,
): PathKitEnumValue {
  if (operation === "union") return module.PathOp.UNION;
  if (operation === "subtract") return module.PathOp.DIFFERENCE;
  if (operation === "intersect") return module.PathOp.INTERSECT;
  return module.PathOp.XOR;
}

function toStrokeCap(
  module: PathKitModule,
  cap: VectorStrokeCap,
): PathKitEnumValue {
  if (cap === "round") return module.StrokeCap.ROUND;
  if (cap === "square") return module.StrokeCap.SQUARE;
  return module.StrokeCap.BUTT;
}

function toStrokeJoin(
  module: PathKitModule,
  join: VectorStrokeJoin,
): PathKitEnumValue {
  if (join === "round") return module.StrokeJoin.ROUND;
  if (join === "bevel") return module.StrokeJoin.BEVEL;
  return module.StrokeJoin.MITER;
}

function isStrokeCap(value: unknown): value is VectorStrokeCap {
  return value === "butt" || value === "round" || value === "square";
}

function isBooleanOperation(value: unknown): value is VectorBooleanOperation {
  return (
    value === "union" ||
    value === "subtract" ||
    value === "intersect" ||
    value === "exclude"
  );
}

function isStrokeJoin(value: unknown): value is VectorStrokeJoin {
  return value === "miter" || value === "round" || value === "bevel";
}

function failure(
  code: VectorGeometryFailureCode,
  message: string,
): VectorGeometryResult & { ok: false } {
  return { ok: false, code, message };
}
