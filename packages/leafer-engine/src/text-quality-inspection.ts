import type {
  DesignDocument,
  DesignNode,
  TextRunStyle,
} from "@opendesign/design-contracts";
import { projectComponentInstances } from "@opendesign/component-service";
import {
  MAX_TEXT_LAYOUT_QUALITY_MEASUREMENTS,
  TEXT_LAYOUT_QUALITY_EVIDENCE_VERSION,
  validateTextLayoutResult,
  validateTextRunLayoutResult,
  type TextLayoutProvider,
  type TextLayoutQualityEvidence,
  type TextLayoutQualityMeasurement,
  type TextLayoutRequest,
  type TextRunLayoutProvider,
  type TextRunLayoutRequest,
} from "@opendesign/text-service";
import type { LeaferTextRunStyle } from "./text-run-layout.js";

const MEASUREMENT_TOLERANCE = 0.5;

type TextNode = Extract<DesignNode, { kind: "text" }>;

export function inspectDesignTextLayoutQuality(
  document: DesignDocument,
  pageId: string,
  rootNodeId: string,
  textLayoutProvider: TextLayoutProvider,
  textRunLayoutProvider: TextRunLayoutProvider<LeaferTextRunStyle>,
): TextLayoutQualityEvidence {
  const projectionDocument = projectComponentInstances(document).document;
  const measurements: TextLayoutQualityMeasurement[] = [];
  const pending = [{ nodeId: rootNodeId, ancestorsVisible: true }];
  const visited = new Set<string>();
  while (
    pending.length > 0 &&
    measurements.length < MAX_TEXT_LAYOUT_QUALITY_MEASUREMENTS
  ) {
    const current = pending.pop();
    if (!current || visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);
    const node = projectionDocument.nodesById[current.nodeId];
    if (!node) continue;
    const visible =
      current.ancestorsVisible && node.visible && node.opacity > 0;
    for (const childId of [...node.childIds].reverse()) {
      pending.push({ nodeId: childId, ancestorsVisible: visible });
    }
    if (!visible || node.kind !== "text") continue;
    measurements.push(
      hasRichText(node)
        ? measureRichText(node, textRunLayoutProvider)
        : measurePlainText(node, textLayoutProvider),
    );
  }
  return {
    version: TEXT_LAYOUT_QUALITY_EVIDENCE_VERSION,
    documentId: document.documentId,
    revision: document.revision,
    pageId,
    measurements,
  };
}

function measurePlainText(
  node: TextNode,
  provider: TextLayoutProvider,
): TextLayoutQualityMeasurement {
  const fullRequest = plainTextRequest(node, false);
  const fullResult = safeMeasure(provider, fullRequest);
  if (!fullResult.ok) return unavailable(node.id, fullResult.message);
  const displayResult =
    node.properties.textTruncation === "ending" &&
    node.properties.maxLines !== null
      ? safeMeasure(provider, plainTextRequest(node, true))
      : fullResult;
  if (!displayResult.ok) return unavailable(node.id, displayResult.message);
  if (
    displayResult.provider !== fullResult.provider ||
    displayResult.providerVersion !== fullResult.providerVersion
  ) {
    return unavailable(
      node.id,
      "Text layout evidence providers returned inconsistent identities",
    );
  }
  const overflow =
    node.properties.textResize === "fixed"
      ? {
          horizontal:
            fullResult.size.width > node.size.width + MEASUREMENT_TOLERANCE,
          vertical:
            fullResult.size.height > node.size.height + MEASUREMENT_TOLERANCE,
        }
      : { horizontal: false, vertical: false };
  const truncated =
    node.properties.textTruncation === "ending" &&
    (overflow.horizontal ||
      overflow.vertical ||
      fullResult.size.width >
        displayResult.size.width + MEASUREMENT_TOLERANCE ||
      fullResult.size.height >
        displayResult.size.height + MEASUREMENT_TOLERANCE);
  return {
    status: "measured",
    nodeId: node.id,
    provider: fullResult.provider,
    providerVersion: fullResult.providerVersion,
    boxSize: roundedSize(node.size),
    fullContentSize: roundedSize(fullResult.size),
    displayedContentSize: roundedSize(displayResult.size),
    overflow,
    truncated,
  };
}

