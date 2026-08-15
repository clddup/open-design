import {
  memoizeTextLayoutProvider,
  validateTextFontDescriptor,
  validateTextFontAvailabilityResult,
  validateTextLayoutRequest,
  validateTextLayoutResult,
  type TextFontAvailabilityResult,
  type TextFontDescriptor,
  type TextLayoutProvider,
  type TextLayoutRequest,
  type TextLayoutResult,
} from "@opendesign/text-service";
import type * as LeaferEditorModule from "leafer-editor";
import { materializeLeaferTextData } from "./text-truncation.js";

export const LEAFER_TEXT_LAYOUT_PROVIDER_ID = "leafer-text" as const;
export const LEAFER_TEXT_LAYOUT_PROVIDER_VERSION = "2.2.9" as const;
const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
]);

type LeaferModule = typeof LeaferEditorModule;

export interface LeaferTextLayoutProviderOptions {
  fontAvailable?: (
    fontDescriptor: string,
    descriptor: TextFontDescriptor,
  ) => boolean | undefined;
}

export function createLeaferTextLayoutProvider(
  leafer: Pick<LeaferModule, "Text">,
  options: LeaferTextLayoutProviderOptions = {},
): TextLayoutProvider {
  const fontAvailable = options.fontAvailable ?? browserFontAvailable;
  return memoizeTextLayoutProvider({
    id: LEAFER_TEXT_LAYOUT_PROVIDER_ID,
    version: LEAFER_TEXT_LAYOUT_PROVIDER_VERSION,
    inspectFont(descriptor) {
      return inspectLeaferFont(descriptor, fontAvailable);
    },
    measure(request) {
      const inputIssue = validateTextLayoutRequest(request);
      if (inputIssue) return failure("invalid-input", inputIssue, false);
      let text: InstanceType<LeaferModule["Text"]> | undefined;
      try {
        const data = {
          text: request.content,
          fontFamily: request.fontFamily,
          fontSize: request.fontSize,
          fontWeight: request.fontWeight,
          italic: request.fontSlant === "italic",
          lineHeight: { type: "px", value: request.lineHeight },
          letterSpacing: { type: "px", value: request.letterSpacing },
          paraIndent: request.paragraphIndent,
          paraSpacing: request.paragraphSpacing,
          textCase: mapTextCase(request.textCase),
          textDecoration: mapTextDecoration(request.textDecoration),
          textWrap: mapTextWrap(request.textWrap),
          textOverflow:
            request.textTruncation === "ending" ? "ellipsis" : "show",
          ...(request.mode === "auto-height" ? { width: request.width } : {}),
        };
        text = new leafer.Text(
          materializeLeaferTextData(
            leafer,
            data,
            request.maxLines ?? undefined,
          ),
        );
        const bounds = text.boxBounds;
        const result: TextLayoutResult = {
          ok: true,
          provider: LEAFER_TEXT_LAYOUT_PROVIDER_ID,
          providerVersion: LEAFER_TEXT_LAYOUT_PROVIDER_VERSION,
          size: {
            width:
              request.mode === "auto-height"
                ? normalizeDimension(request.width ?? 0)
                : normalizeDimension(bounds.width),
            height: normalizeDimension(bounds.height),
          },
          warnings:
            inspectLeaferFont(request, fontAvailable).status === "missing"
              ? [
                  {
                    code: "font-fallback",
                    fallback:
                      "Persisted the concrete bounds measured with the browser font fallback",
                    message: `Font ${request.fontFamily} is not currently available; text was measured with the browser fallback`,
                  },
                ]
              : [],
        };
        const resultIssue = validateTextLayoutResult(result);
        return resultIssue
          ? failure("measurement-failed", resultIssue, true)
          : result;
      } catch (error) {
        return failure(
          "measurement-failed",
          error instanceof Error && error.message
            ? `Leafer text measurement failed: ${error.message}`
            : "Leafer text measurement failed",
          true,
        );
      } finally {
        text?.destroy();
      }
    },
  });
}

