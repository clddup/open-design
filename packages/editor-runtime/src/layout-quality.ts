import type {
  DesignDocument,
  DesignNode,
  DesignTargetQualityProfile,
  Point,
  Rect,
} from "@opendesign/design-contracts";
import {
  isDesignTargetQualityProfile,
  minimumInteractiveTargetSize,
} from "@opendesign/design-contracts";
import {
  isTextLayoutQualityEvidence,
  type TextLayoutQualityEvidence,
  type TextLayoutQualityMeasurement,
} from "@opendesign/text-service";
import {
  getNodeBounds,
  getWorldTransform,
  invertTransform,
} from "./geometry.js";

export const DESIGN_LAYOUT_QUALITY_REPORT_VERSION = 5 as const;

export type DesignLayoutQualitySeverity = "error" | "warning";

export type DesignLayoutQualityCode =
  | "artboard-clipping-disabled"
  | "artboard-geometry-unavailable"
  | "artboard-not-visible"
  | "node-excessive-artboard-overflow"
  | "node-fully-outside-artboard"
  | "node-geometry-unavailable"
  | "node-outside-safe-area"
  | "node-partial-artboard-overflow"
  | "interactive-target-too-small"
  | "interactive-target-overlap"
  | "interactive-target-fully-occluded"
  | "interaction-geometry-unavailable"
  | "quality-node-missing"
  | "quality-node-not-visible"
  | "quality-profile-geometry-unavailable"
  | "quality-scan-truncated"
  | "text-content-clipped"
  | "text-content-overflow"
  | "text-ending-truncation-active"
  | "text-layout-evidence-unavailable"
  | "target-frame-invalid";

export interface DesignLayoutQualityIssue {
  code: DesignLayoutQualityCode;
  message: string;
  nodeId: string;
  outsideRatio?: number;
  geometry?: DesignLayoutQualityGeometry;
  measurement?: DesignLayoutQualityMeasurement;
  relatedNodeIds: string[];
  severity: DesignLayoutQualitySeverity;
}

export interface DesignLayoutQualityGeometry {
  coordinateSpace: "world";
  constraint: "artboard" | "safe-area";
  nodeBounds: Rect;
  artboardBounds: Rect;
  constraintBounds: Rect;
  parentId: string | null;
  currentLocalPosition: { x: number; y: number };
  recommendedLocalDelta: { x: number; y: number };
  recommendedLocalPosition: { x: number; y: number };
  requiresResize: boolean;
}

export type DesignLayoutQualityMeasurement =
  | {
      kind: "minimum-interactive-size";
      actualSize: { width: number; height: number };
      requiredSize: { width: number; height: number };
      source: string;
    }
  | ({ kind: "text-layout" } & Extract<
      TextLayoutQualityMeasurement,
      { status: "measured" }
    >)
  | {
      kind: "interaction-overlap";
      intersectionArea: number;
      overlapRatio: number;
      otherNodeId: string;
    }
  | {
      kind: "interaction-occlusion";
      coveredRatio: 1;
      occluderNodeId: string;
      proof: "opaque-later-sibling";
    };

export interface DesignLayoutQualityReport {
  version: typeof DESIGN_LAYOUT_QUALITY_REPORT_VERSION;
  documentId: string;
  revision: number;
  pageId: string;
  artboardFrameId: string;
  checkedNodeCount: number;
  checkedQualityNodeCount: number;
  checkedTextNodeCount: number;
  errorCount: number;
  warningCount: number;
  issues: DesignLayoutQualityIssue[];
  qualityProfile: DesignTargetQualityProfile | null;
}

const BOUNDS_TOLERANCE = 0.5;
const PARTIAL_OVERFLOW_RATIO = 0.01;
const EXCESSIVE_OVERFLOW_RATIO = 0.25;
const MAX_QUALITY_ISSUES = 128;
const INTERACTION_OVERLAP_AREA_TOLERANCE = 1;

