export interface TextDecorationGeometryPath {
  fillRule?: "evenodd" | "nonzero";
  path: string;
}

export type TextDecorationGeometryResult =
  | {
      empty: boolean;
      fillRule: "evenodd" | "nonzero";
      ok: true;
      path: string;
    }
  | { message: string; ok: false };

/**
 * Narrow synchronous geometry boundary used by text shaping. The fixed
 * VectorGeometryProvider satisfies this interface without exposing PathKit.
 */
export interface TextDecorationGeometryProvider {
  combine(
    paths: readonly TextDecorationGeometryPath[],
    operation: "subtract",
  ): TextDecorationGeometryResult;
  transform(
    path: TextDecorationGeometryPath,
    transform: [number, number, number, number, number, number],
  ): TextDecorationGeometryResult;
}

export interface TextDecorationInkGlyph {
  path: string;
  x: number;
  y: number;
}

export type TextDecorationInkResult =
  { empty: boolean; ok: true; path: string } | { message: string; ok: false };

const GLYPHS_PER_DIFFERENCE = 64;

export function subtractTextDecorationInk(
  path: string,
  glyphs: readonly TextDecorationInkGlyph[],
  provider: TextDecorationGeometryProvider,
): TextDecorationInkResult {
  const positioned: TextDecorationGeometryPath[] = [];
  for (const glyph of glyphs) {
    if (glyph.path.length === 0) continue;
    const transformed = provider.transform(
      { path: glyph.path, fillRule: "nonzero" },
      [1, 0, 0, 1, glyph.x, glyph.y],
    );
    if (!transformed.ok) return failure(transformed.message);
    if (!transformed.empty) {
      positioned.push({
        path: transformed.path,
        fillRule: transformed.fillRule,
      });
    }
  }
  if (positioned.length === 0) return { empty: false, ok: true, path };

  let subject: TextDecorationGeometryPath = {
    path,
    fillRule: "nonzero",
  };
  for (
    let start = 0;
    start < positioned.length;
    start += GLYPHS_PER_DIFFERENCE
  ) {
    const result = provider.combine(
      [subject, ...positioned.slice(start, start + GLYPHS_PER_DIFFERENCE)],
      "subtract",
    );
    if (!result.ok) return failure(result.message);
    if (result.empty) return { empty: true, ok: true, path: "" };
    subject = { path: result.path, fillRule: result.fillRule };
  }
  return { empty: false, ok: true, path: subject.path };
}

function failure(message: string): TextDecorationInkResult {
  return {
    message: `Exact underline skip-ink clipping failed: ${message}`,
    ok: false,
  };
}
