import { describe, expect, it, vi } from "vitest";
import {
  memoizeTextLayoutProvider,
  validateTextLayoutRequest,
  validateTextLayoutResult,
  type TextLayoutProvider,
  type TextLayoutRequest,
} from "./index.js";

const autoHeight: TextLayoutRequest = {
  content: "A professional text layout",
  fontFamily: "Inter, sans-serif",
  fontSize: 24,
  fontWeight: 600,
  letterSpacing: 0,
  lineHeight: 32,
  paragraphIndent: 0,
  paragraphSpacing: 0,
  textCase: "original",
  textDecoration: "none",
  textTruncation: "disabled",
  maxLines: null,
  mode: "auto-height",
  textWrap: "word",
  width: 240,
};

describe("text layout service contract", () => {
  it("accepts canonical Auto Width and Auto Height requests", () => {
    expect(validateTextLayoutRequest(autoHeight)).toBeNull();
    expect(
      validateTextLayoutRequest({
        content: autoHeight.content,
        fontFamily: autoHeight.fontFamily,
        fontSize: autoHeight.fontSize,
        fontWeight: autoHeight.fontWeight,
        letterSpacing: autoHeight.letterSpacing,
        lineHeight: autoHeight.lineHeight,
        paragraphIndent: autoHeight.paragraphIndent,
        paragraphSpacing: autoHeight.paragraphSpacing,
        textCase: autoHeight.textCase,
        textDecoration: autoHeight.textDecoration,
        textTruncation: autoHeight.textTruncation,
        maxLines: autoHeight.maxLines,
        mode: "auto-width",
        textWrap: "none",
      }),
    ).toBeNull();
  });

  it("rejects ambiguous resize requests and invalid provider output", () => {
    expect(
      validateTextLayoutRequest({
        ...autoHeight,
        mode: "auto-width",
        textWrap: "word",
        width: 240,
      }),
    ).toContain("must not provide");
    expect(
      validateTextLayoutRequest({ ...autoHeight, width: Number.NaN }),
    ).toContain("finite positive width");
    expect(
      validateTextLayoutRequest({
        ...autoHeight,
        textTruncation: "ending",
        maxLines: null,
      }),
    ).toContain("requires max lines");
    expect(
      validateTextLayoutRequest({
        ...autoHeight,
        textTruncation: "ending",
        maxLines: 3,
      }),
    ).toBeNull();
    expect(
      validateTextLayoutResult({
        ok: true,
        provider: "test",
        providerVersion: "1",
        size: { width: Number.NaN, height: 32 },
        warnings: [],
      }),
    ).toContain("invalid bounds");
  });

  it("memoizes exact requests so preview and apply reuse one measurement", () => {
    const measure = vi.fn<TextLayoutProvider["measure"]>(() => ({
      ok: true,
      provider: "test-provider",
      providerVersion: "1.0.0",
      size: { width: 240, height: 64 },
      warnings: [],
    }));
    const provider = memoizeTextLayoutProvider({
      id: "test-provider",
      version: "1.0.0",
      measure,
    });

    expect(provider.measure(autoHeight)).toEqual(provider.measure(autoHeight));
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("uses real LRU recency instead of FIFO eviction", () => {
    const measure = vi.fn<TextLayoutProvider["measure"]>((request) => ({
      ok: true,
      provider: "test-provider",
      providerVersion: "1.0.0",
      size: { width: request.content.length, height: 32 },
      warnings: [],
    }));
    const provider = memoizeTextLayoutProvider(
      { id: "test-provider", version: "1.0.0", measure },
      2,
    );
    const request = (content: string): TextLayoutRequest => ({
      ...autoHeight,
      content,
    });

    provider.measure(request("first"));
    provider.measure(request("second"));
    provider.measure(request("first"));
    provider.measure(request("third"));
    provider.measure(request("second"));

    expect(measure).toHaveBeenCalledTimes(4);
  });

  it("does not memoize retryable provider failures", () => {
    const measure = vi.fn<TextLayoutProvider["measure"]>(() => ({
      ok: false,
      code: "provider-unavailable",
      message: "Font provider is still loading",
      retryable: true,
    }));
    const provider = memoizeTextLayoutProvider({
      id: "test-provider",
      version: "1.0.0",
      measure,
    });

    provider.measure(autoHeight);
    provider.measure(autoHeight);

    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("rejects unbounded provider diagnostics", () => {
    expect(
      validateTextLayoutResult({
        ok: false,
        code: "measurement-failed",
        message: "x".repeat(8_193),
        retryable: true,
      }),
    ).toContain("invalid failure");
    expect(
      validateTextLayoutResult({
        ok: true,
        provider: "test",
        providerVersion: "1",
        size: { width: 120, height: 32 },
        warnings: Array.from({ length: 9 }, () => ({
          code: "font-fallback",
          fallback: "fallback",
          message: "Missing font",
        })),
      }),
    ).toContain("invalid warnings");
  });
});