export function diagnoseDesignTargetLayout(
  document: DesignDocument,
  pageId: string,
  artboardFrameId: string,
  qualityProfile?: DesignTargetQualityProfile,
  textLayoutEvidence?: TextLayoutQualityEvidence,
): DesignLayoutQualityReport {
  const issues: DesignLayoutQualityIssue[] = [];
  const artboard = document.nodesById[artboardFrameId];
  if (
    artboard?.kind !== "frame" ||
    !nodeBelongsToPage(document, pageId, artboardFrameId)
  ) {
    appendQualityIssue(issues, artboardFrameId, {
      code: "target-frame-invalid",
      severity: "error",
      nodeId: artboardFrameId,
      relatedNodeIds: [],
      message: `Delivery artboard ${artboardFrameId} is missing, is not a Frame, or does not belong to Page ${pageId}`,
    });
    return report(
      document,
      pageId,
      artboardFrameId,
      0,
      0,
      0,
      issues,
      qualityProfile,
    );
  }

  const artboardBounds = getNodeBounds(document, artboardFrameId);
  if (!artboardBounds || !isFinitePositiveRect(artboardBounds)) {
    appendQualityIssue(issues, artboardFrameId, {
      code: "artboard-geometry-unavailable",
      severity: "error",
      nodeId: artboardFrameId,
      relatedNodeIds: [],
      message: `Delivery artboard ${artboardFrameId} has invalid world bounds`,
    });
    return report(
      document,
      pageId,
      artboardFrameId,
      0,
      0,
      0,
      issues,
      qualityProfile,
    );
  }

  if (!artboard.visible || artboard.opacity <= 0) {
    appendQualityIssue(issues, artboardFrameId, {
      code: "artboard-not-visible",
      severity: "error",
      nodeId: artboardFrameId,
      relatedNodeIds: [],
      message: `Delivery artboard ${artboardFrameId} is hidden or has zero opacity`,
    });
  }

  if (!artboard.properties.clipsContent) {
    appendQualityIssue(issues, artboardFrameId, {
      code: "artboard-clipping-disabled",
      severity: "warning",
      nodeId: artboardFrameId,
      relatedNodeIds: [],
      message: `Delivery artboard ${artboardFrameId} has clipsContent disabled; overflowing layers may remain visible or export outside the intended composition`,
    });
  }

  let checkedNodeCount = 0;
  const pending = artboard.childIds
    .slice()
    .reverse()
    .map((nodeId) => ({
      nodeId,
      visible: artboard.visible && artboard.opacity > 0,
    }));
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);
    const node = document.nodesById[current.nodeId];
    if (!node) continue;
    const visible = current.visible && node.visible && node.opacity > 0;
    for (const childId of [...node.childIds].reverse()) {
      pending.push({ nodeId: childId, visible });
    }
    if (!visible || node.kind === "group" || !hasPositiveArea(node)) continue;
    checkedNodeCount += 1;
    const bounds = getNodeBounds(document, node.id);
    if (!bounds || !isFinitePositiveRect(bounds)) {
      appendQualityIssue(issues, artboardFrameId, {
        code: "node-geometry-unavailable",
        severity: "error",
        nodeId: node.id,
        relatedNodeIds: [artboardFrameId],
        message: `Visible node ${node.id} has invalid world bounds inside delivery artboard ${artboardFrameId}`,
      });
      continue;
    }
    const outsideRatio = rectOutsideRatio(
      bounds,
      expandRect(artboardBounds, BOUNDS_TOLERANCE),
    );
    if (outsideRatio === 0) continue;
    const geometry = containmentGeometry(
      document,
      node,
      bounds,
      artboardBounds,
      artboardBounds,
      "artboard",
    );
    if (outsideRatio >= 1) {
      appendQualityIssue(issues, artboardFrameId, {
        code: "node-fully-outside-artboard",
        severity: "error",
        nodeId: node.id,
        relatedNodeIds: [artboardFrameId],
        outsideRatio: 1,
        ...(geometry ? { geometry } : {}),
        message: overflowMessage(
          `Visible node ${node.id} is fully outside delivery artboard ${artboardFrameId}`,
          geometry,
        ),
      });
      continue;
    }
    const roundedRatio = Math.round(outsideRatio * 10_000) / 10_000;
    if (outsideRatio >= EXCESSIVE_OVERFLOW_RATIO) {
      appendQualityIssue(issues, artboardFrameId, {
        code: "node-excessive-artboard-overflow",
        severity: "error",
        nodeId: node.id,
        relatedNodeIds: [artboardFrameId],
        outsideRatio: roundedRatio,
        ...(geometry ? { geometry } : {}),
        message: overflowMessage(
          `Visible node ${node.id} has ${Math.round(outsideRatio * 100)}% of its area outside delivery artboard ${artboardFrameId}`,
          geometry,
        ),
      });
    } else if (outsideRatio >= PARTIAL_OVERFLOW_RATIO) {
      appendQualityIssue(issues, artboardFrameId, {
        code: "node-partial-artboard-overflow",
        severity: "warning",
        nodeId: node.id,
        relatedNodeIds: [artboardFrameId],
        outsideRatio: roundedRatio,
        ...(geometry ? { geometry } : {}),
        message: overflowMessage(
          `Visible node ${node.id} has ${Math.round(outsideRatio * 100)}% of its area outside delivery artboard ${artboardFrameId}`,
          geometry,
        ),
      });
    }
  }

  const checkedQualityNodeCount = diagnoseQualityProfile(
    document,
    artboard,
    artboardBounds,
    qualityProfile,
    issues,
  );
  const checkedTextNodeCount = diagnoseTextLayout(
    document,
    pageId,
    artboard,
    textLayoutEvidence,
    issues,
  );
  return report(
    document,
    pageId,
    artboardFrameId,
    checkedNodeCount,
    checkedQualityNodeCount,
    checkedTextNodeCount,
    issues,
    qualityProfile,
  );
}

