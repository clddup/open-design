export const TEXT_LAYOUT_SERVICE_CONTRACT_VERSION = 4 as const;
export const MAX_TEXT_LAYOUT_CHARACTERS = 1_000_000;
export const MAX_TEXT_LAYOUT_CACHE_KEY_CHARACTERS = 4_000_000;
export const MAX_TEXT_LAYOUT_DIMENSION = 1_000_000;
export const MAX_TEXT_LAYOUT_FONT_FAMILY_CHARACTERS = 4_096;
export const MAX_TEXT_LAYOUT_FONT_STYLE_NAME_CHARACTERS = 512;
export const MAX_TEXT_LAYOUT_MESSAGE_CHARACTERS = 8_192;
export const MAX_TEXT_LAYOUT_PROVIDER_ID_CHARACTERS = 256;
export const MAX_TEXT_LAYOUT_WARNINGS = 8;

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

export interface TextLayoutRequest {
  content: string;
  fontFamily: string;
  fontStyleName: string | null;
  fontSize: number;
  fontWeight: number;
  fontSlant: "normal" | "italic";
  letterSpacing: number;
  lineHeight: number;
  paragraphIndent: number;
  paragraphSpacing: number;
  textCase: TextLayoutCase;
  textDecoration: TextLayoutDecoration;
  textTruncation: TextLayoutTruncation;
  maxLines: number | null;
  mode: Exclude<TextResizeMode, "fixed">;
  textWrap: TextLayoutWrap;
  width?: number;
}

export interface TextLayoutWarning {
  code: "font-fallback";
  fallback: string;
  message: string;
}

export type TextLayoutFailureCode =
  "invalid-input" | "measurement-failed" | "provider-unavailable";

export type TextLayoutResult =
  | {
      ok: true;
      provider: string;
      providerVersion: string;
      size: { height: number; width: number };
      warnings: readonly TextLayoutWarning[];
    }
  | {
      ok: false;
      code: TextLayoutFailureCode;
      message: string;
      retryable: boolean;
    };

export interface TextLayoutProvider {
  readonly id: string;
  readonly version: string;
  inspectFont?(descriptor: TextFontDescriptor): TextFontAvailabilityResult;
  measure(request: TextLayoutRequest): TextLayoutResult;
}

export function validateTextFontDescriptor(
  descriptor: TextFontDescriptor,
): string | null {
  if (
    typeof descriptor.fontFamily !== "string" ||
    descriptor.fontFamily.trim().length === 0 ||
    descriptor.fontFamily.length > MAX_TEXT_LAYOUT_FONT_FAMILY_CHARACTERS
  ) {
    return "Font inspection requires a bounded non-empty font family";
  }
  if (
    descriptor.fontStyleName !== null &&
    (typeof descriptor.fontStyleName !== "string" ||
      descriptor.fontStyleName.trim().length === 0 ||
      descriptor.fontStyleName.length >
        MAX_TEXT_LAYOUT_FONT_STYLE_NAME_CHARACTERS)
  ) {
    return "Font inspection style name must be null or a bounded non-empty string";
  }
  if (
    !Number.isInteger(descriptor.fontWeight) ||
    descriptor.fontWeight < 1 ||
    descriptor.fontWeight > 1_000
  ) {
    return "Font inspection weight must be an integer from 1 to 1000";
  }
  if (descriptor.fontSlant !== "normal" && descriptor.fontSlant !== "italic") {
    return "Font inspection slant must be normal or italic";
  }
  return null;
}

export function validateTextFontAvailabilityResult(
  value: unknown,
): string | null {
  if (
    !isRecord(value) ||
    (value.status !== "available" &&
      value.status !== "missing" &&
      value.status !== "unknown") ||
    typeof value.provider !== "string" ||
    value.provider.length === 0 ||
    value.provider.length > MAX_TEXT_LAYOUT_PROVIDER_ID_CHARACTERS ||
    typeof value.providerVersion !== "string" ||
    value.providerVersion.length === 0 ||
    value.providerVersion.length > MAX_TEXT_LAYOUT_PROVIDER_ID_CHARACTERS ||
    typeof value.message !== "string" ||
    value.message.length === 0 ||
    value.message.length > MAX_TEXT_LAYOUT_MESSAGE_CHARACTERS
  ) {
    return "Font availability provider returned an invalid result";
  }
  return null;
}