function plainTextRequest(
  node: TextNode,
  preserveTruncation: boolean,
): TextLayoutRequest {
  const wraps = node.properties.textWrap !== "none";
  return {
    content: node.properties.content,
    fontFamily: node.properties.fontFamily,
    fontStyleName: node.properties.fontStyleName,
    fontSize: node.properties.fontSize,
    fontWeight: node.properties.fontWeight,
    fontSlant: node.properties.fontSlant,
    letterSpacing: node.properties.letterSpacing,
    lineHeight: node.properties.lineHeight,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
    textCase: node.properties.textCase,
    textDecoration: node.properties.textDecoration,
    textTruncation: preserveTruncation
      ? node.properties.textTruncation
      : "disabled",
    maxLines: preserveTruncation ? node.properties.maxLines : null,
    mode: wraps ? "auto-height" : "auto-width",
    textWrap: node.properties.textWrap,
    ...(wraps ? { width: node.size.width } : {}),
  };
}

function measureRichText(
  node: TextNode,
  provider: TextRunLayoutProvider<LeaferTextRunStyle>,
): TextLayoutQualityMeasurement {
  if (node.properties.textAlignHorizontal === "justify") {
    return unavailable(
      node.id,
      "Rich text justified layout is not supported by the production text-run layout provider",
    );
  }
  const request: TextRunLayoutRequest<LeaferTextRunStyle> = {
    baseStyle: leaferTextRunStyle(node.properties),
    content: node.properties.content,
    mode: node.properties.textResize,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
    listSpacing: node.properties.listSpacing,
    maxLines: node.properties.maxLines,
    hangingList: node.properties.hangingList,
    paragraphRuns: node.properties.paragraphRuns ?? [],
    runs: (node.properties.runs ?? []).map((run) => ({
      ...run,
      style: leaferTextRunStyle(run.style),
    })),
    textAlignHorizontal: node.properties.textAlignHorizontal,
    textAlignVertical: node.properties.textAlignVertical,
    textTruncation: node.properties.textTruncation,
    textWrap: node.properties.textWrap,
    ...(node.properties.textResize === "auto-width"
      ? {}
      : node.properties.textResize === "auto-height"
        ? { width: node.size.width }
        : { width: node.size.width, height: node.size.height }),
  };
  let result: ReturnType<typeof provider.layout>;
  try {
    result = provider.layout(request);
  } catch (error) {
    return unavailable(node.id, errorMessage(error));
  }
  const issue = validateTextRunLayoutResult(result, request);
  if (issue) {
    return unavailable(
      node.id,
      `Text-run layout provider returned invalid quality evidence: ${issue}`,
    );
  }
  if (!result.ok) return unavailable(node.id, result.message);
  const bounds = result.fullContentBounds;
  const overflow =
    node.properties.textResize === "fixed"
      ? {
          horizontal:
            bounds.x < -MEASUREMENT_TOLERANCE ||
            bounds.x + bounds.width > node.size.width + MEASUREMENT_TOLERANCE,
          vertical:
            bounds.y < -MEASUREMENT_TOLERANCE ||
            bounds.y + bounds.height > node.size.height + MEASUREMENT_TOLERANCE,
        }
      : { horizontal: false, vertical: false };
  const fullContentSize = roundedSize({
    width: bounds.width,
    height: bounds.height,
  });
  const displayedContentSize = roundedSize({
    width: result.contentBounds.width,
    height: result.contentBounds.height,
  });
  return {
    status: "measured",
    nodeId: node.id,
    provider: result.provider,
    providerVersion: result.providerVersion,
    boxSize: roundedSize(node.size),
    fullContentSize,
    displayedContentSize,
    overflow,
    truncated: result.truncated,
  };
}

function safeMeasure(
  provider: TextLayoutProvider,
  request: TextLayoutRequest,
): ReturnType<TextLayoutProvider["measure"]> {
  try {
    const result = provider.measure(request);
    const issue = validateTextLayoutResult(result);
    return issue
      ? {
          ok: false,
          code: "measurement-failed",
          message: `Text layout provider returned invalid quality evidence: ${issue}`,
          retryable: true,
        }
      : result;
  } catch (error) {
    return {
      ok: false,
      code: "measurement-failed",
      message: errorMessage(error),
      retryable: true,
    };
  }
}

function leaferTextRunStyle(style: TextRunStyle): LeaferTextRunStyle {
  return {
    fontFamily: style.fontFamily,
    fontStyleName: style.fontStyleName,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontSlant: style.fontSlant,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    textCase: style.textCase,
    textDecoration: style.textDecoration,
    fill: structuredClone(style.fills),
  };
}

function hasRichText(node: TextNode): boolean {
  return (
    (node.properties.runs?.length ?? 0) > 0 ||
    (node.properties.paragraphRuns?.length ?? 0) > 0
  );
}

function unavailable(
  nodeId: string,
  message: string,
): TextLayoutQualityMeasurement {
  return { status: "unavailable", nodeId, message: message.slice(0, 4_000) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Text layout measurement failed";
}

function roundedSize(size: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: round(size.width),
    height: round(size.height),
  };
}

function round(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
}