function diagnoseQualityProfile(
  document: DesignDocument,
  artboard: Extract<DesignNode, { kind: "frame" }>,
  artboardBounds: Rect,
  qualityProfile: DesignTargetQualityProfile | undefined,
  issues: DesignLayoutQualityIssue[],
): number {
  if (!qualityProfile || qualityProfile.kind === "graphic") return 0;
  const world = getWorldTransform(document, artboard.id);
  const insets = qualityProfile.safeAreaInsets;
  const safeAreaBounds = {
    x: artboardBounds.x + insets.left,
    y: artboardBounds.y + insets.top,
    width: artboardBounds.width - insets.left - insets.right,
    height: artboardBounds.height - insets.top - insets.bottom,
  };
  if (
    !world ||
    !approximately(world[0], 1) ||
    !approximately(world[1], 0) ||
    !approximately(world[2], 0) ||
    !approximately(world[3], 1) ||
    !isFinitePositiveRect(safeAreaBounds)
  ) {
    appendQualityIssue(issues, artboard.id, {
      code: "quality-profile-geometry-unavailable",
      severity: "error",
      nodeId: artboard.id,
      relatedNodeIds: [],
      message: `Delivery artboard ${artboard.id} cannot apply its UI safe-area profile because the Frame is rotated, skewed, scaled, or the declared insets leave no positive content area`,
    });
    return 0;
  }

  const interactiveIds = new Set(qualityProfile.interactiveNodeIds);
  const interactiveNodes: DesignNode[] = [];
  const minimumSize = minimumInteractiveTargetSize(qualityProfile);
  let checkedQualityNodeCount = 0;
  for (const nodeId of qualityProfile.safeAreaNodeIds) {
    const node = document.nodesById[nodeId];
    if (!node || !nodeDescendsFrom(document, nodeId, artboard.id)) {
      appendQualityIssue(issues, artboard.id, {
        code: "quality-node-missing",
        severity: "error",
        nodeId,
        relatedNodeIds: [artboard.id],
        message: `Planned UI quality node ${nodeId} is missing or is not a descendant of delivery artboard ${artboard.id}`,
      });
      continue;
    }
    if (!nodeIsEffectivelyVisible(document, nodeId, artboard.id)) {
      appendQualityIssue(issues, artboard.id, {
        code: "quality-node-not-visible",
        severity: "error",
        nodeId,
        relatedNodeIds: [artboard.id],
        message: `Planned UI quality node ${nodeId} is hidden or has zero opacity inside delivery artboard ${artboard.id}`,
      });
      continue;
    }
    const bounds = getNodeBounds(document, nodeId);
    if (!bounds || !isFinitePositiveRect(bounds)) {
      appendQualityIssue(issues, artboard.id, {
        code: "node-geometry-unavailable",
        severity: "error",
        nodeId,
        relatedNodeIds: [artboard.id],
        message: `Planned UI quality node ${nodeId} has invalid world bounds inside delivery artboard ${artboard.id}`,
      });
      continue;
    }
    checkedQualityNodeCount += 1;
    if (interactiveIds.has(nodeId)) interactiveNodes.push(node);
    const outsideRatio = rectOutsideRatio(
      bounds,
      expandRect(safeAreaBounds, BOUNDS_TOLERANCE),
    );
    if (outsideRatio > 0) {
      const geometry = containmentGeometry(
        document,
        node,
        bounds,
        artboardBounds,
        safeAreaBounds,
        "safe-area",
      );
      appendQualityIssue(issues, artboard.id, {
        code: "node-outside-safe-area",
        severity: "error",
        nodeId,
        relatedNodeIds: [artboard.id],
        outsideRatio: Math.round(outsideRatio * 10_000) / 10_000,
        ...(geometry ? { geometry } : {}),
        message: overflowMessage(
          `Planned foreground node ${nodeId} extends outside the declared ${qualityProfile.platform} safe area of delivery artboard ${artboard.id}`,
          geometry,
        ),
      });
    }
    if (
      interactiveIds.has(nodeId) &&
      (bounds.width + BOUNDS_TOLERANCE < minimumSize.width ||
        bounds.height + BOUNDS_TOLERANCE < minimumSize.height)
    ) {
      appendQualityIssue(issues, artboard.id, {
        code: "interactive-target-too-small",
        severity: "error",
        nodeId,
        relatedNodeIds: [artboard.id],
        measurement: {
          kind: "minimum-interactive-size",
          actualSize: {
            width: roundGeometry(bounds.width),
            height: roundGeometry(bounds.height),
          },
          requiredSize: {
            width: minimumSize.width,
            height: minimumSize.height,
          },
          source: minimumSize.source,
        },
        message: `Interactive target ${nodeId} is ${roundGeometry(bounds.width)}×${roundGeometry(bounds.height)} but ${qualityProfile.platform}/${qualityProfile.interactionMode} requires at least ${minimumSize.width}×${minimumSize.height} (${minimumSize.source}); point the profile at the actual hit-area Frame or enlarge it`,
      });
    }
  }
  diagnoseInteractionConflicts(
    document,
    artboard,
    interactiveNodes,
    interactiveIds,
    issues,
  );
  return checkedQualityNodeCount;
}

