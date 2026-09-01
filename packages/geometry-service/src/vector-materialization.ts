import type {
  Point,
  Transform,
  VectorNetwork,
  VectorPathRun,
  VectorSegment,
  VectorVertex,
} from "@opendesign/design-contracts";
import {
  serializeVectorNetwork,
  validateVectorNetwork,
} from "./editable-vector.js";
import {
  projectVectorNetworkStrokePaths,
  vectorNetworkHasVertexStrokeOverrides,
} from "./vector-stroke-appearance.js";
import type {
  VectorFillRule,
  VectorGeometryProvider,
  VectorGeometryResult,
  VectorPathInput,
  VectorStrokeCap,
  VectorStrokeJoin,
} from "./vector-path.js";

const MAX_PATH_CHARACTERS = 200_000;
const MAX_GEOMETRY_ITEMS = 16_384;
const GEOMETRY_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const TOKEN_PATTERN = /[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

type PathToken =
  { kind: "command"; value: string } | { kind: "number"; value: number };

export type VectorMaterializationResult =
  | { ok: true; network: VectorNetwork }
  | {
      ok: false;
      code: "budget-exceeded" | "invalid-input" | "unsupported-command";
      message: string;
    };

export interface VectorOutlineOptions {
  align: "center" | "inside" | "outside";
  cap: VectorStrokeCap;
  cornerRadius?: number;
  cornerSmoothing?: number;
  dashPattern?: readonly number[];
  join: VectorStrokeJoin;
  miterLimit: number;
  width: number;
}

export function materializeTransformedVectorNetwork(
  source: VectorPathInput,
  transform: Transform,
  provider: VectorGeometryProvider,
  idPrefix: string,
): VectorMaterializationResult {
  const transformed = provider.transform(source, transform);
  if (!transformed.ok) return geometryFailure(transformed.message);
  if (transformed.empty) return geometryFailure("Vector path is empty");
  return materializeVectorNetwork(
    transformed.path,
    transformed.fillRule,
    idPrefix,
  );
}

export function mergeVectorNetworks(
  networks: readonly VectorNetwork[],
): VectorMaterializationResult {
  const merged: VectorNetwork = {
    vertices: networks.flatMap((network) => structuredClone(network.vertices)),
    segments: networks.flatMap((network) => structuredClone(network.segments)),
    paths: networks.flatMap((network) => structuredClone(network.paths)),
    regions: networks.flatMap((network) => structuredClone(network.regions)),
  };
  const itemCount =
    merged.vertices.length +
    merged.segments.length +
    merged.paths.length +
    merged.regions.length;
  if (networks.length === 0 || itemCount > MAX_GEOMETRY_ITEMS) {
    return failure(
      "budget-exceeded",
      "Flattened Vector geometry is empty or exceeds the geometry budget",
    );
  }
  const ids = [
    ...merged.vertices.map((item) => item.id),
    ...merged.segments.map((item) => item.id),
    ...merged.paths.map((item) => item.id),
    ...merged.regions.map((item) => item.id),
  ];
  if (new Set(ids).size !== ids.length) {
    return failure("invalid-input", "Flattened Vector IDs must be unique");
  }
  return { ok: true, network: merged };
}

type MutablePath = {
  closed: boolean;
  currentVertexId: string;
  firstVertexId: string;
  path: VectorPathRun;
};

/** Converts normalized absolute M/L/Q/C/Z path data into editable topology. */
export function materializeVectorNetwork(
  pathData: string,
  fillRule: VectorFillRule,
  idPrefix: string,
): VectorMaterializationResult {
  if (!validInput(pathData, idPrefix)) {
    return failure(
      "invalid-input",
      "Vector path or geometry ID prefix is invalid",
    );
  }
  const tokens = tokenize(pathData);
  if (!tokens.ok) return tokens;
  const builder = new VectorNetworkBuilder(tokens.tokens, fillRule, idPrefix);
  return builder.build();
}

export function outlineVectorPath(
  source: VectorPathInput,
  options: VectorOutlineOptions,
  provider: VectorGeometryProvider,
  idPrefix: string,
): VectorMaterializationResult {
  const normalized = provider.normalize(source);
  if (!normalized.ok) return geometryFailure(normalized.message);
  if (normalized.empty) return geometryFailure("Vector stroke source is empty");
  const sourceNetwork = materializeVectorNetwork(
    normalized.path,
    normalized.fillRule,
    `${idPrefix}_source`,
  );
  if (!sourceNetwork.ok) return sourceNetwork;
  if (
    options.align !== "center" &&
    sourceNetwork.network.paths.some((path) => !path.closed)
  ) {
    return geometryFailure(
      "Inside/outside stroke alignment requires closed paths",
    );
  }
  const strokeSource = applyDash(normalized, options.dashPattern, provider);
  if (!strokeSource.ok) return strokeSource;
  const outlined = provider.outlineStroke(strokeSource.path, {
    cap: options.cap,
    join: options.join,
    miterLimit: options.miterLimit,
    width: options.width * (options.align === "center" ? 1 : 2),
  });
  if (!outlined.ok) return geometryFailure(outlined.message);
  const visible = clipAlignedStroke(
    normalized,
    outlined,
    options.align,
    provider,
  );
  if (!visible.ok) return visible;
  if (visible.geometry.empty)
    return geometryFailure("Outlined stroke is empty");
  return materializeVectorNetwork(
    visible.geometry.path,
    visible.geometry.fillRule,
    idPrefix,
  );
}

export function outlineVectorNetworkStroke(
  network: VectorNetwork,
  source: VectorPathInput,
  options: VectorOutlineOptions,
  provider: VectorGeometryProvider,
  idPrefix: string,
): VectorMaterializationResult {
  const rounded = serializeVectorNetwork(
    network,
    options.cornerRadius ?? 0,
    options.cornerSmoothing ?? 0,
  );
  if (!rounded.ok) {
    return geometryFailure(
      rounded.issues.map((issue) => issue.message).join("; "),
    );
  }
  const roundedSource = { ...source, path: rounded.path };
  if (
    !vectorNetworkHasVertexStrokeOverrides(network) &&
    !options.dashPattern?.length
  ) {
    return outlineVectorPath(roundedSource, options, provider, idPrefix);
  }
  const issues = validateVectorNetwork(network);
  if (issues.length > 0) {
    return geometryFailure(issues.map((issue) => issue.message).join("; "));
  }
  const normalized = provider.normalize(roundedSource);
  if (!normalized.ok) return geometryFailure(normalized.message);
  if (normalized.empty) return geometryFailure("Vector stroke source is empty");
  if (
    options.align !== "center" &&
    network.paths.some((path) => !path.closed)
  ) {
    return geometryFailure(
      "Inside/outside stroke alignment requires closed paths",
    );
  }
  const pieces = buildVertexStrokePieces(network, options, provider);
  if (!pieces.ok) return pieces;
  const combined = unionGeometry(pieces.paths, provider);
  if (!combined.ok) return geometryFailure(combined.message);
  const visible = clipAlignedStroke(
    normalized,
    combined,
    options.align,
    provider,
  );
  if (!visible.ok) return visible;
  if (visible.geometry.empty)
    return geometryFailure("Outlined stroke is empty");
  return materializeVectorNetwork(
    visible.geometry.path,
    visible.geometry.fillRule,
    idPrefix,
  );
}

function buildVertexStrokePieces(
  network: VectorNetwork,
  options: VectorOutlineOptions,
  provider: VectorGeometryProvider,
):
  | { ok: true; paths: VectorPathInput[] }
  | Extract<VectorMaterializationResult, { ok: false }> {
  const projected = projectVectorNetworkStrokePaths(
    network,
    {
      strokeCap: options.cap === "butt" ? "none" : options.cap,
      strokeJoin: options.join,
    },
    options.width,
    options.cornerRadius ?? 0,
    options.cornerSmoothing ?? 0,
    options.dashPattern ?? [],
  );
  if (!projected.ok) return geometryFailure(projected.message);
  const paths: VectorPathInput[] = [];
  const width = options.width * (options.align === "center" ? 1 : 2);
  for (const path of projected.paths) {
    const outlined = provider.outlineStroke(
      { path: path.path },
      {
        width,
        cap: path.cap,
        join: path.join,
        miterLimit: options.miterLimit,
      },
    );
    if (!outlined.ok) return geometryFailure(outlined.message);
    paths.push(outlined);
  }
  return { ok: true, paths };
}

function unionGeometry(
  paths: readonly VectorPathInput[],
  provider: VectorGeometryProvider,
): VectorGeometryResult {
  const first = paths[0];
  if (!first) return geometryProviderFailure("Vector stroke source is empty");
  let combined: VectorGeometryResult = provider.normalize(first);
  for (const path of paths.slice(1)) {
    if (!combined.ok) return combined;
    combined = provider.combine([combined, path], "union");
  }
  return combined;
}

function geometryProviderFailure(message: string): VectorGeometryResult {
  return { ok: false, code: "invalid-input", message };
}

function applyDash(
  source: Extract<
    ReturnType<VectorGeometryProvider["normalize"]>,
    { ok: true }
  >,
  pattern: readonly number[] | undefined,
  provider: VectorGeometryProvider,
):
  | { ok: true; path: VectorPathInput }
  | Extract<VectorMaterializationResult, { ok: false }> {
  if (!pattern || pattern.length === 0) return { ok: true, path: source };
  if (
    pattern.length > 2 ||
    pattern.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    return geometryFailure("Stroke dash pattern is unsupported");
  }
  const dashed = provider.dash(source, {
    on: pattern[0]!,
    off: pattern[1] ?? pattern[0]!,
    phase: 0,
  });
  return dashed.ok
    ? { ok: true, path: dashed }
    : geometryFailure(dashed.message);
}

function clipAlignedStroke(
  source: VectorPathInput,
  outline: Extract<
    ReturnType<VectorGeometryProvider["outlineStroke"]>,
    { ok: true }
  >,
  align: VectorOutlineOptions["align"],
  provider: VectorGeometryProvider,
):
  | { ok: true; geometry: typeof outline }
  | Extract<VectorMaterializationResult, { ok: false }> {
  if (align === "center") return { ok: true, geometry: outline };
  const clipped = provider.combine(
    align === "inside" ? [source, outline] : [outline, source],
    align === "inside" ? "intersect" : "subtract",
  );
  return clipped.ok
    ? { ok: true, geometry: clipped }
    : geometryFailure(clipped.message);
}

function geometryFailure(
  message: string,
): Extract<VectorMaterializationResult, { ok: false }> {
  return failure("invalid-input", message);
}

class VectorNetworkBuilder {
  readonly #network: VectorNetwork = {
    vertices: [],
    segments: [],
    paths: [],
    regions: [],
  };
  #command = "";
  #index = 0;
  #path: MutablePath | undefined;

  constructor(
    private readonly tokens: readonly PathToken[],
    private readonly fillRule: VectorFillRule,
    private readonly idPrefix: string,
  ) {}

  build(): VectorMaterializationResult {
    while (this.#index < this.tokens.length) {
      const command = this.#nextCommand();
      if (!command.ok) return command;
      const applied = this.#apply(command.command);
      if (!applied.ok) return applied;
      if (this.#overBudget()) {
        return failure(
          "budget-exceeded",
          "Vector path exceeds editable topology limits",
        );
      }
    }
    if (!this.#finishOpenPath() || this.#network.paths.length === 0) {
      return failure(
        "invalid-input",
        "Vector path contains no drawable contour",
      );
    }
    this.#addFillRegion();
    return { ok: true, network: this.#network };
  }

  #nextCommand():
    | { ok: true; command: string }
    | Extract<VectorMaterializationResult, { ok: false }> {
    const token = this.tokens[this.#index];
    if (token?.kind === "command") {
      this.#index += 1;
      this.#command = token.value;
    }
    if (!this.#command) {
      return failure("invalid-input", "Vector path must start with a command");
    }
    return { ok: true, command: this.#command };
  }

  #apply(command: string): VectorMaterializationResult {
    if (command === "M") return this.#move();
    if (command === "L") return this.#line();
    if (command === "Q") return this.#quadratic();
    if (command === "C") return this.#cubic();
    if (command === "Z") return this.#close();
    return failure(
      "unsupported-command",
      `Normalized vector path command ${command} is unsupported`,
    );
  }

  #move(): VectorMaterializationResult {
    const point = this.#readPoint();
    if (!point) return failure("invalid-input", "Move command is incomplete");
    if (!this.#finishOpenPath()) {
      return failure("invalid-input", "Vector path contains an empty contour");
    }
    const vertex = this.#addVertex(point);
    const path: VectorPathRun = {
      id: this.#id("path", this.#network.paths.length),
      closed: false,
      segments: [],
    };
    this.#path = {
      closed: false,
      currentVertexId: vertex.id,
      firstVertexId: vertex.id,
      path,
    };
    this.#command = "L";
    return { ok: true, network: this.#network };
  }

  #line(): VectorMaterializationResult {
    const point = this.#readPoint();
    if (!point || !this.#path) {
      return failure("invalid-input", "Line command is outside a contour");
    }
    this.#appendSegment(point);
    return { ok: true, network: this.#network };
  }

  #quadratic(): VectorMaterializationResult {
    const control = this.#readPoint();
    const end = this.#readPoint();
    const start = this.#currentPoint();
    if (!control || !end || !start || !this.#path) {
      return failure("invalid-input", "Quadratic command is incomplete");
    }
    const tangentStart = scale(subtract(control, start), 2 / 3);
    const tangentEnd = scale(subtract(control, end), 2 / 3);
    this.#appendSegment(end, tangentStart, tangentEnd);
    return { ok: true, network: this.#network };
  }

  #cubic(): VectorMaterializationResult {
    const controlStart = this.#readPoint();
    const controlEnd = this.#readPoint();
    const end = this.#readPoint();
    const start = this.#currentPoint();
    if (!controlStart || !controlEnd || !end || !start || !this.#path) {
      return failure("invalid-input", "Cubic command is incomplete");
    }
    this.#appendSegment(
      end,
      subtract(controlStart, start),
      subtract(controlEnd, end),
    );
    return { ok: true, network: this.#network };
  }

  #close(): VectorMaterializationResult {
    if (!this.#path || this.#path.path.segments.length === 0) {
      return failure("invalid-input", "Close command is outside a contour");
    }
    this.#closeCurrentPath();
    this.#command = "";
    return { ok: true, network: this.#network };
  }

  #closeCurrentPath(): void {
    const path = this.#path!;
    const current = this.#vertex(path.currentVertexId)!;
    const first = this.#vertex(path.firstVertexId)!;
    if (samePoint(current, first)) this.#mergeClosingVertex(path);
    else this.#appendSegment(first, undefined, undefined, first.id);
    path.path.closed = true;
    path.closed = true;
  }

  #mergeClosingVertex(path: MutablePath): void {
    if (path.currentVertexId === path.firstVertexId) return;
    const lastSegmentId = path.path.segments.at(-1)?.segmentId;
    const segment = this.#network.segments.find(
      ({ id }) => id === lastSegmentId,
    );
    if (segment) segment.endVertexId = path.firstVertexId;
    this.#network.vertices = this.#network.vertices.filter(
      ({ id }) => id !== path.currentVertexId,
    );
    path.currentVertexId = path.firstVertexId;
  }

  #appendSegment(
    end: Point,
    tangentStart?: Point,
    tangentEnd?: Point,
    existingEndVertexId?: string,
  ): void {
    const path = this.#path!;
    const endVertex = existingEndVertexId
      ? this.#vertex(existingEndVertexId)!
      : this.#addVertex(end);
    const segment: VectorSegment = {
      id: this.#id("segment", this.#network.segments.length),
      startVertexId: path.currentVertexId,
      endVertexId: endVertex.id,
      ...(tangentStart ? { tangentStart } : {}),
      ...(tangentEnd ? { tangentEnd } : {}),
    };
    this.#network.segments.push(segment);
    path.path.segments.push({ segmentId: segment.id, reversed: false });
    path.currentVertexId = endVertex.id;
  }

  #finishOpenPath(): boolean {
    if (!this.#path) return true;
    if (this.#path.path.segments.length === 0) return false;
    this.#network.paths.push(this.#path.path);
    this.#path = undefined;
    return true;
  }

  #addFillRegion(): void {
    const closed = this.#network.paths.filter((path) => path.closed);
    if (closed.length === 0) return;
    this.#network.regions.push({
      id: this.#id("region", 0),
      windingRule: this.fillRule,
      loops: closed.map((path) => ({ pathId: path.id, reversed: false })),
    });
  }

  #readPoint(): Point | undefined {
    const x = this.#readNumber();
    const y = this.#readNumber();
    return x === undefined || y === undefined ? undefined : { x, y };
  }

  #readNumber(): number | undefined {
    const token = this.tokens[this.#index];
    if (token?.kind !== "number") return undefined;
    this.#index += 1;
    return token.value;
  }

  #currentPoint(): Point | undefined {
    return this.#path ? this.#vertex(this.#path.currentVertexId) : undefined;
  }

  #addVertex(point: Point): VectorVertex {
    const vertex = {
      id: this.#id("vertex", this.#network.vertices.length),
      ...point,
    };
    this.#network.vertices.push(vertex);
    return vertex;
  }

  #vertex(id: string): VectorVertex | undefined {
    return this.#network.vertices.find((vertex) => vertex.id === id);
  }

  #id(kind: "path" | "region" | "segment" | "vertex", index: number): string {
    return `${this.idPrefix}_${kind}_${index}`;
  }

  #overBudget(): boolean {
    return (
      this.#network.vertices.length > MAX_GEOMETRY_ITEMS ||
      this.#network.segments.length > MAX_GEOMETRY_ITEMS ||
      this.#network.paths.length > MAX_GEOMETRY_ITEMS
    );
  }
}

