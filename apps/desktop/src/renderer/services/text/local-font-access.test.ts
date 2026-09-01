import type { DesignNode } from "@opendesign/design-contracts";
import { createEmptyDesignDocument } from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  collectDocumentFontFamilies,
  createLocalFontAccessRuntime,
  localFontQueryFromWindow,
  type LocalFontData,
} from "./local-font-access";

describe("local font access", () => {
  it("collects base and rich-run families without duplicates", () => {
    const document = structuredClone(
      createEmptyDesignDocument("document_1", "page_1"),
    );
    document.nodesById.text_1 = textNode();

    expect(collectDocumentFontFamilies(document)).toEqual([
      "IBM Plex Sans",
      "Inter",
    ]);
  });

  it("collects materialized text styles without reading unused style families", () => {
    const document = structuredClone(
      createEmptyDesignDocument("document_1", "page_1"),
    );
    const text = textNode();
    text.textStyleId = "style_used";
    document.nodesById.text_1 = text;
    document.stylesById.style_used = textStyle("style_used", "Source Serif 4");
    document.stylesById.style_unused = textStyle(
      "style_unused",
      "Unused Display",
    );

    expect(collectDocumentFontFamilies(document)).toEqual([
      "IBM Plex Sans",
      "Source Serif 4",
    ]);
  });

  it("loads only requested families and registers content-addressed bytes once", async () => {
    const registerFont = vi.fn(
      (fontId: `font_${string}`, bytes: Uint8Array) => {
        void fontId;
        void bytes;
        return [face("Inter")];
      },
    );
    const runtime = createLocalFontAccessRuntime({
      query: vi.fn(() =>
        Promise.resolve([
          localFont("Inter", "Inter-Regular", 1),
          localFont("Arial", "ArialMT", 2),
        ]),
      ),
      registerFont,
    });

    await expect(runtime.hydrateFamilies([" inter "])).resolves.toMatchObject({
      failures: [],
      loadedFaceCount: 1,
    });
    expect(registerFont).toHaveBeenCalledOnce();
    expect(registerFont.mock.calls[0]?.[0]).toMatch(/^font_[a-f0-9]{64}$/);
    await expect(runtime.hydrateFamilies(["Inter"])).resolves.toMatchObject({
      failures: [],
      loadedFaceCount: 0,
    });
    expect(registerFont).toHaveBeenCalledOnce();
  });

  it("isolates one malformed local face and retries a failed catalog query", async () => {
    const query = vi
      .fn<() => Promise<readonly LocalFontData[]>>()
      .mockRejectedValueOnce(new Error("permission unavailable"))
      .mockResolvedValueOnce([localFont("Inter", "Inter-Regular", 1, 4)]);
    const runtime = createLocalFontAccessRuntime({
      query,
      registerFont: vi.fn(() => [face("Inter")]),
    });

    await expect(runtime.hydrateFamilies(["Inter"])).rejects.toThrow(
      "permission unavailable",
    );
    await expect(runtime.hydrateFamilies(["Inter"])).resolves.toEqual({
      failures: [
        {
          font: "Inter-Regular",
          message: "Local font must be between 12 bytes and 32 MB",
        },
      ],
      loadedFaceCount: 0,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("stops queued font work when the caller cancels", async () => {
    const controller = new AbortController();
    const registerFont = vi.fn(() => [face("Inter")]);
    const runtime = createLocalFontAccessRuntime({
      query: vi.fn(() =>
        Promise.resolve([localFont("Inter", "Inter-Regular", 1)]),
      ),
      registerFont,
    });
    controller.abort();

    await expect(
      runtime.hydrateFamilies(["Inter"], controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(registerFont).not.toHaveBeenCalled();
  });

  it("rejects an invalid browser font catalog instead of silently dropping entries", async () => {
    const runtime = createLocalFontAccessRuntime({
      query: () => Promise.resolve([{}] as unknown as readonly LocalFontData[]),
      registerFont: vi.fn(() => [face("Inter")]),
    });

    await expect(runtime.hydrateFamilies(["Inter"])).rejects.toThrow(
      "Local font catalog contains an invalid entry",
    );
  });

  it("detects the browser API without creating a second font bridge", () => {
    const query = vi.fn(() => Promise.resolve([]));
    const target = { queryLocalFonts: query } as unknown as Window;
    const resolved = localFontQueryFromWindow(target);

    expect(resolved).not.toBeNull();
    void resolved?.();
    expect(query).toHaveBeenCalledOnce();
    expect(localFontQueryFromWindow({} as Window)).toBeNull();
  });
});

function localFont(
  family: string,
  postscriptName: string,
  fill: number,
  byteSize = 12,
): LocalFontData {
  return {
    family,
    fullName: `${family} Regular`,
    postscriptName,
    style: "Regular",
    blob: () =>
      Promise.resolve(new Blob([new Uint8Array(byteSize).fill(fill)])),
  };
}

function face(family: string) {
  return {
    family,
    faceIndex: 0,
    fontId: `font_${"a".repeat(64)}`,
    postScriptName: `${family}-Regular`,
    slant: "normal" as const,
    styleName: "Regular",
    unitsPerEm: 1_000,
    weight: 400,
  };
}

function textStyle(id: string, fontFamily: string) {
  return {
    id,
    key: `${id}_key`,
    name: id,
    description: "",
    hiddenFromPublishing: false,
    styleType: "TEXT" as const,
    textStyle: {
      fontFamily,
      fontStyleName: "Regular",
      fontSize: 20,
      fontWeight: 400,
      fontSlant: "normal" as const,
      lineHeight: 28,
      letterSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      textCase: "original" as const,
      textDecoration: "none" as const,
      textDecorationStyle: null,
      textDecorationOffset: null,
      textDecorationThickness: null,
      textDecorationColor: null,
      textDecorationSkipInk: null,
    },
    extensions: {},
  };
}

function textNode(): Extract<DesignNode, { kind: "text" }> {
  return {
    id: "text_1",
    name: "Text",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 240, height: 64 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "text",
    properties: {
      content: "AB",
      runs: [
        {
          start: 1,
          end: 2,
          style: {
            fontFamily: "IBM Plex Sans",
            fontStyleName: "Regular",
            fontSize: 20,
            fontWeight: 400,
            fontSlant: "normal",
            lineHeight: 28,
            letterSpacing: 0,
            textCase: "original",
            textDecoration: "none",
            textDecorationStyle: null,
            textDecorationOffset: null,
            textDecorationThickness: null,
            textDecorationColor: null,
            textDecorationSkipInk: null,
            fills: [{ type: "solid", color: "#111827", opacity: 1 }],
          },
        },
      ],
      fontFamily: "Inter",
      fontStyleName: "Regular",
      fontSize: 20,
      fontWeight: 400,
      fontSlant: "normal",
      lineHeight: 28,
      letterSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      paragraphRuns: [],
      textCase: "original",
      textDecoration: "none",
      textDecorationStyle: null,
      textDecorationOffset: null,
      textDecorationThickness: null,
      textDecorationColor: null,
      textDecorationSkipInk: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textResize: "fixed",
      textWrap: "word",
      textOverflow: "clip",
      textTruncation: "disabled",
      maxLines: null,
      fills: [{ type: "solid", color: "#111827", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
  };
}
