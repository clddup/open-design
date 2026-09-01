import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  HARFBUZZ_BIDI_UNICODE_VERSION,
  createHarfBuzzTextRunLayoutRuntime,
} from "./harfbuzz-text-run-layout.js";
import type {
  TextRunLayoutRequest,
  TextRunLayoutStyle,
} from "./text-run-layout.js";

const fontUrls = {
  latin: new URL(
    "../node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf",
    import.meta.url,
  ),
  arabic: new URL(
    "../node_modules/@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf",
    import.meta.url,
  ),
  devanagari: new URL(
    "../node_modules/@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf",
    import.meta.url,
  ),
  hebrew: new URL(
    "../node_modules/@expo-google-fonts/noto-sans-hebrew/400Regular/NotoSansHebrew_400Regular.ttf",
    import.meta.url,
  ),
} as const;

async function register(
  runtime: Awaited<ReturnType<typeof createHarfBuzzTextRunLayoutRuntime>>,
  url: URL,
) {
  const bytes = await readFile(url);
  const fontId = `font_${createHash("sha256").update(bytes).digest("hex")}`;
  return runtime.registerFont(fontId, bytes)[0]!;
}

function style(face: Awaited<ReturnType<typeof register>>): TextRunLayoutStyle {
  return {
    fontFamily: face.family,
    fontSize: 32,
    fontSlant: face.slant,
    fontStyleName: face.styleName,
    fontWeight: face.weight,
    letterSpacing: 0,
    lineHeight: 44,
    textCase: "original",
    textDecoration: "none",
  };
}

function request<Style extends TextRunLayoutStyle>(
  content: string,
  baseStyle: Style,
  overrides: Partial<TextRunLayoutRequest<Style>> = {},
): TextRunLayoutRequest<Style> {
  return {
    baseStyle,
    content,
    mode: "auto-width",
    hangingList: false,
    listSpacing: 0,
    maxLines: null,
    paragraphIndent: 0,
    paragraphSpacing: 0,
    runs: [],
    textAlignHorizontal: "left",
    textAlignVertical: "top",
    textTruncation: "disabled",
    textWrap: "none",
    ...overrides,
  };
}