function diagnoseInteractionConflicts(
  document: DesignDocument,
  artboard: Extract<DesignNode, { kind: "frame" }>,
  interactiveNodes: readonly DesignNode[],
  interactiveIds: ReadonlySet<string>,
  issues: DesignLayoutQualityIssue[],
): void {
  const polygons = new Map<string, Point[]>();
  for (const node of interactiveNodes) {
    const polygon = nodeWorldPolygon(document, node);
    if (!polygon) {
      appendQualityIssue(issues, artboard.id, {
        code: "interaction-geometry-unavailable",
        severity: "error",
        nodeId: node.id,
        relatedNodeIds: [artboard.id],
        message: `Interactive target ${node.id} does not have a finite non-degenerate transformed hit-area polygon`,
      });
      continue;
    }
    polygons.set(node.id, polygon);
  }

  for (let leftIndex = 0; leftIndex < interactiveNodes.length; leftIndex += 1) {
    const left = interactiveNodes[leftIndex]!;
    const leftPolygon = polygons.get(left.id);
    if (!leftPolygon) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < interactiveNodes.length;
      rightIndex += 1
    ) {
      const right = interactiveNodes[rightIndex]!;
      const rightPolygon = polygons.get(right.id);
      if (!rightPolygon) continue;
      const intersectionArea = polygonArea(
        convexPolygonIntersection(leftPolygon, rightPolygon),
      );
      if (intersectionArea <= INTERACTION_OVERLAP_AREA_TOLERANCE) continue;
      const overlapRatio = Math.min(
        1,
        intersectionArea /
          Math.min(polygonArea(leftPolygon), polygonArea(rightPolygon)),
      );
      appendQualityIssue(issues, artboard.id, {
        code: "interactive-target-overlap",
        severity: "error",
        nodeId: left.id,
        relatedNodeIds: [artboard.id, right.id],
        measurement: {
          kind: "interaction-overlap",
          intersectionArea: roundGeometry(intersectionArea),
          overlapRatio: roundGeometry(overlapRatio),
          otherNodeId: right.id,
        },
        message: `Interactive hit areas ${left.id} and ${right.id} overlap by ${roundGeometry(intersectionArea)} square world units (${Math.round(overlapRatio * 100)}% of the smaller target); separate the actual hit-area layers so one pointer location has one action`,
      });
    }
  }

  for (const target of interactiveNodes) {
    const targetPolygon = polygons.get(target.id);
    if (!targetPolygon || !target.parentId) continue;
    const siblings = document.nodesById[target.parentId]?.childIds;
    const targetIndex = siblings?.indexOf(target.id) ?? -1;
    if (!siblings || targetIndex < 0) continue;
    const occluder = siblings
      .slice(targetIndex + 1)
      .map((nodeId) => document.nodesById[nodeId])
      .find(
        (candidate): candidate is DesignNode =>
          candidate !== undefined &&
          !interactiveIds.has(candidate.id) &&
          isProvablyOpaqueRectangle(document, candidate, artboard.id) &&
          polygonContainsPolygon(
            nodeWorldPolygon(document, candidate),
            targetPolygon,
          ),
      );
    if (!occluder) continue;
    appendQualityIssue(issues, artboard.id, {
      code: "interactive-target-fully-occluded",
      severity: "error",
      nodeId: target.id,
      relatedNodeIds: [artboard.id, occluder.id],
      measurement: {
        kind: "interaction-occlusion",
        coveredRatio: 1,
        occluderNodeId: occluder.id,
        proof: "opaque-later-sibling",
      },
      message: `Interactive hit area ${target.id} is fully covered in paint order by opaque later sibling ${occluder.id}; move, resize, reorder, hide, or remove the occluder before delivery`,
    });
  }
}

function diagnoseTextLayout(
  document: DesignDocument,
  pageId: string,
  artboard: Extract<DesignNode, { kind: "frame" }>,
  evidence: TextLayoutQualityEvidence | undefined,
  issues: DesignLayoutQualityIssue[],
): number {
  const evidenceMatches =
    evidence !== undefined &&
    isTextLayoutQualityEvidence(evidence) &&
    evidence.documentId === document.documentId &&
    evidence.revision === document.revision &&
    evidence.pageId === pageId;
  const measurements = new Map(
    evidenceMatches
      ? evidence.measurements.map((measurement) => [
          measurement.nodeId,
          measurement,
        ])
      : [],
  );
  let checkedTextNodeCount = 0;
  for (const node of visibleTextDescendants(document, artboard.id)) {
    const measurement = measurements.get(node.id);
    if (!measurement || measurement.status === "unavailable") {
      appendQualityIssue(issues, artboard.id, {
        code: "text-layout-evidence-unavailable",
        severity: "error",
        nodeId: node.id,
        relatedNodeIds: [artboard.id],
        message: measurement
          ? `Production text layout evidence is unavailable for ${node.id}: ${measurement.message}`
          : `Production text layout evidence is missing or stale for visible Text node ${node.id}`,
      });
      continue;
    }
    if (
      !sizesApproximatelyEqual(measurement.boxSize, node.size) ||
      (node.properties.textResize !== "fixed" &&
        (measurement.overflow.horizontal || measurement.overflow.vertical)) ||
      (node.properties.textTruncation === "disabled" && measurement.truncated)
    ) {
      appendQualityIssue(issues, artboard.id, {
        code: "text-layout-evidence-unavailable",
        severity: "error",
        nodeId: node.id,
        relatedNodeIds: [artboard.id],
        message: `Production text layout evidence for ${node.id} is inconsistent with the exact document revision`,
      });
      continue;
    }
    checkedTextNodeCount += 1;
    const overflow =
      measurement.overflow.horizontal || measurement.overflow.vertical;
    if (
      overflow &&
      node.properties.textOverflow === "clip" &&
      node.properties.textTruncation === "disabled"
    ) {
      appendQualityIssue(issues, artboard.id, {
        code: "text-content-clipped",
        severity: "error",
        nodeId: node.id,
        relatedNodeIds: [artboard.id],
        measurement: textLayoutMeasurement(measurement),
        message: `Visible Text node ${node.id} silently clips canonical content: its ${formatSize(measurement.fullContentSize)} full layout exceeds the ${formatSize(measurement.boxSize)} fixed box without an ending-truncation policy`,
      });
    } else if (overflow && node.properties.textOverflow === "visible") {
      appendQualityIssue(issues, artboard.id, {
        code: "text-content-overflow",
        severity: "warning",
        nodeId: node.id,
        relatedNodeIds: [artboard.id],
        measurement: textLayoutMeasurement(measurement),
        message: `Visible Text node ${node.id} renders content beyond its ${formatSize(measurement.boxSize)} fixed box; confirm that this visible overflow is intentional`,
      });
    }
    if (node.properties.textTruncation === "ending" && measurement.truncated) {
      appendQualityIssue(issues, artboard.id, {
        code: "text-ending-truncation-active",
        severity: "warning",
        nodeId: node.id,
        relatedNodeIds: [artboard.id],
        measurement: textLayoutMeasurement(measurement),
        message: `Visible Text node ${node.id} intentionally shortens canonical content with ending truncation; verify that the delivered copy remains understandable`,
      });
    }
  }
  return checkedTextNodeCount;
}

