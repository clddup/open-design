import { describe, expect, it, vi } from "vitest";
import {
  memoizeTextLayoutProvider,
  validateTextFontAvailabilityResult,
  validateTextFirstBaselineRequest,
  validateTextFirstBaselineResult,
  validateTextFontDescriptor,
  validateTextLayoutRequest,
  validateTextLayoutResult,
  type TextLayoutProvider,
  type TextLayoutRequest,
  type TextFirstBaselineRequest,
} from "./index.js";

const autoHeight: TextLayoutRequest = {
  content: "A professional text layout",
  fontFamily: "Inter, sans-serif",
  fontStyleName: "Semi Bold Italic",
  fontSize: 24,
  fontWeight: 600,
  fontSlant: "italic",
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

const fixedBaseline: TextFirstBaselineRequest = {
  content: "OpenDesign",
  fontFamily: "Inter",
  fontStyleName: "Regular",
  fontSize: 20,
  fontWeight: 400,
  fontSlant: "normal",
  letterSpacing: 0,
  lineHeight: 28,
  paragraphIndent: 0,
  paragraphSpacing: 0,
  textCase: "original",
  textDecoration: "none",
  textTruncation: "disabled",
  maxLines: null,
  mode: "fixed",
  textWrap: "word",
  textAlignVertical: "center",
  width: 160,
  height: 48,
};

describe("text layout service contract", () => {
  it("validates bounded font descriptors and availability facts", () => {
    expect(
      validateTextFontDescriptor({
        fontFamily: "Inter",
        fontStyleName: "Medium",
        fontWeight: 500,
        fontSlant: "normal",
      }),
    ).toBeNull();
    expect(
      validateTextFontDescriptor({
        fontFamily: "",
        fontStyleName: "Medium",
        fontWeight: 500,
        fontSlant: "normal",
      }),
    ).toContain("font family");
    expect(
      validateTextFontDescriptor({
        fontFamily: "Inter",
        fontStyleName: null,
        fontWeight: 1_001,
        fontSlant: "normal",
      }),
    ).toContain("1 to 1000");
    expect(
      validateTextFontDescriptor({
        fontFamily: "Inter",
        fontStyleName: "",
        fontWeight: 500,
        fontSlant: "normal",
      }),
    ).toContain("style name");
    expect(
      validateTextFontDescriptor({
        fontFamily: "Inter",
        fontStyleName: "Medium",
        fontWeight: 500,
        fontSlant: "oblique" as "italic",
      }),
    ).toContain("slant");
    expect(
      validateTextFontAvailabilityResult({
        status: "missing",
        provider: "test-provider",
        providerVersion: "1",
        message: "The requested face is not loaded",
      }),
    ).toBeNull();
    expect(
      validateTextFontAvailabilityResult({
        status: "maybe",
        provider: "test-provider",
        providerVersion: "1",
        message: "Unknown state",
      }),
    ).toContain("invalid result");
  });

  it("accepts canonical Auto Width and Auto Height requests", () => {
    expect(validateTextLayoutRequest(autoHeight)).toBeNull();
    expect(
      validateTextLayoutRequest({
        content: autoHeight.content,
        fontFamily: autoHeight.fontFamily,
        fontStyleName: autoHeight.fontStyleName,
        fontSize: autoHeight.fontSize,
        fontWeight: autoHeight.fontWeight,
        fontSlant: autoHeight.fontSlant,
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
    provider.measure({
      ...autoHeight,
      fontStyleName: "Semi Bold",
      fontSlant: "normal",
    });
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("validates and memoizes bounded first-line baseline measurements", () => {
    expect(validateTextFirstBaselineRequest(fixedBaseline)).toBeNull();
    expect(
      validateTextFirstBaselineRequest({
        ...fixedBaseline,
        textAlignVertical: "justify" as "center",
      }),
    ).toContain("vertical alignment");
    expect(
      validateTextFirstBaselineResult({
        ok: true,
        provider: "test-provider",
        providerVersion: "1",
        baseline: Number.NaN,
      }),
    ).toContain("invalid metrics");
    const measureFirstBaseline = vi.fn(() => ({
      ok: true as const,
      provider: "test-provider",
      providerVersion: "1",
      baseline: 22,
    }));
    const provider = memoizeTextLayoutProvider({
      id: "test-provider",
      version: "1",
      measure: () => ({
        ok: true,
        provider: "test-provider",
        providerVersion: "1",
        size: { width: 160, height: 48 },
        warnings: [],
      }),
      measureFirstBaseline,
    });
    expect(provider.measureFirstBaseline?.(fixedBaseline)).toEqual(
      provider.measureFirstBaseline?.(fixedBaseline),
    );
    expect(measureFirstBaseline).toHaveBeenCalledTimes(1);
  });

  it("forwards uncached font availability inspection", () => {
    const inspectFont = vi.fn<NonNullable<TextLayoutProvider["inspectFont"]>>(
      () => ({
        status: "available",
        provider: "test-provider",
        providerVersion: "1.0.0",
        message: "The requested face is loaded",
      }),
    );
    const provider = memoizeTextLayoutProvider({
      id: "test-provider",
      version: "1.0.0",
      inspectFont,
      measure: () => ({
        ok: true,
        provider: "test-provider",
        providerVersion: "1.0.0",
        size: { width: 240, height: 64 },
        warnings: [],
      }),
    });

    expect(
      provider.inspectFont?.({
        fontFamily: "Inter",
        fontStyleName: "Medium",
        fontWeight: 500,
        fontSlant: "normal",
      }),
    ).toMatchObject({ status: "available" });
    expect(
      provider.inspectFont?.({
        fontFamily: "Inter",
        fontStyleName: "Medium",
        fontWeight: 500,
        fontSlant: "normal",
      }),
    ).toMatchObject({ status: "available" });
    expect(inspectFont).toHaveBeenCalledTimes(2);
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
