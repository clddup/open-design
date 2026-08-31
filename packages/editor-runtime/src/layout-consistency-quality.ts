import type {
  DesignDocument,
  DesignNode,
  DesignTargetQualityProfile,
  Rect,
} from "@opendesign/design-contracts";
import type { DesignLayoutQualityIssue } from "./layout-quality-contract.js";
import { getNodeBounds, getWorldTransform } from "./geometry.js";

const PIXEL_ROUNDING_TOLERANCE = 1;
const MINIMUM_REPEATED_ITEMS = 4;

type Axis = "horizontal" | "vertical";
type LayoutEntry = { bounds: Rect; node: DesignNode };

export function diagnoseRepeatedLayoutConsistency(
  document: DesignDocument,
  artboardFrameId: string,
  qualityProfile: DesignTargetQualityProfile | undefined,
): DesignLayoutQualityIssue[] {
  if (qualityProfile?.kind !== "ui") return [];
  const issues: DesignLayoutQualityIssue[] = [];
  const pending = [artboardFrameId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const parentId = pending.pop();
    if (!parentId || visited.has(parentId)) continue;
    visited.add(parentId);
    const parent = document.nodesById[parentId];
    if (!parent || !parent.visible || parent.opacity <= 0) continue;
    for (const childId of parent.childIds) {
      const child = document.nodesById[childId];
      if (child?.childIds.length) pending.push(child.id);
    }
    if (hasExplicitAutoLayout(parent)) continue;
    for (const cohort of repeatedSiblingCohorts(document, parent)) {
      diagnoseSequence(parent.id, cohort, "horizontal", issues);
      diagnoseSequence(parent.id, cohort, "vertical", issues);
    }
  }
  return issues;
}

function repeatedSiblingCohorts(
  document: DesignDocument,
  parent: DesignNode,
): LayoutEntry[][] {
  const bySignature = new Map<string, LayoutEntry[]>();
  for (const childId of parent.childIds) {
    const node = document.nodesById[childId];
    if (
      !node ||
      !node.visible ||
      node.opacity <= 0 ||
      !axisAligned(document, node)
    ) {
      continue;
    }
    const bounds = getNodeBounds(document, node.id);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
    const signature = [
      node.kind,
      Math.round(bounds.width),
      Math.round(bounds.height),
    ].join(":");
    const cohort = bySignature.get(signature) ?? [];
    cohort.push({ bounds, node });
    bySignature.set(signature, cohort);
  }
  return [...bySignature.values()].filter(
    (cohort) => cohort.length >= MINIMUM_REPEATED_ITEMS,
  );
}

