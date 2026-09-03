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
import {
  formatShapeBuilderCoordinate as format,
  removeConsecutiveShapeBuilderPoints as removeConsecutiveDuplicates,
  splitShapeBuilderRegions,
} from "./vector-shape-builder-regions.js";
const MAX_ATOMIC_REGIONS = 2_048;
const MAX_GESTURE_POINTS = 4_096;
const MAX_SOURCE_REGIONS = 128;
const HIT_WIDTH = 0.01;
const ID_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;
export type VectorShapeBuilderAction = "extract" | "merge" | "subtract";
export interface VectorShapeBuilderSource {
  network: VectorNetwork;
  sourceId: string;
}
export interface VectorShapeBuilderSourceResult {
  changed: boolean;
  network: VectorNetwork | null;
  sourceId: string;
}
export type VectorShapeBuilderFailureCode =
  | "ambiguous-region"
  | "budget-exceeded"
  | "insufficient-regions"
  | "invalid-geometry"
  | "invalid-input"
  | "no-region";
export type VectorShapeBuilderResult =
  | {
      ok: true;
      action: VectorShapeBuilderAction;
      resultNetwork: VectorNetwork | null;
      selectedRegionIds: readonly string[];
      selectedSourceIds: readonly string[];
      sourceResults: readonly VectorShapeBuilderSourceResult[];
    }
  | {
      ok: false;
      code: VectorShapeBuilderFailureCode;
      message: string;
    };
interface PaintedRegion {
  appearance: RegionAppearance;
  order: number;
  path: VectorPathInput;
  sourceId: string;
  sourceIndex: number;
}
interface AtomicRegion {
  appearance: RegionAppearance;
  memberIndexes: readonly number[];
  path: VectorPathInput;
  topOrder: number;
}
type RegionAppearance = Pick<VectorRegion, "fills" | "fillStyleId">;
type Failure = Extract<VectorShapeBuilderResult, { ok: false }>;
/**
 * Resolves painted Vector Networks into atomic regions and applies one
 * destructive Shape Builder gesture. Sources and gesture points are in the
 * same document-space coordinate system.
 */