function tokenize(
  pathData: string,
):
  | { ok: true; tokens: PathToken[] }
  | Extract<VectorMaterializationResult, { ok: false }> {
  const values = pathData.match(TOKEN_PATTERN) ?? [];
  const remainder = pathData.replace(TOKEN_PATTERN, "").replace(/[\s,]/g, "");
  if (values.length === 0 || remainder.length > 0) {
    return failure("invalid-input", "Vector path contains invalid tokens");
  }
  const tokens: PathToken[] = [];
  for (const value of values) {
    if (/^[A-Za-z]$/.test(value)) tokens.push({ kind: "command", value });
    else {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        return failure(
          "invalid-input",
          "Vector path contains a non-finite number",
        );
      }
      tokens.push({ kind: "number", value: number });
    }
  }
  return { ok: true, tokens };
}

function validInput(pathData: string, idPrefix: string): boolean {
  return (
    pathData.length > 0 &&
    pathData.length <= MAX_PATH_CHARACTERS &&
    GEOMETRY_ID_PATTERN.test(idPrefix) &&
    idPrefix.length <= 96
  );
}

function subtract(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scale(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor };
}

function samePoint(left: Point, right: Point): boolean {
  return (
    Math.abs(left.x - right.x) <= 1e-9 && Math.abs(left.y - right.y) <= 1e-9
  );
}

function failure(
  code: Extract<VectorMaterializationResult, { ok: false }>["code"],
  message: string,
): Extract<VectorMaterializationResult, { ok: false }> {
  return { ok: false, code, message };
}