function diagnoseSequence(
  parentId: string,
  cohort: LayoutEntry[],
  axis: Axis,
  issues: DesignLayoutQualityIssue[],
): void {
  const sorted = cohort.slice().sort((left, right) => {
    const delta = mainStart(left.bounds, axis) - mainStart(right.bounds, axis);
    return delta || left.node.id.localeCompare(right.node.id);
  });
  const gaps = sorted.slice(1).map((entry, index) => ({
    actual:
      mainStart(entry.bounds, axis) - mainEnd(sorted[index]!.bounds, axis),
    leading: sorted[index]!,
    trailing: entry,
  }));
  if (
    gaps.some((gap) => gap.actual < -PIXEL_ROUNDING_TOLERANCE) ||
    !adjacentCrossAxisOverlap(sorted, axis)
  ) {
    return;
  }

  const spacingMode = singleOutlier(gaps.map((gap) => gap.actual));
  if (spacingMode) {
    const gap = gaps[spacingMode.outlierIndex]!;
    issues.push({
      code: "repeated-layer-spacing-outlier",
      severity: "warning",
      nodeId: gap.trailing.node.id,
      relatedNodeIds: [parentId, gap.leading.node.id],
      measurement: {
        kind: "layout-spacing-outlier",
        axis,
        actualGap: rounded(gap.actual),
        expectedGap: rounded(spacingMode.expected),
        delta: rounded(spacingMode.expected - gap.actual),
        tolerance: PIXEL_ROUNDING_TOLERANCE,
        confidence: rounded(spacingMode.confidence),
        peerNodeIds: sorted.map((entry) => entry.node.id).slice(0, 8),
      },
      message: `Repeated ${axis} siblings ${gap.leading.node.id} and ${gap.trailing.node.id} have a ${rounded(gap.actual)}px gap while the high-confidence sibling pattern uses ${rounded(spacingMode.expected)}px; confirm the exception or tidy this repeated sequence`,
    });
  }

  const alignmentMode = singleOutlier(
    sorted.map((entry) => crossStart(entry.bounds, axis)),
  );
  if (!alignmentMode) return;
  const outlier = sorted[alignmentMode.outlierIndex]!;
  issues.push({
    code: "repeated-layer-alignment-outlier",
    severity: "warning",
    nodeId: outlier.node.id,
    relatedNodeIds: [parentId],
    measurement: {
      kind: "layout-alignment-outlier",
      axis: axis === "horizontal" ? "y" : "x",
      anchor: "start",
      actualPosition: rounded(crossStart(outlier.bounds, axis)),
      expectedPosition: rounded(alignmentMode.expected),
      delta: rounded(alignmentMode.expected - crossStart(outlier.bounds, axis)),
      tolerance: PIXEL_ROUNDING_TOLERANCE,
      confidence: rounded(alignmentMode.confidence),
      peerNodeIds: sorted.map((entry) => entry.node.id).slice(0, 8),
    },
    message: `Repeated sibling ${outlier.node.id} is offset from the high-confidence ${axis} sequence by ${rounded(Math.abs(alignmentMode.expected - crossStart(outlier.bounds, axis)))}px on the cross axis; confirm the exception or align the repeated items`,
  });
}

function singleOutlier(values: number[]): {
  confidence: number;
  expected: number;
  outlierIndex: number;
} | null {
  if (values.length < 3) return null;
  let baseline: number[] = [];
  for (const candidate of values) {
    const cluster = values.filter(
      (value) => Math.abs(value - candidate) <= PIXEL_ROUNDING_TOLERANCE,
    );
    if (cluster.length > baseline.length) baseline = cluster;
  }
  if (baseline.length !== values.length - 1 || baseline.length < 2) return null;
  const expected = median(baseline);
  const outlierIndex = values.findIndex(
    (value) => Math.abs(value - expected) > PIXEL_ROUNDING_TOLERANCE,
  );
  return outlierIndex < 0
    ? null
    : {
        confidence: baseline.length / values.length,
        expected,
        outlierIndex,
      };
}

function adjacentCrossAxisOverlap(entries: LayoutEntry[], axis: Axis): boolean {
  return entries.slice(1).every((entry, index) => {
    const previous = entries[index]!.bounds;
    const current = entry.bounds;
    return (
      Math.min(crossEnd(previous, axis), crossEnd(current, axis)) -
        Math.max(crossStart(previous, axis), crossStart(current, axis)) >
      PIXEL_ROUNDING_TOLERANCE
    );
  });
}

function axisAligned(document: DesignDocument, node: DesignNode): boolean {
  const transform = getWorldTransform(document, node.id);
  return Boolean(
    transform &&
    Math.abs(transform[1]) <= 1e-9 &&
    Math.abs(transform[2]) <= 1e-9 &&
    transform[0] > 0 &&
    transform[3] > 0,
  );
}

function hasExplicitAutoLayout(node: DesignNode): boolean {
  return (
    (node.kind === "frame" || node.kind === "slot") &&
    node.properties.autoLayout !== undefined &&
    node.properties.autoLayout.mode !== "none"
  );
}

function mainStart(bounds: Rect, axis: Axis): number {
  return axis === "horizontal" ? bounds.x : bounds.y;
}

function mainEnd(bounds: Rect, axis: Axis): number {
  return (
    mainStart(bounds, axis) +
    (axis === "horizontal" ? bounds.width : bounds.height)
  );
}

function crossStart(bounds: Rect, axis: Axis): number {
  return axis === "horizontal" ? bounds.y : bounds.x;
}

function crossEnd(bounds: Rect, axis: Axis): number {
  return (
    crossStart(bounds, axis) +
    (axis === "horizontal" ? bounds.height : bounds.width)
  );
}

function median(values: number[]): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
