import type {
  DesignDocument,
  DesignNode,
  Rect,
} from "@opendesign/design-contracts";
import { getNodeBounds } from "./geometry.js";

export const DESIGN_LAYOUT_QUALITY_REPORT_VERSION = 1 as const;

export type DesignLayoutQualitySeverity = "error" | "warning";

export type DesignLayoutQualityCode =
  | "artboard-clipping-disabled"
  | "artboard-geometry-unavailable"
  | "artboard-not-visible"
  | "node-excessive-artboard-overflow"
  | "node-fully-outside-artboard"
  | "node-geometry-unavailable"
  | "node-partial-artboard-overflow"
  | "quality-scan-truncated"
  | "target-frame-invalid";

export interface DesignLayoutQualityIssue {
  code: DesignLayoutQualityCode;
  message: string;
  nodeId: string;
  outsideRatio?: number;
  relatedNodeIds: string[];
  severity: DesignLayoutQualitySeverity;
}

export interface DesignLayoutQualityReport {
  version: typeof DESIGN_LAYOUT_QUALITY_REPORT_VERSION;
  documentId: string;
  revision: number;
  pageId: string;
  artboardFrameId: string;
  checkedNodeCount: number;
  errorCount: number;
  warningCount: number;
  issues: DesignLayoutQualityIssue[];
}

const BOUNDS_TOLERANCE = 0.5;
const PARTIAL_OVERFLOW_RATIO = 0.01;
const EXCESSIVE_OVERFLOW_RATIO = 0.25;
const MAX_QUALITY_ISSUES = 128;

export function diagnoseDesignTargetLayout(
  document: DesignDocument,
  pageId: string,
  artboardFrameId: string,
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
    return report(document, pageId, artboardFrameId, 0, issues);
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
    return report(document, pageId, artboardFrameId, 0, issues);
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
    if (outsideRatio >= 1) {
      appendQualityIssue(issues, artboardFrameId, {
        code: "node-fully-outside-artboard",
        severity: "error",
        nodeId: node.id,
        relatedNodeIds: [artboardFrameId],
        outsideRatio: 1,
        message: `Visible node ${node.id} is fully outside delivery artboard ${artboardFrameId}`,
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
        message: `Visible node ${node.id} has ${Math.round(outsideRatio * 100)}% of its area outside delivery artboard ${artboardFrameId}`,
      });
    } else if (outsideRatio >= PARTIAL_OVERFLOW_RATIO) {
      appendQualityIssue(issues, artboardFrameId, {
        code: "node-partial-artboard-overflow",
        severity: "warning",
        nodeId: node.id,
        relatedNodeIds: [artboardFrameId],
        outsideRatio: roundedRatio,
        message: `Visible node ${node.id} has ${Math.round(outsideRatio * 100)}% of its area outside delivery artboard ${artboardFrameId}`,
      });
    }
  }

  return report(document, pageId, artboardFrameId, checkedNodeCount, issues);
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
    boundedCount(record.errorCount) &&
    boundedCount(record.warningCount) &&
    Array.isArray(record.issues) &&
    record.issues.length <= MAX_QUALITY_ISSUES &&
    record.issues.every(isDesignLayoutQualityIssue) &&
    record.errorCount ===
      record.issues.filter((issue) => issue.severity === "error").length &&
    record.warningCount ===
      record.issues.filter((issue) => issue.severity === "warning").length &&
    recordKeysOnly(record, [
      "version",
      "documentId",
      "revision",
      "pageId",
      "artboardFrameId",
      "checkedNodeCount",
      "errorCount",
      "warningCount",
      "issues",
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
      "node-partial-artboard-overflow",
      "quality-scan-truncated",
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
    recordKeysOnly(record, [
      "code",
      "message",
      "nodeId",
      "outsideRatio",
      "relatedNodeIds",
      "severity",
    ])
  );
}

function report(
  document: DesignDocument,
  pageId: string,
  artboardFrameId: string,
  checkedNodeCount: number,
  issues: DesignLayoutQualityIssue[],
): DesignLayoutQualityReport {
  return {
    version: DESIGN_LAYOUT_QUALITY_REPORT_VERSION,
    documentId: document.documentId,
    revision: document.revision,
    pageId,
    artboardFrameId,
    checkedNodeCount,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    issues,
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
