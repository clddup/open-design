import {
  memoizeTextLayoutProvider,
  validateTextLayoutRequest,
  validateTextLayoutResult,
  type TextLayoutProvider,
  type TextLayoutRequest,
  type TextLayoutResult,
} from "@opendesign/text-service";
import type * as LeaferEditorModule from "leafer-editor";
import { materializeLeaferTextData } from "./text-truncation.js";

export const LEAFER_TEXT_LAYOUT_PROVIDER_ID = "leafer-text" as const;
export const LEAFER_TEXT_LAYOUT_PROVIDER_VERSION = "2.2.9" as const;

type LeaferModule = typeof LeaferEditorModule;

export interface LeaferTextLayoutProviderOptions {
  fontAvailable?: (fontDescriptor: string) => boolean | undefined;
}

export function createLeaferTextLayoutProvider(
  leafer: Pick<LeaferModule, "Text">,
  options: LeaferTextLayoutProviderOptions = {},
): TextLayoutProvider {
  const fontAvailable = options.fontAvailable ?? browserFontAvailable;
  return memoizeTextLayoutProvider({
    id: LEAFER_TEXT_LAYOUT_PROVIDER_ID,
    version: LEAFER_TEXT_LAYOUT_PROVIDER_VERSION,
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
            fontAvailable(fontDescriptor(request)) === false
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

function browserFontAvailable(font: string): boolean | undefined {
  if (typeof document === "undefined" || !document.fonts?.check) {
    return undefined;
  }
  try {
    return document.fonts.check(font);
  } catch {
    return undefined;
  }
}

function fontDescriptor(request: TextLayoutRequest): string {
  return `${request.fontWeight} ${request.fontSize}px ${request.fontFamily}`;
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
