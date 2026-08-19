import type { TrustedToolResult } from "@opendesign/agent-runtime";
import { designTargetQualityProfilesEqual } from "@opendesign/design-contracts";
import {
  isDesignLayoutQualityReport,
  type DesignLayoutQualityReport,
} from "@opendesign/editor-runtime";
import type { RendererDesignCaptureTarget } from "../../shared/design-tool-bridge.js";

export function requireCanvasCaptureLayoutQuality(
  result: TrustedToolResult,
  documentId: string,
  captureTarget: RendererDesignCaptureTarget,
): DesignLayoutQualityReport | undefined {
  const content = recordValue(result.content);
  if (captureTarget.kind === "page") {
    if (content?.layoutQuality !== undefined) {
      throw new Error(
        "design_workflow.layout_quality_unavailable: A Page capture returned an unexpected Frame layout-quality report; inspect and capture the current target again",
      );
    }
    return undefined;
  }
  const layoutQuality = content?.layoutQuality;
  if (
    !isDesignLayoutQualityReport(layoutQuality) ||
    layoutQuality.documentId !== documentId ||
    layoutQuality.revision !== result.observedRevision ||
    layoutQuality.pageId !== captureTarget.pageId ||
    layoutQuality.artboardFrameId !== captureTarget.nodeId ||
    !designTargetQualityProfilesEqual(
      layoutQuality.qualityProfile,
      captureTarget.qualityProfile,
    )
  ) {
    throw new Error(
      "design_workflow.layout_quality_unavailable: The rendered Frame capture did not include a trusted layout-quality report for the exact document, revision, Page, and Frame; inspect and capture the current target again",
    );
  }
  return layoutQuality;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
