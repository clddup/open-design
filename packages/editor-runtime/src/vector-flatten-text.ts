import type {
  Paint,
  TextNode,
  TextRunStyle,
  Transform,
} from "@opendesign/design-contracts";
import {
  validateTextRunLayoutResult,
  type TextRunLayoutProvider,
  type TextRunLayoutRequest,
  type TextRunLayoutStyle,
} from "@opendesign/text-service";
import { multiplyTransforms } from "./geometry.js";
import { textRunBaseStyle } from "./rich-text-operations.js";

export type FlattenTextRunStyle = TextRunLayoutStyle & { fill: unknown };

export type FlattenTextGlyph = {
  fills: readonly Paint[];
  path: string;
  transform: Transform;
};

export type FlattenTextResult =
  | { ok: true; glyphs: readonly FlattenTextGlyph[] }
  | { ok: false; message: string };

export function resolveFlattenTextGlyphs(
  node: TextNode,
  provider: TextRunLayoutProvider<FlattenTextRunStyle> | undefined,
): FlattenTextResult {
  const unsupported = unsupportedTextSemantics(node);
  if (unsupported) return failure(unsupported);
  if (!provider) {
    return failure(
      `Text ${node.id} requires an exact glyph-outline provider before Flatten`,
    );
  }
  const request = textLayoutRequest(node);
  const result = runTextLayout(provider, request, node.id);
  if (!result.ok) return result;
  const layout = result.value;
  const issue = validateTextRunLayoutResult(layout, request);
  if (issue || !layout.ok) {
    return failure(
      issue ??
        (layout.ok ? "Text glyph outline layout failed" : layout.message),
    );
  }
  if (
    layout.provider !== provider.id ||
    layout.providerVersion !== provider.version
  ) {
    return failure("Text glyph outline provider identity is inconsistent");
  }
  const glyphs: FlattenTextGlyph[] = [];
  for (const fragment of layout.fragments) {
    if (!fragment.glyphs) {
      return failure(
        `Text ${node.id} provider did not return editable glyph outlines`,
      );
    }
    appendGlyphs(
      glyphs,
      fragment.glyphs,
      node.transform,
      fragment.x,
      fragment.y + fragment.baseline,
      paintsAt(
        node,
        sourcePaintOffset(layout.sourceContentEnd, fragment.start),
      ),
    );
    appendDecorationPaths(
      glyphs,
      fragment.decorations ?? [],
      node.transform,
      fragment.x,
      fragment.y + fragment.baseline,
      paintsAt(
        node,
        sourcePaintOffset(layout.sourceContentEnd, fragment.start),
      ),
    );
  }
  for (const marker of layout.markers) {
    if (!marker.glyphs) {
      return failure(
        `Text ${node.id} provider did not return editable marker outlines`,
      );
    }
    appendGlyphs(
      glyphs,
      marker.glyphs,
      node.transform,
      marker.x,
      marker.y + marker.baseline,
      paintsAt(node, marker.paragraphStart),
    );
    appendDecorationPaths(
      glyphs,
      marker.decorations ?? [],
      node.transform,
      marker.x,
      marker.y + marker.baseline,
      paintsAt(node, marker.paragraphStart),
    );
  }
  return { ok: true, glyphs };
}

function runTextLayout(
  provider: TextRunLayoutProvider<FlattenTextRunStyle>,
  request: TextRunLayoutRequest<FlattenTextRunStyle>,
  nodeId: string,
):
  | { ok: true; value: ReturnType<typeof provider.layout> }
  | { ok: false; message: string } {
  try {
    return { ok: true, value: provider.layout(request) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Text ${nodeId} glyph outline provider failed: ${detail}`,
    };
  }
}

function textLayoutRequest(
  node: TextNode,
): TextRunLayoutRequest<FlattenTextRunStyle> {
  if (node.properties.textAlignHorizontal === "justify") {
    throw new Error("Justified Text cannot reach glyph outline layout");
  }
  return {
    baseStyle: providerStyle(textRunBaseStyle(node)),
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
      style: providerStyle(run.style),
    })),
    textAlignHorizontal: node.properties.textAlignHorizontal,
    textAlignVertical: node.properties.textAlignVertical,
    textTruncation: node.properties.textTruncation,
    textWrap: node.properties.textWrap,
    ...(node.properties.textResize === "auto-width"
      ? {}
      : { width: node.size.width }),
    ...(node.properties.textResize === "fixed"
      ? { height: node.size.height }
      : {}),
  };
}

function providerStyle(style: TextRunStyle): FlattenTextRunStyle {
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
    fill: null,
  };
}

function appendGlyphs(
  output: FlattenTextGlyph[],
  glyphs: readonly {
    path: string;
    x: number;
    y: number;
  }[],
  nodeTransform: Transform,
  offsetX: number,
  baselineY: number,
  fills: readonly Paint[],
): void {
  for (const glyph of glyphs) {
    if (!glyph.path) continue;
    output.push({
      fills,
      path: glyph.path,
      transform: multiplyTransforms(nodeTransform, [
        1,
        0,
        0,
        -1,
        offsetX + glyph.x,
        baselineY - glyph.y,
      ]),
    });
  }
}

function appendDecorationPaths(
  output: FlattenTextGlyph[],
  decorations: readonly { path: string }[],
  nodeTransform: Transform,
  offsetX: number,
  baselineY: number,
  fills: readonly Paint[],
): void {
  for (const decoration of decorations) {
    output.push({
      fills,
      path: decoration.path,
      transform: multiplyTransforms(nodeTransform, [
        1,
        0,
        0,
        -1,
        offsetX,
        baselineY,
      ]),
    });
  }
}

function paintsAt(node: TextNode, offset: number): readonly Paint[] {
  const run = node.properties.runs?.find(
    (candidate) => offset >= candidate.start && offset < candidate.end,
  );
  return run?.style.fills ?? node.properties.fills;
}

function sourcePaintOffset(
  sourceContentEnd: number,
  displayOffset: number,
): number {
  return Math.min(displayOffset, Math.max(0, sourceContentEnd - 1));
}

function unsupportedTextSemantics(node: TextNode): string | null {
  if (node.properties.textAlignHorizontal === "justify") {
    return `Text ${node.id} justified alignment cannot yet be flattened exactly`;
  }
  if (
    node.properties.textTruncation === "disabled" &&
    node.properties.textOverflow !== "visible"
  ) {
    return `Text ${node.id} clipping or truncation cannot yet be flattened exactly`;
  }
  return null;
}

function failure(message: string): FlattenTextResult {
  return { ok: false, message };
}
