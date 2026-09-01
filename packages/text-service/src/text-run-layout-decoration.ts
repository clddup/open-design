export type TextRunLayoutDecorationKind = "strikethrough" | "underline";

/**
 * Closed outline in fragment-local, baseline-relative font coordinates.
 * Positive Y points upward, matching glyph outlines returned by the provider.
 */
export interface TextRunLayoutDecoration {
  color: "auto" | { color: string; opacity: number; type: "solid" };
  kind: TextRunLayoutDecorationKind;
  path: string;
  style: "dotted" | "solid" | "wavy";
}

export interface TextRunLayoutDecorationValidation {
  issue: string | null;
  pathCharacters: number;
}

const MAX_DECORATION_PATH_CHARACTERS = 1_000_000;

export function validateTextRunLayoutDecorations(
  value: unknown,
  expected: "none" | TextRunLayoutDecorationKind,
  visibleWidth: number,
): TextRunLayoutDecorationValidation {
  if (value === undefined) {
    return expected === "none" || visibleWidth === 0 ? valid(0) : invalid();
  }
  if (!Array.isArray(value)) return invalid();
  if (expected === "none" || visibleWidth === 0) {
    return value.length === 0 ? valid(0) : invalid();
  }
  if (value.length !== 1) return invalid();
  const decoration: unknown = value[0];
  if (
    !isRecord(decoration) ||
    decoration.kind !== expected ||
    !validStyle(decoration.style) ||
    !validColor(decoration.color) ||
    typeof decoration.path !== "string" ||
    decoration.path.length === 0 ||
    decoration.path.length > MAX_DECORATION_PATH_CHARACTERS
  ) {
    return invalid();
  }
  return valid(decoration.path.length);
}

function validStyle(value: unknown): boolean {
  return value === "solid" || value === "wavy" || value === "dotted";
}

function validColor(value: unknown): boolean {
  if (value === "auto") return true;
  return (
    isRecord(value) &&
    value.type === "solid" &&
    typeof value.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.color) &&
    typeof value.opacity === "number" &&
    Number.isFinite(value.opacity) &&
    value.opacity >= 0 &&
    value.opacity <= 1
  );
}

function valid(pathCharacters: number): TextRunLayoutDecorationValidation {
  return { issue: null, pathCharacters };
}

function invalid(): TextRunLayoutDecorationValidation {
  return {
    issue: "Text run layout provider returned invalid decoration outlines",
    pathCharacters: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