export function validateTextLayoutRequest(
  request: TextLayoutRequest,
): string | null {
  if (
    typeof request.content !== "string" ||
    request.content.length > MAX_TEXT_LAYOUT_CHARACTERS
  ) {
    return `Text layout content exceeds ${MAX_TEXT_LAYOUT_CHARACTERS} characters`;
  }
  if (
    typeof request.fontFamily !== "string" ||
    request.fontFamily.trim().length === 0 ||
    request.fontFamily.length > MAX_TEXT_LAYOUT_FONT_FAMILY_CHARACTERS
  ) {
    return "Text layout requires a bounded non-empty font family";
  }
  if (
    request.fontStyleName !== null &&
    (typeof request.fontStyleName !== "string" ||
      request.fontStyleName.trim().length === 0 ||
      request.fontStyleName.length > MAX_TEXT_LAYOUT_FONT_STYLE_NAME_CHARACTERS)
  ) {
    return "Text layout style name must be null or a bounded non-empty string";
  }
  if (!positiveBounded(request.fontSize)) {
    return "Text layout font size is outside supported finite limits";
  }
  if (!positiveBounded(request.lineHeight)) {
    return "Text layout line height is outside supported finite limits";
  }
  if (
    !Number.isInteger(request.fontWeight) ||
    request.fontWeight < 1 ||
    request.fontWeight > 1_000
  ) {
    return "Text layout font weight must be an integer from 1 to 1000";
  }
  if (request.fontSlant !== "normal" && request.fontSlant !== "italic") {
    return "Text layout font slant must be normal or italic";
  }
  if (
    !Number.isFinite(request.letterSpacing) ||
    Math.abs(request.letterSpacing) > MAX_TEXT_LAYOUT_DIMENSION
  ) {
    return "Text layout letter spacing is outside supported finite limits";
  }
  if (!nonNegativeBounded(request.paragraphIndent)) {
    return "Text layout paragraph indent is outside supported finite limits";
  }
  if (!nonNegativeBounded(request.paragraphSpacing)) {
    return "Text layout paragraph spacing is outside supported finite limits";
  }
  if (
    ![
      "original",
      "uppercase",
      "lowercase",
      "title-case",
      "small-caps",
    ].includes(request.textCase)
  ) {
    return "Text layout case transform is unsupported";
  }
  if (
    !["none", "underline", "strikethrough"].includes(request.textDecoration)
  ) {
    return "Text layout decoration is unsupported";
  }
  if (
    request.textTruncation !== "disabled" &&
    request.textTruncation !== "ending"
  ) {
    return "Text layout truncation mode is unsupported";
  }
  if (
    request.maxLines !== null &&
    (!Number.isSafeInteger(request.maxLines) || request.maxLines < 1)
  ) {
    return "Text layout max lines must be null or a positive integer";
  }
  if (request.textTruncation === "disabled" && request.maxLines !== null) {
    return "Text layout max lines require ending truncation";
  }
  if (request.textTruncation === "ending" && request.maxLines === null) {
    return "Auto Size ending truncation requires max lines";
  }
  if (request.mode === "auto-width") {
    if (request.width !== undefined) {
      return "Auto Width text layout must not provide a fixed width";
    }
    if (request.textWrap !== "none") {
      return "Auto Width text layout only supports explicit line breaks";
    }
    return null;
  }
  if (request.mode !== "auto-height") {
    return "Text layout mode is unsupported";
  }
  if (!positiveBounded(request.width)) {
    return "Auto Height text layout requires a finite positive width";
  }
  if (request.textWrap !== "word" && request.textWrap !== "character") {
    return "Auto Height text layout requires word or character wrapping";
  }
  return null;
}

export function validateTextLayoutResult(value: unknown): string | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return "Text layout provider returned an invalid result";
  }
  if (!value.ok) {
    if (
      !["invalid-input", "measurement-failed", "provider-unavailable"].includes(
        String(value.code),
      ) ||
      typeof value.message !== "string" ||
      value.message.length === 0 ||
      value.message.length > MAX_TEXT_LAYOUT_MESSAGE_CHARACTERS ||
      typeof value.retryable !== "boolean"
    ) {
      return "Text layout provider returned an invalid failure";
    }
    return null;
  }
  if (
    typeof value.provider !== "string" ||
    value.provider.length === 0 ||
    value.provider.length > MAX_TEXT_LAYOUT_PROVIDER_ID_CHARACTERS ||
    typeof value.providerVersion !== "string" ||
    value.providerVersion.length === 0 ||
    value.providerVersion.length > MAX_TEXT_LAYOUT_PROVIDER_ID_CHARACTERS
  ) {
    return "Text layout provider identity is missing";
  }
  const size = value.size;
  if (
    !isRecord(size) ||
    !nonNegativeBounded(size.width) ||
    !nonNegativeBounded(size.height)
  ) {
    return "Text layout provider returned invalid bounds";
  }
  const warnings = value.warnings;
  if (
    !Array.isArray(warnings) ||
    warnings.length > MAX_TEXT_LAYOUT_WARNINGS ||
    warnings.some(
      (warning) =>
        !isRecord(warning) ||
        warning.code !== "font-fallback" ||
        typeof warning.message !== "string" ||
        warning.message.length === 0 ||
        warning.message.length > MAX_TEXT_LAYOUT_MESSAGE_CHARACTERS ||
        typeof warning.fallback !== "string" ||
        warning.fallback.length > MAX_TEXT_LAYOUT_MESSAGE_CHARACTERS,
    )
  ) {
    return "Text layout provider returned invalid warnings";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function memoizeTextLayoutProvider(
  provider: TextLayoutProvider,
  maxEntries = 1_024,
): TextLayoutProvider {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError("Text layout cache size must be a positive integer");
  }
  const results = new Map<string, TextLayoutResult>();
  let keyCharacters = 0;
  return {
    id: provider.id,
    version: provider.version,
    ...(provider.inspectFont
      ? {
          inspectFont(descriptor: TextFontDescriptor) {
            return structuredClone(provider.inspectFont!(descriptor));
          },
        }
      : {}),
    measure(request) {
      const key = JSON.stringify(request);
      const cached = results.get(key);
      if (cached) {
        results.delete(key);
        results.set(key, cached);
        return structuredClone(cached);
      }
      const result = provider.measure(request);
      if (
        (result.ok || !result.retryable) &&
        key.length <= MAX_TEXT_LAYOUT_CACHE_KEY_CHARACTERS
      ) {
        results.set(key, structuredClone(result));
        keyCharacters += key.length;
      }
      while (
        results.size > maxEntries ||
        keyCharacters > MAX_TEXT_LAYOUT_CACHE_KEY_CHARACTERS
      ) {
        const oldest = results.keys().next().value;
        if (oldest === undefined) break;
        keyCharacters -= oldest.length;
        results.delete(oldest);
      }
      return structuredClone(result);
    },
  };
}

function positiveBounded(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_TEXT_LAYOUT_DIMENSION
  );
}

function nonNegativeBounded(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_TEXT_LAYOUT_DIMENSION
  );
}