function visibleTextDescendants(
  document: DesignDocument,
  ancestorId: string,
): Array<Extract<DesignNode, { kind: "text" }>> {
  const root = document.nodesById[ancestorId];
  if (!root) return [];
  const result: Array<Extract<DesignNode, { kind: "text" }>> = [];
  const pending = root.childIds
    .slice()
    .reverse()
    .map((nodeId) => ({
      nodeId,
      visible: root.visible && root.opacity > 0,
    }));
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);
    const node = document.nodesById[current.nodeId];
    if (!node) continue;
    const visible = current.visible && node.visible && node.opacity > 0;
    for (const childId of [...node.childIds].reverse()) {
      pending.push({ nodeId: childId, visible });
    }
    if (visible && node.kind === "text") result.push(node);
  }
  return result;
}

function textLayoutMeasurement(
  measurement: Extract<TextLayoutQualityMeasurement, { status: "measured" }>,
): DesignLayoutQualityMeasurement {
  return { kind: "text-layout", ...structuredClone(measurement) };
}

function sizesApproximatelyEqual(
  left: { width: number; height: number },
  right: { width: number; height: number },
): boolean {
  return (
    Math.abs(left.width - right.width) <= BOUNDS_TOLERANCE &&
    Math.abs(left.height - right.height) <= BOUNDS_TOLERANCE
  );
}

function formatSize(size: { width: number; height: number }): string {
  return `${roundGeometry(size.width)}×${roundGeometry(size.height)}`;
}

export function isDesignLayoutQualityReport(
  value: unknown,
): value is DesignLayoutQualityReport {
  const record = recordValue(value);
  if (!record) return false;
  return (
    record.version === DESIGN_LAYOUT_QUALITY_REPORT_VERSION &&
    safeText(record.documentId) &&
    Number.isSafeInteger(record.revision) &&
    Number(record.revision) >= 0 &&
    safeText(record.pageId) &&
    safeText(record.artboardFrameId) &&
    boundedCount(record.checkedNodeCount) &&
    boundedCount(record.checkedQualityNodeCount) &&
    boundedCount(record.checkedTextNodeCount) &&
    boundedCount(record.errorCount) &&
    boundedCount(record.warningCount) &&
    Array.isArray(record.issues) &&
    record.issues.length <= MAX_QUALITY_ISSUES &&
    record.issues.every(isDesignLayoutQualityIssue) &&
    record.errorCount ===
      record.issues.filter((issue) => issue.severity === "error").length &&
    record.warningCount ===
      record.issues.filter((issue) => issue.severity === "warning").length &&
    (record.qualityProfile === null ||
      isDesignTargetQualityProfile(record.qualityProfile)) &&
    recordKeysOnly(record, [
      "version",
      "documentId",
      "revision",
      "pageId",
      "artboardFrameId",
      "checkedNodeCount",
      "checkedQualityNodeCount",
      "checkedTextNodeCount",
      "errorCount",
      "warningCount",
      "issues",
      "qualityProfile",
    ])
  );
}

function isDesignLayoutQualityIssue(
  value: unknown,
): value is DesignLayoutQualityIssue {
  const record = recordValue(value);
  if (!record) return false;
  return (
    [
      "artboard-clipping-disabled",
      "artboard-geometry-unavailable",
      "artboard-not-visible",
      "node-excessive-artboard-overflow",
      "node-fully-outside-artboard",
      "node-geometry-unavailable",
      "node-outside-safe-area",
      "node-partial-artboard-overflow",
      "interactive-target-too-small",
      "interactive-target-overlap",
      "interactive-target-fully-occluded",
      "interaction-geometry-unavailable",
      "quality-node-missing",
      "quality-node-not-visible",
      "quality-profile-geometry-unavailable",
      "quality-scan-truncated",
      "text-content-clipped",
      "text-content-overflow",
      "text-ending-truncation-active",
      "text-layout-evidence-unavailable",
      "target-frame-invalid",
    ].includes(String(record.code)) &&
    (record.severity === "error" || record.severity === "warning") &&
    safeText(record.nodeId) &&
    safeText(record.message, 4_000) &&
    Array.isArray(record.relatedNodeIds) &&
    record.relatedNodeIds.length <= 8 &&
    record.relatedNodeIds.every((nodeId) => safeText(nodeId)) &&
    (record.outsideRatio === undefined ||
      (typeof record.outsideRatio === "number" &&
        Number.isFinite(record.outsideRatio) &&
        record.outsideRatio >= 0 &&
        record.outsideRatio <= 1)) &&
    (record.geometry === undefined ||
      isDesignLayoutQualityGeometry(record.geometry)) &&
    (record.measurement === undefined ||
      isDesignLayoutQualityMeasurement(record.measurement)) &&
    recordKeysOnly(record, [
      "code",
      "message",
      "nodeId",
      "outsideRatio",
      "geometry",
      "measurement",
      "relatedNodeIds",
      "severity",
    ])
  );
}

