import type {
  Paint as OpenDesignPaint,
  SharedStyleDefinition,
} from "@opendesign/design-contracts";

export function toFigmaFontName(value: {
  fontFamily: string;
  fontStyleName: string | null;
}): FontName | null {
  if (value.fontStyleName === null) return null;
  return {
    family: value.fontFamily,
    style: value.fontStyleName,
  };
}

export function figmaTextDecoration(
  value: Extract<
    SharedStyleDefinition,
    { styleType: "TEXT" }
  >["textStyle"]["textDecoration"],
): TextDecoration {
  if (value === "underline") return "UNDERLINE";
  if (value === "strikethrough") return "STRIKETHROUGH";
  return "NONE";
}

export function figmaTextCase(
  value: Extract<
    SharedStyleDefinition,
    { styleType: "TEXT" }
  >["textStyle"]["textCase"],
): TextCase {
  if (value === "uppercase") return "UPPER";
  if (value === "lowercase") return "LOWER";
  if (value === "title-case") return "TITLE";
  if (value === "small-caps") return "SMALL_CAPS";
  return "ORIGINAL";
}

export function openDesignBlendMode(value: BlendMode | undefined) {
  if (!value || value === "NORMAL") return "normal" as const;
  return value.toLowerCase().replaceAll("_", "-") as Exclude<
    NonNullable<OpenDesignPaint["blendMode"]>,
    "pass-through"
  >;
}

export function rgbHex(color: RGB): string {
  return `#${[color.r, color.g, color.b]
    .map((value) =>
      Math.round(Math.min(1, Math.max(0, value)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function utf16Boundary(content: string, index: number): boolean {
  if (index === 0 || index === content.length) return true;
  const before = content.charCodeAt(index - 1);
  const after = content.charCodeAt(index);
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}

export function parseColor(
  value: string,
): { r: number; g: number; b: number; a: number } | null {
  const compact = value
    .trim()
    .match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (!compact) return null;
  const expanded =
    compact.length <= 4
      ? [...compact].map((character) => character.repeat(2)).join("")
      : compact;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16) / 255,
    g: Number.parseInt(expanded.slice(2, 4), 16) / 255,
    b: Number.parseInt(expanded.slice(4, 6), 16) / 255,
    a:
      expanded.length === 8
        ? Number.parseInt(expanded.slice(6, 8), 16) / 255
        : 1,
  };
}

export function figmaBlendMode(value: string | undefined): BlendMode {
  if (!value || value === "pass-through") return "NORMAL";
  return value.replaceAll("-", "_").toUpperCase() as BlendMode;
}
