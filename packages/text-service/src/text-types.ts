export type TextResizeMode = "auto-width" | "auto-height" | "fixed";
export type TextLayoutWrap = "none" | "word" | "character";
export type TextLayoutCase =
  "original" | "uppercase" | "lowercase" | "title-case" | "small-caps";
export type TextLayoutDecoration = "none" | "underline" | "strikethrough";
export type TextLayoutTruncation = "disabled" | "ending";

export interface TextFontDescriptor {
  fontFamily: string;
  fontStyleName: string | null;
  fontWeight: number;
  fontSlant: "normal" | "italic";
}

export type TextFontAvailabilityStatus = "available" | "missing" | "unknown";

export interface TextFontAvailabilityResult {
  status: TextFontAvailabilityStatus;
  provider: string;
  providerVersion: string;
  message: string;
}

export interface TextLayoutWarning {
  code: "font-fallback";
  fallback: string;
  message: string;
}