function inspectLeaferFont(
  descriptor: TextFontDescriptor,
  fontAvailable: NonNullable<LeaferTextLayoutProviderOptions["fontAvailable"]>,
): TextFontAvailabilityResult {
  const descriptorIssue = validateTextFontDescriptor(descriptor);
  const available = descriptorIssue
    ? undefined
    : fontAvailable(fontDescriptor(descriptor), descriptor);
  const result: TextFontAvailabilityResult = {
    status:
      available === true
        ? "available"
        : available === false
          ? "missing"
          : "unknown",
    provider: LEAFER_TEXT_LAYOUT_PROVIDER_ID,
    providerVersion: LEAFER_TEXT_LAYOUT_PROVIDER_VERSION,
    message: descriptorIssue
      ? descriptorIssue
      : available === true
        ? `Font ${descriptor.fontFamily} is available to the current canvas`
        : available === false
          ? `Font ${descriptor.fontFamily} is not available to the current canvas`
          : `Font availability for ${descriptor.fontFamily} cannot be determined in the current canvas`,
  };
  return validateTextFontAvailabilityResult(result)
    ? {
        status: "unknown",
        provider: LEAFER_TEXT_LAYOUT_PROVIDER_ID,
        providerVersion: LEAFER_TEXT_LAYOUT_PROVIDER_VERSION,
        message: "Font availability could not be inspected",
      }
    : result;
}

function browserFontAvailable(
  font: string,
  descriptor: TextFontDescriptor,
): boolean | undefined {
  if (isGenericFontFamily(descriptor.fontFamily)) return true;
  if (typeof document === "undefined" || !document.fonts?.check) {
    return undefined;
  }
  try {
    if (!document.fonts.check(font)) return false;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return undefined;
    const family = cssPrimaryFontFamily(descriptor.fontFamily);
    const sample = "mmmmmmmmmmlliWW@#0123456789汉字かなカナ한글";
    const prefix = descriptor.fontSlant === "italic" ? "italic " : "";
    for (const fallback of ["monospace", "serif", "sans-serif"]) {
      context.font = `${prefix}${descriptor.fontWeight} 72px ${fallback}`;
      const fallbackWidth = context.measureText(sample).width;
      context.font = `${prefix}${descriptor.fontWeight} 72px ${family}, ${fallback}`;
      const requestedWidth = context.measureText(sample).width;
      if (Math.abs(requestedWidth - fallbackWidth) > 0.01) return true;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function fontDescriptor(descriptor: TextFontDescriptor): string {
  return `${descriptor.fontSlant === "italic" ? "italic " : ""}${descriptor.fontWeight} 16px ${cssPrimaryFontFamily(descriptor.fontFamily)}`;
}

function cssPrimaryFontFamily(value: string): string {
  const unquoted = primaryFontFamily(value);
  return GENERIC_FONT_FAMILIES.has(unquoted.toLowerCase())
    ? unquoted.toLowerCase()
    : JSON.stringify(unquoted);
}

function primaryFontFamily(value: string): string {
  const primary = value.split(",", 1)[0]?.trim() || value.trim();
  return (primary.startsWith('"') && primary.endsWith('"')) ||
    (primary.startsWith("'") && primary.endsWith("'"))
    ? primary.slice(1, -1)
    : primary;
}

function isGenericFontFamily(value: string): boolean {
  return GENERIC_FONT_FAMILIES.has(primaryFontFamily(value).toLowerCase());
}

function mapTextWrap(wrap: TextLayoutRequest["textWrap"]): string {
  if (wrap === "word") return "normal";
  if (wrap === "character") return "break";
  return "none";
}

function mapTextCase(value: TextLayoutRequest["textCase"]): string {
  if (value === "uppercase") return "upper";
  if (value === "lowercase") return "lower";
  if (value === "title-case") return "title";
  if (value === "small-caps") return "small-caps";
  return "none";
}

function mapTextDecoration(value: TextLayoutRequest["textDecoration"]): string {
  if (value === "underline") return "under";
  if (value === "strikethrough") return "delete";
  return "none";
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
}

function failure(
  code: "invalid-input" | "measurement-failed",
  message: string,
  retryable: boolean,
): TextLayoutResult {
  return { ok: false, code, message, retryable };
}
