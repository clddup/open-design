import type {
  DesignDocument,
  TextRunStyle,
} from "@opendesign/design-contracts";
import type { TextRunLayoutProvider } from "@opendesign/text-service";
import { mapTextRunPaints } from "./mapping.js";
import {
  leaferTextRunLayoutToProjection,
  type LeaferTextRunStyle,
} from "./text-run-layout.js";
import type { LeaferTextRunProjectionResolution } from "./text-run-projection.js";
import type { LeaferFidelityWarning } from "./types.js";

export interface DesignTextRunResolution {
  projection: LeaferTextRunProjectionResolution;
  warnings: readonly LeaferFidelityWarning[];
}

export function resolveDesignTextRuns(
  document: DesignDocument,
  pageId: string,
  provider: TextRunLayoutProvider<LeaferTextRunStyle>,
): DesignTextRunResolution {
  const page = document.pagesById[pageId];
  if (!page) throw new Error(`Page ${pageId} does not exist`);
  const resultsByNodeId = new Map();
  const warnings: LeaferFidelityWarning[] = [];
  const visit = (nodeId: string): void => {
    const node = document.nodesById[nodeId];
    if (!node) return;
    if (
      node.kind === "text" &&
      ((node.properties.runs?.length ?? 0) > 0 ||
        (node.properties.paragraphRuns?.length ?? 0) > 0)
    ) {
      try {
        if (node.properties.textAlignHorizontal === "justify") {
          throw new Error("Rich text justified alignment is not supported yet");
        }
        const result = provider.layout({
          baseStyle: leaferStyle(
            document,
            node.id,
            {
              fontFamily: node.properties.fontFamily,
              fontStyleName: node.properties.fontStyleName,
              fontSize: node.properties.fontSize,
              fontWeight: node.properties.fontWeight,
              fontSlant: node.properties.fontSlant,
              letterSpacing: node.properties.letterSpacing,
              lineHeight: node.properties.lineHeight,
              textCase: node.properties.textCase,
              textDecoration: node.properties.textDecoration,
              fills: node.properties.fills,
            },
            warnings,
          ),
          content: node.properties.content,
          mode: node.properties.textResize,
          paragraphIndent: node.properties.paragraphIndent,
          paragraphSpacing: node.properties.paragraphSpacing,
          listSpacing: node.properties.listSpacing,
          maxLines: node.properties.maxLines,
          hangingList: node.properties.hangingList,
          paragraphRuns: node.properties.paragraphRuns ?? [],
          runs: (node.properties.runs ?? []).map((run) => ({
            start: run.start,
            end: run.end,
            style: leaferStyle(document, node.id, run.style, warnings),
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
        });
        if (!result.ok) throw new Error(result.message);
        resultsByNodeId.set(
          node.id,
          leaferTextRunLayoutToProjection(node.id, result),
        );
      } catch (error) {
        warnings.push({
          code: "rich-text-layout-failed",
          message:
            error instanceof Error
              ? error.message
              : `Rich text layout failed for ${node.id}`,
          nodeId: node.id,
        });
      }
    }
    node.childIds.forEach(visit);
  };
  page.rootNodeIds.forEach(visit);
  return {
    projection: {
      documentId: document.documentId,
      pageId,
      revision: document.revision,
      resultsByNodeId,
    },
    warnings,
  };
}

function leaferStyle(
  document: DesignDocument,
  nodeId: string,
  style: TextRunStyle,
  warnings: LeaferFidelityWarning[],
): LeaferTextRunStyle {
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
    fill: mapTextRunPaints(document, nodeId, style.fills, warnings),
  };
}