describe("HarfBuzz text run layout", () => {
  it("loads only explicitly registered SFNT faces and reports the bidi baseline", async () => {
    const runtime = await createHarfBuzzTextRunLayoutRuntime();
    const face = await register(runtime, fontUrls.arabic);
    expect(face).toMatchObject({
      family: "Noto Sans Arabic",
      slant: "normal",
      weight: 400,
    });
    expect(face.unitsPerEm).toBeGreaterThan(0);
    expect(runtime.listFonts()).toHaveLength(1);
    expect(HARFBUZZ_BIDI_UNICODE_VERSION).toBe("13.0.0");

    const missing = runtime.provider.layout(
      request("سلام", { ...style(face), fontFamily: "Missing" }),
    );
    expect(missing).toMatchObject({
      code: "provider-unavailable",
      ok: false,
      retryable: true,
    });
    const underlined = runtime.provider.layout(
      request("سلام", { ...style(face), textDecoration: "underline" }),
    );
    expect(underlined.ok).toBe(true);
    if (!underlined.ok) return;
    expect(underlined.fragments).not.toHaveLength(0);
    expect(
      underlined.fragments.every(
        (fragment) => fragment.decorations?.[0]?.kind === "underline",
      ),
    ).toBe(true);
    expect(
      underlined.fragments.every(
        (fragment) => (fragment.decorations?.[0]?.path.length ?? 0) > 0,
      ),
    ).toBe(true);
    const struck = runtime.provider.layout(
      request("سلام", {
        ...style(face),
        textDecoration: "strikethrough",
      }),
    );
    expect(struck.ok && struck.fragments[0]?.decorations?.[0]?.kind).toBe(
      "strikethrough",
    );
  });

  it("shapes Arabic context without breaking at a fill-only range", async () => {
    type Style = TextRunLayoutStyle & { fill: string };
    const runtime = await createHarfBuzzTextRunLayoutRuntime<Style>();
    const face = await register(runtime, fontUrls.arabic);
    const base = { ...style(face), fill: "#111111" };
    const content = "سلام";
    const result = runtime.provider.layout(
      request(content, base, {
        runs: [
          { end: 2, start: 0, style: base },
          { end: 4, start: 2, style: { ...base, fill: "#7c3aed" } },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragments.map((fragment) => fragment.text)).toEqual([
      "سل",
      "ام",
    ]);
    expect(
      result.fragments.flatMap((fragment) => fragment.glyphs ?? []),
    ).not.toHaveLength(0);
    expect(
      result.fragments
        .flatMap((fragment) => fragment.glyphs ?? [])
        .every((glyph) => glyph.path.length > 0),
    ).toBe(true);
  });

  it("reshapes an exact ending-truncation display string without mutating source content", async () => {
    const runtime = await createHarfBuzzTextRunLayoutRuntime();
    const face = await register(runtime, fontUrls.latin);
    const content = "OpenDesign creates editable professional interfaces";
    const result = runtime.provider.layout(
      request(content, style(face), {
        maxLines: 1,
        mode: "auto-height",
        textTruncation: "ending",
        textWrap: "character",
        width: 180,
      }),
    );
    expect(result).toMatchObject({ ok: true, truncated: true });
    if (!result.ok) return;
    expect(result.displayContent).toBe(
      `${content.slice(0, result.sourceContentEnd)}...`,
    );
    expect(result.sourceContentEnd).toBeLessThan(content.length);
    expect(result.lines).toHaveLength(1);
    expect(result.fragments.map((fragment) => fragment.text).join("")).toBe(
      result.displayContent,
    );
    expect(result.fullContentBounds.height).toBeGreaterThan(
      result.contentBounds.height,
    );
  });

  it("keeps default Latin ligatures as one UTF-16 cluster", async () => {
    const runtime = await createHarfBuzzTextRunLayoutRuntime();
    const face = await register(runtime, fontUrls.latin);
    const result = runtime.provider.layout(request("office", style(face)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const clusters = result.fragments
      .flatMap((fragment) => fragment.glyphs ?? [])
      .map((glyph) => [glyph.clusterStart, glyph.clusterEnd] as const);
    expect(clusters.some(([start, end]) => end - start > 1)).toBe(true);

    type FilledStyle = TextRunLayoutStyle & { fill: string };
    const filledRuntime =
      await createHarfBuzzTextRunLayoutRuntime<FilledStyle>();
    const filledFace = await register(filledRuntime, fontUrls.latin);
    const filled = { ...style(filledFace), fill: "#111111" };
    expect(
      filledRuntime.provider.layout(
        request("office", filled, {
          runs: [
            { end: 2, start: 0, style: filled },
            { end: 6, start: 2, style: { ...filled, fill: "#7c3aed" } },
          ],
        }),
      ),
    ).toMatchObject({ code: "unsupported", ok: false, retryable: false });
  });

  it("keeps Devanagari conjunct clusters indivisible while wrapping", async () => {
    const runtime = await createHarfBuzzTextRunLayoutRuntime();
    const face = await register(runtime, fontUrls.devanagari);
    const content = "क्षत्र क्षत्र";
    const result = runtime.provider.layout(
      request(content, style(face), {
        mode: "auto-height",
        textWrap: "character",
        width: 72,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.length).toBeGreaterThan(1);
    const clusters = result.fragments
      .flatMap((fragment) => fragment.glyphs ?? [])
      .map((glyph) => [glyph.clusterStart, glyph.clusterEnd] as const);
    expect(clusters.some(([start, end]) => end - start > 1)).toBe(true);
    expect(result.lines.every((line) => line.end >= line.start)).toBe(true);
  });

  it("applies paragraph-local indent and spacing without changing authored content", async () => {
    const runtime = await createHarfBuzzTextRunLayoutRuntime();
    const face = await register(runtime, fontUrls.latin);
    const content = "Alpha\nBeta";
    const result = runtime.provider.layout(
      request(content, style(face), {
        paragraphRuns: [
          {
            start: 0,
            end: 6,
            style: {
              listOptions: { type: "none" },
              indentation: 0,
              listSpacing: 0,
              paragraphIndent: 12,
              paragraphSpacing: 18,
            },
          },
          {
            start: 6,
            end: 10,
            style: {
              listOptions: { type: "none" },
              indentation: 0,
              listSpacing: 0,
              paragraphIndent: 28,
              paragraphSpacing: 0,
            },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragments.map((fragment) => fragment.text).join("")).toBe(
      content,
    );
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]?.x).toBe(12);
    expect(result.lines[1]?.x).toBe(28);
    expect(result.lines[1]!.y - result.lines[0]!.y).toBeGreaterThan(44);
  });

  it("produces visual bidi positions for mixed Latin and Hebrew", async () => {
    const runtime = await createHarfBuzzTextRunLayoutRuntime();
    const hebrew = await register(runtime, fontUrls.hebrew);
    const content = "אבג 123";
    const result = runtime.provider.layout(request(content, style(hebrew)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const glyphs = result.fragments.flatMap(
      (fragment) => fragment.glyphs ?? [],
    );
    expect(glyphs).not.toHaveLength(0);
    expect(new Set(glyphs.map((glyph) => glyph.x)).size).toBeGreaterThan(1);
    expect(result.fragments.map((fragment) => fragment.text).join("")).toBe(
      content,
    );
  });

  it("shapes RTL ordered markers on the logical start edge with hanging geometry", async () => {
    const runtime = await createHarfBuzzTextRunLayoutRuntime();
    const face = await register(runtime, fontUrls.hebrew);
    const content = "אבג\nדהו";
    const paragraphRuns = [
      {
        start: 0,
        end: content.length,
        style: {
          listOptions: { type: "ordered" as const },
          indentation: 1,
          listSpacing: 10,
          paragraphIndent: 0,
          paragraphSpacing: 0,
        },
      },
    ];
    const result = runtime.provider.layout(
      request(content, style(face), {
        hangingList: true,
        mode: "auto-height",
        paragraphRuns,
        textAlignHorizontal: "right",
        textWrap: "word",
        width: 180,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markers).toHaveLength(2);
    expect(result.markers.map((marker) => marker.direction)).toEqual([
      "rtl",
      "rtl",
    ]);
    expect(result.markers.every((marker) => marker.x > 180)).toBe(true);
    expect(
      result.markers.flatMap((marker) => marker.glyphs ?? []),
    ).not.toHaveLength(0);
    expect(result.fragments.map((fragment) => fragment.text).join("")).toBe(
      content,
    );
  });
});
