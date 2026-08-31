import type { TrustedToolResult } from "@opendesign/agent-contracts";
import type { DesignLayoutQualityReport } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { requireCanvasCaptureLayoutQuality } from "./canvas-capture-quality.js";

const frameTarget = {
  kind: "frame" as const,
  pageId: "page_design",
  nodeId: "frame_delivery",
};

const report: DesignLayoutQualityReport = {
  version: 7,
  documentId: "document_design",
  revision: 7,
  pageId: frameTarget.pageId,
  artboardFrameId: frameTarget.nodeId,
  checkedNodeCount: 4,
  checkedQualityNodeCount: 0,
  checkedTextNodeCount: 0,
  errorCount: 0,
  warningCount: 0,
  issues: [],
  qualityProfile: null,
};

const missingLayoutQuality = Symbol("missing-layout-quality");

function captureResult(layoutQuality: unknown = report): TrustedToolResult {
  return {
    observedRevision: 7,
    content:
      layoutQuality === missingLayoutQuality
        ? { ok: true }
        : { ok: true, layoutQuality },
  };
}

describe("Main canvas capture layout-quality boundary", () => {
  it("accepts only a report bound to the exact Frame capture", () => {
    expect(
      requireCanvasCaptureLayoutQuality(
        captureResult(),
        "document_design",
        frameTarget,
      ),
    ).toEqual(report);
    expect(
      requireCanvasCaptureLayoutQuality(
        captureResult(missingLayoutQuality),
        "document_design",
        {
          kind: "page",
          pageId: "page_design",
        },
      ),
    ).toBeUndefined();
    expect(() =>
      requireCanvasCaptureLayoutQuality(captureResult(), "document_design", {
        kind: "page",
        pageId: "page_design",
      }),
    ).toThrow("design_workflow.layout_quality_unavailable");
  });

  it("binds the report to the exact Main-selected quality profile", () => {
    const qualityProfile = {
      kind: "ui" as const,
      platform: "web" as const,
      interactionMode: "pointer" as const,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      safeAreaNodeIds: ["primary_action"],
      interactiveNodeIds: ["primary_action"],
    };
    const target = { ...frameTarget, qualityProfile };
    const qualityReport = { ...report, qualityProfile };

    expect(
      requireCanvasCaptureLayoutQuality(
        captureResult(qualityReport),
        "document_design",
        target,
      ),
    ).toEqual(qualityReport);
    expect(() =>
      requireCanvasCaptureLayoutQuality(
        captureResult({ ...qualityReport, qualityProfile: null }),
        "document_design",
        target,
      ),
    ).toThrow("design_workflow.layout_quality_unavailable");
  });

  it("accepts advisory repeated-layout evidence but rejects it as a blocking error", () => {
    const qualityProfile = {
      kind: "ui" as const,
      platform: "web" as const,
      interactionMode: "pointer" as const,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      safeAreaNodeIds: [],
      interactiveNodeIds: [],
    };
    const advisory: DesignLayoutQualityReport = {
      ...report,
      qualityProfile,
      warningCount: 1,
      issues: [
        {
          code: "repeated-layer-spacing-outlier",
          severity: "warning",
          nodeId: "item_4",
          relatedNodeIds: ["frame_delivery", "item_3"],
          message: "Repeated item spacing differs from its sibling pattern",
          measurement: {
            kind: "layout-spacing-outlier",
            axis: "vertical",
            actualGap: 28,
            expectedGap: 24,
            delta: -4,
            tolerance: 1,
            confidence: 2 / 3,
            peerNodeIds: ["item_1", "item_2", "item_3", "item_4"],
          },
        },
      ],
    };
    const target = { ...frameTarget, qualityProfile };
    expect(
      requireCanvasCaptureLayoutQuality(
        captureResult(advisory),
        "document_design",
        target,
      ),
    ).toEqual(advisory);

    expect(() =>
      requireCanvasCaptureLayoutQuality(
        captureResult({
          ...advisory,
          errorCount: 1,
          warningCount: 0,
          issues: [{ ...advisory.issues[0], severity: "error" }],
        }),
        "document_design",
        target,
      ),
    ).toThrow("design_workflow.layout_quality_unavailable");
  });

  it.each([
    ["missing", missingLayoutQuality],
    ["malformed", { version: 2 }],
    ["wrong document", { ...report, documentId: "document_other" }],
    ["wrong revision", { ...report, revision: 6 }],
    ["wrong Page", { ...report, pageId: "page_other" }],
    ["wrong Frame", { ...report, artboardFrameId: "frame_other" }],
  ])("rejects %s Frame reports", (_label, layoutQuality) => {
    expect(() =>
      requireCanvasCaptureLayoutQuality(
        captureResult(layoutQuality),
        "document_design",
        frameTarget,
      ),
    ).toThrow("design_workflow.layout_quality_unavailable");
  });
});