function isDesignLayoutQualityGeometry(value: unknown): boolean {
  const record = recordValue(value);
  if (!record) return false;
  return (
    record.coordinateSpace === "world" &&
    (record.constraint === "artboard" || record.constraint === "safe-area") &&
    isFiniteRect(record.nodeBounds) &&
    isFiniteRect(record.artboardBounds) &&
    isFiniteRect(record.constraintBounds) &&
    (record.parentId === null || safeText(record.parentId)) &&
    isFinitePoint(record.currentLocalPosition) &&
    isFinitePoint(record.recommendedLocalDelta) &&
    isFinitePoint(record.recommendedLocalPosition) &&
    typeof record.requiresResize === "boolean" &&
    recordKeysOnly(record, [
      "coordinateSpace",
      "constraint",
      "nodeBounds",
      "artboardBounds",
      "constraintBounds",
      "parentId",
      "currentLocalPosition",
      "recommendedLocalDelta",
      "recommendedLocalPosition",
      "requiresResize",
    ])
  );
}

function isDesignLayoutQualityMeasurement(value: unknown): boolean {
  const record = recordValue(value);
  if (!record) return false;
  if (record.kind === "minimum-interactive-size") {
    return (
      isFiniteSize(record.actualSize) &&
      isFiniteSize(record.requiredSize) &&
      safeText(record.source) &&
      recordKeysOnly(record, ["kind", "actualSize", "requiredSize", "source"])
    );
  }
  if (record.kind === "text-layout") {
    return (
      record.status === "measured" &&
      safeText(record.nodeId) &&
      safeText(record.provider) &&
      safeText(record.providerVersion) &&
      isFiniteSize(record.boxSize) &&
      isFiniteSize(record.fullContentSize) &&
      isFiniteSize(record.displayedContentSize) &&
      isTextOverflowAxis(record.overflow) &&
      typeof record.truncated === "boolean" &&
      recordKeysOnly(record, [
        "kind",
        "status",
        "nodeId",
        "provider",
        "providerVersion",
        "boxSize",
        "fullContentSize",
        "displayedContentSize",
        "overflow",
        "truncated",
      ])
    );
  }
  if (record.kind === "interaction-overlap") {
    return (
      finiteNonNegative(record.intersectionArea) &&
      finiteRatio(record.overlapRatio) &&
      safeText(record.otherNodeId) &&
      recordKeysOnly(record, [
        "kind",
        "intersectionArea",
        "overlapRatio",
        "otherNodeId",
      ])
    );
  }
  return (
    record.kind === "interaction-occlusion" &&
    record.coveredRatio === 1 &&
    safeText(record.occluderNodeId) &&
    record.proof === "opaque-later-sibling" &&
    recordKeysOnly(record, ["kind", "coveredRatio", "occluderNodeId", "proof"])
  );
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteRatio(value: unknown): value is number {
  return finiteNonNegative(value) && value <= 1;
}

function isTextOverflowAxis(value: unknown): boolean {
  const record = recordValue(value);
  return (
    record !== null &&
    typeof record.horizontal === "boolean" &&
    typeof record.vertical === "boolean" &&
    recordKeysOnly(record, ["horizontal", "vertical"])
  );
}

function containmentGeometry(
  document: DesignDocument,
  node: DesignNode,
  nodeBounds: Rect,
  artboardBounds: Rect,
  constraintBounds: Rect,
  constraint: DesignLayoutQualityGeometry["constraint"],
): DesignLayoutQualityGeometry | undefined {
  const parentWorld = node.parentId
    ? getWorldTransform(document, node.parentId)
    : ([1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number]);
  const worldToParent = parentWorld ? invertTransform(parentWorld) : null;
  if (!worldToParent) return undefined;
  const worldDelta = {
    x: containmentDelta(
      nodeBounds.x,
      nodeBounds.width,
      constraintBounds.x,
      constraintBounds.width,
    ),
    y: containmentDelta(
      nodeBounds.y,
      nodeBounds.height,
      constraintBounds.y,
      constraintBounds.height,
    ),
  };
  const localDelta = {
    x: worldToParent[0] * worldDelta.x + worldToParent[2] * worldDelta.y,
    y: worldToParent[1] * worldDelta.x + worldToParent[3] * worldDelta.y,
  };
  const current = { x: node.transform[4], y: node.transform[5] };
  return {
    coordinateSpace: "world",
    constraint,
    nodeBounds,
    artboardBounds,
    constraintBounds,
    parentId: node.parentId,
    currentLocalPosition: current,
    recommendedLocalDelta: roundPoint(localDelta),
    recommendedLocalPosition: roundPoint({
      x: current.x + localDelta.x,
      y: current.y + localDelta.y,
    }),
    requiresResize:
      nodeBounds.width > constraintBounds.width + BOUNDS_TOLERANCE ||
      nodeBounds.height > constraintBounds.height + BOUNDS_TOLERANCE,
  };
}

function containmentDelta(
  nodeStart: number,
  nodeExtent: number,
  artboardStart: number,
  artboardExtent: number,
): number {
  const startDelta = artboardStart - nodeStart;
  const endDelta = artboardStart + artboardExtent - (nodeStart + nodeExtent);
  if (nodeExtent > artboardExtent) {
    return Math.abs(startDelta) <= Math.abs(endDelta) ? startDelta : endDelta;
  }
  if (nodeStart < artboardStart) return startDelta;
  if (nodeStart + nodeExtent > artboardStart + artboardExtent) return endDelta;
  return 0;
}

function overflowMessage(
  prefix: string,
  geometry: DesignLayoutQualityGeometry | undefined,
): string {
  if (!geometry) return prefix;
  const position = geometry.recommendedLocalPosition;
  const constraint =
    geometry.constraint === "safe-area" ? "safe area" : "artboard";
  return `${prefix}; set its parent-local position to x=${position.x}, y=${position.y}${geometry.requiresResize ? ` and resize it to fit the ${constraint}` : ""}`;
}

function roundPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: roundGeometry(point.x), y: roundGeometry(point.y) };
}

