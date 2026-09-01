import type {
  TextRunLayoutProvider,
  TextRunLayoutStyle,
} from "@opendesign/text-service";
import { describe, expect, it, vi } from "vitest";
import { composeTextRunLayoutProviders } from "./text-run-provider-fallback";

describe("text run provider fallback", () => {
  it("uses HarfBuzz only when native layout explicitly cannot shape the run", () => {
    const native = provider("native", {
      ok: false,
      code: "unsupported",
      message: "Contextual shaping required",
      retryable: false,
    });
    const harfBuzz = provider("harfbuzz", success("harfbuzz"));
    const composite = composeTextRunLayoutProviders(native, harfBuzz);
    expect(composite.layout(request())).toMatchObject({
      ok: true,
      provider: "native+harfbuzz",
    });
    expect(native.layout).toHaveBeenCalledTimes(1);
    expect(harfBuzz.layout).toHaveBeenCalledTimes(1);
  });

  it("does not hide invalid native input behind fallback", () => {
    const native = provider("native", {
      ok: false,
      code: "invalid-input",
      message: "Invalid range",
      retryable: false,
    });
    const fallback = provider("harfbuzz", success("harfbuzz"));
    expect(
      composeTextRunLayoutProviders(native, fallback).layout(request()),
    ).toMatchObject({
      ok: false,
      code: "invalid-input",
    });
    expect(fallback.layout).not.toHaveBeenCalled();
  });

  it("falls back for decorated text that requires exact outlines", () => {
    const native = provider("native", {
      ok: false,
      code: "unsupported",
      message: "Exact decoration outline required",
      retryable: false,
    });
    const harfBuzz = provider("harfbuzz", success("harfbuzz"));
    const result = composeTextRunLayoutProviders(native, harfBuzz).layout({
      ...request(),
      baseStyle: {
        ...style(),
        textDecoration: "underline",
        textDecorationStyle: "solid",
        textDecorationOffset: { unit: "auto" },
        textDecorationThickness: { unit: "auto" },
        textDecorationColor: { value: "auto" },
        textDecorationSkipInk: true,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      provider: "native+harfbuzz",
    });
    expect(harfBuzz.layout).toHaveBeenCalledTimes(1);
  });
});

function provider(
  id: string,
  result: ReturnType<TextRunLayoutProvider<TextRunLayoutStyle>["layout"]>,
) {
  return {
    id,
    version: "1",
    layout: vi.fn(() => result),
  } satisfies TextRunLayoutProvider<TextRunLayoutStyle>;
}

function success(providerId: string) {
  return {
    ok: true as const,
    provider: providerId,
    providerVersion: "1",
    size: { width: 10, height: 10 },
    contentBounds: { x: 0, y: 0, width: 10, height: 10 },
    displayContent: "A",
    fullContentBounds: { x: 0, y: 0, width: 10, height: 10 },
    lines: [
      { start: 0, end: 1, x: 0, y: 0, width: 10, height: 10, baseline: 8 },
    ],
    fragments: [
      {
        start: 0,
        end: 1,
        text: "A",
        style: style(),
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        baseline: 8,
        lineIndex: 0,
      },
    ],
    markers: [],
    sourceContentEnd: 1,
    truncated: false,
    warnings: [],
  };
}

function request() {
  return {
    baseStyle: style(),
    content: "A",
    mode: "fixed" as const,
    width: 10,
    height: 10,
    hangingList: false,
    listSpacing: 0,
    maxLines: null,
    paragraphIndent: 0,
    paragraphSpacing: 0,
    runs: [],
    textAlignHorizontal: "left" as const,
    textAlignVertical: "top" as const,
    textTruncation: "disabled" as const,
    textWrap: "character" as const,
  };
}

function style(): TextRunLayoutStyle {
  return {
    fontFamily: "Inter",
    fontStyleName: "Regular",
    fontSize: 10,
    fontWeight: 400,
    fontSlant: "normal",
    letterSpacing: 0,
    lineHeight: 10,
    textCase: "original",
    textDecoration: "none",
    textDecorationStyle: null,
    textDecorationOffset: null,
    textDecorationThickness: null,
    textDecorationColor: null,
    textDecorationSkipInk: null,
  };
}