export function buildVectorShapeBuilderEdit(
  sources: readonly VectorShapeBuilderSource[],
  points: readonly Point[],
  action: VectorShapeBuilderAction,
  provider: VectorGeometryProvider,
  idPrefix: string,
): VectorShapeBuilderResult {
  const inputIssue = validateInput(sources, points, action, idPrefix);
  if (inputIssue) return inputIssue;
  const painted = collectPaintedRegions(sources);
  if (!painted.ok) return painted;
  const partitioned = partitionRegions(painted.regions, provider);
  if (!partitioned.ok) return partitioned;
  const selected = selectAtomicRegions(partitioned.regions, points, provider);
  if (!selected.ok) return selected;
  const actionIssue = validateSelectionForAction(action, selected.regions);
  if (actionIssue) return actionIssue;
  return buildEditResult(
    sources,
    painted.regions,
    selected.regions,
    action,
    provider,
    idPrefix,
  );
}
function validateInput(
  sources: readonly VectorShapeBuilderSource[],
  points: readonly Point[],
  action: string,
  idPrefix: string,
): Failure | null {
  const sourceIds = sources.map(({ sourceId }) => sourceId);
  if (
    sources.length === 0 ||
    sourceIds.some((id) => id.length === 0) ||
    new Set(sourceIds).size !== sourceIds.length
  ) {
    return failure("invalid-input", "Shape Builder requires unique sources");
  }
  if (
    points.length === 0 ||
    points.length > MAX_GESTURE_POINTS ||
    points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))
  ) {
    return failure(
      "invalid-input",
      `Shape Builder requires 1–${MAX_GESTURE_POINTS} finite gesture points`,
    );
  }
  if (!isAction(action)) {
    return failure("invalid-input", "Shape Builder action is unsupported");
  }
  if (!ID_PREFIX_PATTERN.test(idPrefix) || idPrefix.length > 64) {
    return failure("invalid-input", "Shape Builder geometry prefix is invalid");
  }
  return null;
}
function collectPaintedRegions(
  sources: readonly VectorShapeBuilderSource[],
): { ok: true; regions: PaintedRegion[] } | Failure {
  const regions: PaintedRegion[] = [];
  for (const [sourceIndex, source] of sources.entries()) {
    const issues = validateVectorNetwork(source.network);
    if (issues.length > 0 || source.network.regions.length === 0) {
      return failure(
        "invalid-input",
        issues[0]?.message ??
          `Shape Builder source ${source.sourceId} has no painted region`,
      );
    }
    for (const region of source.network.regions) {
      const serialized = serializeVectorRegion(source.network, region.id);
      if (!serialized.ok) {
        return failure(
          "invalid-geometry",
          serialized.issues.map((issue) => issue.message).join("; "),
        );
      }
      regions.push({
        appearance: regionAppearance(region),
        order: regions.length,
        path: { path: serialized.path, fillRule: region.windingRule },
        sourceId: source.sourceId,
        sourceIndex,
      });
    }
  }
  return regions.length <= MAX_SOURCE_REGIONS
    ? { ok: true, regions }
    : failure(
        "budget-exceeded",
        `Shape Builder accepts at most ${MAX_SOURCE_REGIONS} painted source regions`,
      );
}
function partitionRegions(
  painted: readonly PaintedRegion[],
  provider: VectorGeometryProvider,
): { ok: true; regions: AtomicRegion[] } | Failure {
  let regions: AtomicRegion[] = [];
  for (const [memberIndex, source] of painted.entries()) {
    const added = addPaintedRegion(regions, source, memberIndex, provider);
    if (!added.ok) return added;
    regions = added.regions;
    if (regions.length > MAX_ATOMIC_REGIONS) {
      return failure(
        "budget-exceeded",
        `Shape Builder arrangement exceeds ${MAX_ATOMIC_REGIONS} atomic regions`,
      );
    }
  }
  const split = splitShapeBuilderRegions(
    regions.map(({ path, ...data }) => ({ data, path })),
    provider,
    MAX_ATOMIC_REGIONS,
  );
  return split.ok
    ? {
        ok: true,
        regions: split.regions.map(({ data, path }) => ({ ...data, path })),
      }
    : failure("invalid-geometry", split.message);
}
function addPaintedRegion(
  current: readonly AtomicRegion[],
  source: PaintedRegion,
  memberIndex: number,
  provider: VectorGeometryProvider,
): { ok: true; regions: AtomicRegion[] } | Failure {
  const next: AtomicRegion[] = [];
  let pending: VectorPathInput | null = source.path;
  for (const region of current) {
    const overlap = combine(region.path, source.path, "intersect", provider);
    if (!overlap.ok) return overlap;
    if (overlap.path) {
      const outside = combine(region.path, source.path, "subtract", provider);
      if (!outside.ok) return outside;
      if (outside.path) next.push({ ...region, path: outside.path });
      next.push({
        appearance: source.appearance,
        memberIndexes: [...region.memberIndexes, memberIndex],
        path: overlap.path,
        topOrder: source.order,
      });
    } else {
      next.push(region);
    }
    if (pending) {
      const remainder = combine(pending, region.path, "subtract", provider);
      if (!remainder.ok) return remainder;
      pending = remainder.path;
    }
  }
  if (pending) {
    next.push({
      appearance: source.appearance,
      memberIndexes: [memberIndex],
      path: pending,
      topOrder: source.order,
    });
  }
  return { ok: true, regions: next };
}
function selectAtomicRegions(
  regions: readonly AtomicRegion[],
  points: readonly Point[],
  provider: VectorGeometryProvider,
): { ok: true; regions: AtomicRegion[] } | Failure {
  const probe = gestureProbe(points, provider);
  if (!probe.ok) return probe;
  const selected: AtomicRegion[] = [];
  for (const region of regions) {
    const hit = combine(region.path, probe.path, "intersect", provider);
    if (!hit.ok) return hit;
    if (hit.path) selected.push(region);
  }
  return selected.length > 0
    ? { ok: true, regions: selected }
    : failure("no-region", "Shape Builder gesture did not hit a region");
}
function gestureProbe(
  points: readonly Point[],
  provider: VectorGeometryProvider,
): { ok: true; path: VectorPathInput } | Failure {
  const distinct = removeConsecutiveDuplicates(points);
  if (distinct.length === 1) {
    const point = distinct[0]!;
    const radius = HIT_WIDTH / 2;
    return {
      ok: true,
      path: {
        path: `M${format(point.x - radius)} ${format(point.y - radius)}H${format(point.x + radius)}V${format(point.y + radius)}H${format(point.x - radius)}Z`,
        fillRule: "nonzero",
      },
    };
  }
  const centerline = distinct
    .map(
      ({ x, y }, index) =>
        `${index === 0 ? "M" : "L"}${format(x)} ${format(y)}`,
    )
    .join(" ");
  const outlined = provider.outlineStroke(
    { path: centerline, fillRule: "nonzero" },
    { cap: "round", join: "round", miterLimit: 4, width: HIT_WIDTH },
  );
  return outlined.ok && !outlined.empty
    ? { ok: true, path: { path: outlined.path, fillRule: outlined.fillRule } }
    : failure(
        "invalid-geometry",
        outlined.ok ? "Shape Builder gesture is empty" : outlined.message,
      );
}
function validateSelectionForAction(
  action: VectorShapeBuilderAction,
  regions: readonly AtomicRegion[],
): Failure | null {
  if (action === "extract" && regions.length !== 1) {
    return failure(
      "ambiguous-region",
      "Extract requires a gesture that resolves exactly one atomic region",
    );
  }
  if (action === "merge" && regions.length < 2) {
    return failure(
      "insufficient-regions",
      "Merge requires a gesture that resolves at least two atomic regions",
    );
  }
  if (
    action === "merge" &&
    new Set(regions.map(({ appearance }) => JSON.stringify(appearance))).size >
      1
  ) {
    return failure(
      "ambiguous-region",
      "Merge requires selected regions with matching paint appearance",
    );
  }
  return null;
}
function buildEditResult(
  sources: readonly VectorShapeBuilderSource[],
  painted: readonly PaintedRegion[],
  selected: readonly AtomicRegion[],
  action: VectorShapeBuilderAction,
  provider: VectorGeometryProvider,
  idPrefix: string,
): VectorShapeBuilderResult {
  const selectedPath = unionPaths(
    selected.map(({ path }) => path),
    provider,
  );
  if (!selectedPath.ok) return selectedPath;
  const sourceResults = rebuildSources(
    sources,
    painted,
    selectedPath.path,
    provider,
    idPrefix,
  );
  if (!sourceResults.ok) return sourceResults;
  const resultNetwork =
    action === "subtract"
      ? { ok: true as const, network: null }
      : materializeSelected(selected, selectedPath.path, idPrefix);
  if (!resultNetwork.ok) return resultNetwork;
  const selectedSourceIds = new Set<string>();
  selected.forEach(({ memberIndexes }) =>
    memberIndexes.forEach((index) =>
      selectedSourceIds.add(painted[index]!.sourceId),
    ),
  );
  return {
    ok: true,
    action,
    resultNetwork: resultNetwork.network,
    selectedRegionIds: selected.map(
      (_, index) => `${idPrefix}_region_${index}`,
    ),
    selectedSourceIds: [...selectedSourceIds],
    sourceResults: sourceResults.results,
  };
}
function rebuildSources(
  sources: readonly VectorShapeBuilderSource[],
  painted: readonly PaintedRegion[],
  selectedPath: VectorPathInput,
  provider: VectorGeometryProvider,
  idPrefix: string,
): { ok: true; results: VectorShapeBuilderSourceResult[] } | Failure {
  const results: VectorShapeBuilderSourceResult[] = [];
  for (const [sourceIndex, source] of sources.entries()) {
    const rebuilt = rebuildSource(
      source,
      painted.filter((region) => region.sourceIndex === sourceIndex),
      selectedPath,
      provider,
      `${idPrefix}_source_${sourceIndex}`,
    );
    if (!rebuilt.ok) return rebuilt;
    results.push({ sourceId: source.sourceId, ...rebuilt });
  }
  return { ok: true, results };
}
function rebuildSource(
  source: VectorShapeBuilderSource,
  regions: readonly PaintedRegion[],
  selectedPath: VectorPathInput,
  provider: VectorGeometryProvider,
  idPrefix: string,
): { ok: true; changed: boolean; network: VectorNetwork | null } | Failure {
  const pieces: VectorNetwork[] = [];
  let changed = false;
  for (const [index, region] of regions.entries()) {
    const overlap = combine(region.path, selectedPath, "intersect", provider);
    if (!overlap.ok) return overlap;
    const visible = overlap.path
      ? combine(region.path, selectedPath, "subtract", provider)
      : { ok: true as const, path: region.path };
    if (!visible.ok) return visible;
    if (overlap.path) changed = true;
    if (!visible.path) continue;
    const materialized = materializePaintedRegion(
      visible.path,
      region.appearance,
      `${idPrefix}_${index}`,
    );
    if (!materialized.ok) return materialized;
    pieces.push(materialized.network);
  }
  if (!changed) {
    return {
      ok: true,
      changed: false,
      network: structuredClone(source.network),
    };
  }
  if (pieces.length === 0) return { ok: true, changed: true, network: null };
  const merged = mergeVectorNetworks(pieces);
  return merged.ok
    ? { ok: true, changed: true, network: merged.network }
    : failure("invalid-geometry", merged.message);
}
function materializeSelected(
  selected: readonly AtomicRegion[],
  path: VectorPathInput,
  idPrefix: string,
): { ok: true; network: VectorNetwork } | Failure {
  const appearance = [...selected].sort(
    (left, right) => right.topOrder - left.topOrder,
  )[0]!.appearance;
  return materializePaintedRegion(path, appearance, `${idPrefix}_result`);
}
function materializePaintedRegion(
  path: VectorPathInput,
  appearance: RegionAppearance,
  idPrefix: string,
): { ok: true; network: VectorNetwork } | Failure {
  const materialized = materializeVectorNetwork(
    path.path,
    path.fillRule ?? "nonzero",
    idPrefix,
  );
  if (!materialized.ok)
    return failure("invalid-geometry", materialized.message);
  for (const region of materialized.network.regions) {
    if (appearance.fills !== undefined) {
      region.fills = structuredClone(appearance.fills);
    }
    if (appearance.fillStyleId !== undefined) {
      region.fillStyleId = appearance.fillStyleId;
    }
  }
  return { ok: true, network: materialized.network };
}
function combine(
  left: VectorPathInput,
  right: VectorPathInput,
  operation: "intersect" | "subtract",
  provider: VectorGeometryProvider,
): { ok: true; path: VectorPathInput | null } | Failure {
  const result = provider.combine([left, right], operation);
  if (!result.ok) return failure("invalid-geometry", result.message);
  return {
    ok: true,
    path: result.empty
      ? null
      : { path: result.path, fillRule: result.fillRule },
  };
}
function unionPaths(
  paths: readonly VectorPathInput[],
  provider: VectorGeometryProvider,
): { ok: true; path: VectorPathInput } | Failure {
  const result =
    paths.length === 1
      ? provider.normalize(paths[0]!)
      : provider.combine(paths, "union");
  return result.ok && !result.empty
    ? { ok: true, path: { path: result.path, fillRule: result.fillRule } }
    : failure(
        "invalid-geometry",
        result.ok ? "Shape Builder selection is empty" : result.message,
      );
}
function regionAppearance(region: VectorRegion): RegionAppearance {
  return {
    ...(region.fills === undefined
      ? {}
      : { fills: structuredClone(region.fills) }),
    ...(region.fillStyleId === undefined
      ? {}
      : { fillStyleId: region.fillStyleId }),
  };
}
function isAction(value: string): value is VectorShapeBuilderAction {
  return value === "extract" || value === "merge" || value === "subtract";
}
function failure(
  code: VectorShapeBuilderFailureCode,
  message: string,
): Failure {
  return { ok: false, code, message };
}