function roundGeometry(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isFinitePoint(value: unknown): boolean {
  const record = recordValue(value);
  return (
    record !== null &&
    typeof record.x === "number" &&
    Number.isFinite(record.x) &&
    typeof record.y === "number" &&
    Number.isFinite(record.y) &&
    recordKeysOnly(record, ["x", "y"])
  );
}

function isFiniteRect(value: unknown): boolean {
  const record = recordValue(value);
  return (
    isFinitePoint({ x: record?.x, y: record?.y }) &&
    typeof record?.width === "number" &&
    Number.isFinite(record.width) &&
    record.width >= 0 &&
    typeof record.height === "number" &&
    Number.isFinite(record.height) &&
    record.height >= 0 &&
    recordKeysOnly(record, ["x", "y", "width", "height"])
  );
}

function isFiniteSize(value: unknown): boolean {
  const record = recordValue(value);
  return (
    record !== null &&
    typeof record.width === "number" &&
    Number.isFinite(record.width) &&
    record.width >= 0 &&
    typeof record.height === "number" &&
    Number.isFinite(record.height) &&
    record.height >= 0 &&
    recordKeysOnly(record, ["width", "height"])
  );
}

function report(
  document: DesignDocument,
  pageId: string,
  artboardFrameId: string,
  checkedNodeCount: number,
  checkedQualityNodeCount: number,
  checkedTextNodeCount: number,
  issues: DesignLayoutQualityIssue[],
  qualityProfile: DesignTargetQualityProfile | undefined,
): DesignLayoutQualityReport {
  return {
    version: DESIGN_LAYOUT_QUALITY_REPORT_VERSION,
    documentId: document.documentId,
    revision: document.revision,
    pageId,
    artboardFrameId,
    checkedNodeCount,
    checkedQualityNodeCount,
    checkedTextNodeCount,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    issues,
    qualityProfile: qualityProfile ? structuredClone(qualityProfile) : null,
  };
}

function appendQualityIssue(
  issues: DesignLayoutQualityIssue[],
  artboardFrameId: string,
  issue: DesignLayoutQualityIssue,
): void {
  if (issues.length < MAX_QUALITY_ISSUES) {
    issues.push(issue);
    return;
  }
  const last = issues[MAX_QUALITY_ISSUES - 1];
  if (last?.code === "quality-scan-truncated") return;
  issues[MAX_QUALITY_ISSUES - 1] = {
    code: "quality-scan-truncated",
    severity: "error",
    nodeId: artboardFrameId,
    relatedNodeIds: [],
    message: `Delivery artboard ${artboardFrameId} produced more than ${MAX_QUALITY_ISSUES} deterministic layout issues; reduce or repair the overflowing structure before verification`,
  };
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const roots = new Set(document.pagesById[pageId]?.rootNodeIds ?? []);
  const visited = new Set<string>();
  let current: string | null = nodeId;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const node: DesignNode | undefined = document.nodesById[current];
    if (!node) return false;
    if (node.parentId === null) return roots.has(node.id);
    current = node.parentId;
  }
  return false;
}

function nodeDescendsFrom(
  document: DesignDocument,
  nodeId: string,
  ancestorId: string,
): boolean {
  const visited = new Set<string>();
  let current = document.nodesById[nodeId]?.parentId ?? null;
  while (current !== null && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = document.nodesById[current]?.parentId ?? null;
  }
  return false;
}

function nodeIsEffectivelyVisible(
  document: DesignDocument,
  nodeId: string,
  ancestorId: string,
): boolean {
  const visited = new Set<string>();
  let current: string | null = nodeId;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const node: DesignNode | undefined = document.nodesById[current];
    if (!node || !node.visible || node.opacity <= 0) return false;
    if (current === ancestorId) return true;
    current = node.parentId;
  }
  return false;
}

function approximately(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

function hasPositiveArea(node: DesignNode): boolean {
  return node.size.width > 0 && node.size.height > 0;
}

function isFinitePositiveRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function nodeWorldPolygon(
  document: DesignDocument,
  node: DesignNode,
): Point[] | null {
  if (!hasPositiveArea(node)) return null;
  const world = getWorldTransform(document, node.id);
  if (!world) return null;
  const polygon = [
    transformPoint(world, 0, 0),
    transformPoint(world, node.size.width, 0),
    transformPoint(world, node.size.width, node.size.height),
    transformPoint(world, 0, node.size.height),
  ];
  return polygon.every(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  ) && polygonArea(polygon) > 1e-9
    ? polygon
    : null;
}

function transformPoint(
  transform: [number, number, number, number, number, number],
  x: number,
  y: number,
): Point {
  return {
    x: transform[0] * x + transform[2] * y + transform[4],
    y: transform[1] * x + transform[3] * y + transform[5],
  };
}

function convexPolygonIntersection(
  subject: readonly Point[],
  clip: readonly Point[],
): Point[] {
  let output = [...subject];
  const orientation = signedPolygonArea(clip) >= 0 ? 1 : -1;
  for (let index = 0; index < clip.length; index += 1) {
    const edgeStart = clip[index]!;
    const edgeEnd = clip[(index + 1) % clip.length]!;
    const input = output;
    output = [];
    if (input.length === 0) break;
    let previous = input.at(-1)!;
    let previousInside = pointInsideEdge(
      previous,
      edgeStart,
      edgeEnd,
      orientation,
    );
    for (const current of input) {
      const currentInside = pointInsideEdge(
        current,
        edgeStart,
        edgeEnd,
        orientation,
      );
      if (currentInside !== previousInside) {
        const intersection = segmentLineIntersection(
          previous,
          current,
          edgeStart,
          edgeEnd,
        );
        if (intersection) output.push(intersection);
      }
      if (currentInside) output.push(current);
      previous = current;
      previousInside = currentInside;
    }
  }
  return output;
}

function pointInsideEdge(
  point: Point,
  edgeStart: Point,
  edgeEnd: Point,
  orientation: number,
): boolean {
  return (
    orientation *
      cross(
        edgeEnd.x - edgeStart.x,
        edgeEnd.y - edgeStart.y,
        point.x - edgeStart.x,
        point.y - edgeStart.y,
      ) >=
    -1e-9
  );
}

function segmentLineIntersection(
  start: Point,
  end: Point,
  lineStart: Point,
  lineEnd: Point,
): Point | null {
  const edgeX = lineEnd.x - lineStart.x;
  const edgeY = lineEnd.y - lineStart.y;
  const startDistance = cross(
    edgeX,
    edgeY,
    start.x - lineStart.x,
    start.y - lineStart.y,
  );
  const endDistance = cross(
    edgeX,
    edgeY,
    end.x - lineStart.x,
    end.y - lineStart.y,
  );
  const denominator = startDistance - endDistance;
  if (Math.abs(denominator) <= 1e-12) return null;
  const t = startDistance / denominator;
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function polygonContainsPolygon(
  container: readonly Point[] | null,
  target: readonly Point[],
): boolean {
  if (!container || container.length < 3) return false;
  const orientation = signedPolygonArea(container) >= 0 ? 1 : -1;
  return target.every((point) =>
    container.every((edgeStart, index) =>
      pointInsideEdge(
        point,
        edgeStart,
        container[(index + 1) % container.length]!,
        orientation,
      ),
    ),
  );
}

function polygonArea(polygon: readonly Point[]): number {
  return Math.abs(signedPolygonArea(polygon));
}

function signedPolygonArea(polygon: readonly Point[]): number {
  if (polygon.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function isProvablyOpaqueRectangle(
  document: DesignDocument,
  node: DesignNode,
  ancestorId: string,
): boolean {
  if (
    (node.kind !== "rectangle" && node.kind !== "frame") ||
    node.properties.cornerRadius !== 0 ||
    node.fillStyleId != null ||
    node.effectStyleId != null ||
    (node.effects?.length ?? 0) > 0 ||
    !node.properties.fills.some(
      (paint) =>
        paint.type === "solid" &&
        paint.visible !== false &&
        paint.opacity === 1 &&
        paint.blendMode === undefined &&
        paint.boundVariables === undefined &&
        opaqueHexColor(paint.color),
    )
  ) {
    return false;
  }
  const visited = new Set<string>();
  let current: string | null = node.id;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const candidate: DesignNode | undefined = document.nodesById[current];
    if (
      !candidate ||
      !candidate.visible ||
      candidate.opacity !== 1 ||
      candidate.effectStyleId != null ||
      (candidate.effects?.length ?? 0) > 0 ||
      (candidate.maskMode !== undefined && candidate.maskMode !== "none") ||
      (candidate.blendMode !== undefined &&
        candidate.blendMode !== "normal" &&
        candidate.blendMode !== "pass-through")
    ) {
      return false;
    }
    if (current === ancestorId) return true;
    current = candidate.parentId;
  }
  return false;
}

function opaqueHexColor(color: string): boolean {
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color);
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function rectOutsideRatio(rect: Rect, container: Rect): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(rect.x + rect.width, container.x + container.width) -
      Math.max(rect.x, container.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(rect.y + rect.height, container.y + container.height) -
      Math.max(rect.y, container.y),
  );
  const area = rect.width * rect.height;
  const intersectionArea = intersectionWidth * intersectionHeight;
  return Math.max(0, Math.min(1, 1 - intersectionArea / area));
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeText(value: unknown, maxLength = 512): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

function boundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function recordKeysOnly(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
