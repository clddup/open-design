import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { componentProjectionId } from "@opendesign/component-service";
import type {
  TextLayoutProvider,
  TextRunLayoutProvider,
} from "@opendesign/text-service";
import { describe, expect, it, vi } from "vitest";
import type { LeaferTextRunStyle } from "./text-run-layout.js";
import { inspectDesignTextLayoutQuality } from "./text-quality-inspection.js";

describe("design text layout quality inspection", () => {
  it("measures visible Text inside the exact Component Instance projection", () => {
    const document = structuredClone(createWelcomeDocument());
    const sourceText = structuredClone(document.nodesById.title_welcome);
    const artboard = document.nodesById.frame_welcome;
    if (sourceText?.kind !== "text" || artboard?.kind !== "frame") {
      throw new Error("Missing component text fixture");
    }
    sourceText.id = "component_text";
    sourceText.parentId = "component_text_main";
    sourceText.transform = [1, 0, 0, 1, 0, 0];
    sourceText.size = { width: 180, height: 36 };
    document.nodesById.component_text = sourceText;
    document.nodesById.component_text_main = {
      ...structuredClone(artboard),
      id: "component_text_main",
      name: "Text Component Main",
      parentId: null,
      childIds: [sourceText.id],
      transform: [1, 0, 0, 1, 1_300, 64],
      size: { width: 180, height: 36 },
      properties: { ...artboard.properties, clipsContent: false },
    };
    document.nodesById.component_text_instance = {
      id: "component_text_instance",
      kind: "instance",
      name: "Text component instance",
      parentId: artboard.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 820, 100],
      size: { width: 180, height: 36 },
      exportSettings: [],
      opacity: 1,
      properties: {
        componentId: "component_text_definition",
        componentProperties: {},
        overrides: [],
      },
      extensions: {},
    };
    document.componentsById.component_text_definition = {
      id: "component_text_definition",
      name: "Text Component",
      rootNodeId: "component_text_main",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    artboard.childIds.push("component_text_instance");
    document.pagesById.page_welcome!.rootNodeIds.push("component_text_main");
    const projectedTextId = componentProjectionId("component_text_instance", [
      "component_text",
    ]);

    const evidence = inspectDesignTextLayoutQuality(
      document,
      "page_welcome",
      artboard.id,
      {
        id: "test-plain",
        version: "1",
        measure: (request) => ({
          ok: true,
          provider: "test-plain",
          providerVersion: "1",
          size: { width: request.width ?? 180, height: 36 },
          warnings: [],
        }),
      },
      unusedRunProvider(),
    );

    expect(evidence.measurements).toContainEqual(
      expect.objectContaining({
        status: "measured",
        nodeId: projectedTextId,
        boxSize: { width: 180, height: 36 },
      }),
    );
  });

  it("proves silent fixed-box clipping from full provider measurement", () => {
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.size = { width: 180, height: 36 };
    title.properties.textWrap = "word";
    title.properties.textOverflow = "clip";
    title.properties.textTruncation = "disabled";
    title.properties.maxLines = null;
    const measure = vi.fn<TextLayoutProvider["measure"]>((request) => ({
      ok: true,
      provider: "test-plain",
      providerVersion: "1",
      size: { width: request.width ?? 420, height: 96 },
      warnings: [],
    }));
    const evidence = inspectDesignTextLayoutQuality(
      document,
      "page_welcome",
      "frame_welcome",
      { id: "test-plain", version: "1", measure },
      unusedRunProvider(),
    );
    expect(evidence.measurements).toContainEqual(
      expect.objectContaining({
        status: "measured",
        nodeId: "title_welcome",
        overflow: { horizontal: false, vertical: true },
        truncated: false,
      }),
    );
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "auto-height",
        textTruncation: "disabled",
        width: 180,
      }),
    );
  });

  it("distinguishes explicit ending truncation from silent clipping", () => {
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.size = { width: 180, height: 48 };
    title.properties.textWrap = "word";
    title.properties.textOverflow = "clip";
    title.properties.textTruncation = "ending";
    title.properties.maxLines = 2;
    const measure = vi.fn<TextLayoutProvider["measure"]>((request) => ({
      ok: true,
      provider: "test-plain",
      providerVersion: "1",
      size: {
        width: request.width ?? 420,
        height: request.textTruncation === "ending" ? 48 : 120,
      },
      warnings: [],
    }));
    const evidence = inspectDesignTextLayoutQuality(
      document,
      "page_welcome",
      "frame_welcome",
      { id: "test-plain", version: "1", measure },
      unusedRunProvider(),
    );
    expect(evidence.measurements).toContainEqual(
      expect.objectContaining({
        status: "measured",
        nodeId: "title_welcome",
        truncated: true,
        displayedContentSize: { width: 180, height: 48 },
        fullContentSize: { width: 180, height: 120 },
      }),
    );
    expect(measure).toHaveBeenCalledTimes(3);
  });

  it("uses rich-text full/display bounds and reports ending truncation", () => {
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.size = { width: 320, height: 40 };
    title.properties.runs = [
      {
        start: 0,
        end: title.properties.content.length,
        style: {
          fontFamily: title.properties.fontFamily,
          fontStyleName: title.properties.fontStyleName,
          fontSize: title.properties.fontSize,
          fontWeight: title.properties.fontWeight,
          fontSlant: title.properties.fontSlant,
          letterSpacing: title.properties.letterSpacing,
          lineHeight: title.properties.lineHeight,
          textCase: title.properties.textCase,
          textDecoration: title.properties.textDecoration,
          textDecorationStyle: title.properties.textDecorationStyle,
          textDecorationOffset: structuredClone(
            title.properties.textDecorationOffset,
          ),
          textDecorationThickness: structuredClone(
            title.properties.textDecorationThickness,
          ),
          textDecorationColor: structuredClone(
            title.properties.textDecorationColor,
          ),
          textDecorationSkipInk: title.properties.textDecorationSkipInk,
          fills: title.properties.fills,
        },
      },
    ];
    const layout = vi.fn<TextRunLayoutProvider<LeaferTextRunStyle>["layout"]>(
      (request) => {
        const truncated = request.textTruncation === "ending";
        const sourceContentEnd = truncated
          ? Math.max(0, request.content.length - 1)
          : request.content.length;
        const displayContent = truncated
          ? `${request.content.slice(0, sourceContentEnd)}...`
          : request.content;
        return {
          ok: true,
          provider: "test-runs",
          providerVersion: "1",
          size: { width: request.width ?? 320, height: request.height ?? 96 },
          contentBounds: {
            x: 0,
            y: 0,
            width: 300,
            height: truncated ? 40 : 96,
          },
          displayContent,
          fullContentBounds: { x: 0, y: 0, width: 300, height: 96 },
          lines: [
            {
              start: 0,
              end: displayContent.length,
              x: 0,
              y: 0,
              width: 300,
              height: truncated ? 40 : 96,
              baseline: truncated ? 30 : 72,
            },
          ],
          fragments: [
            {
              start: 0,
              end: displayContent.length,
              text: displayContent,
              style: request.baseStyle,
              x: 0,
              y: 0,
              width: 300,
              height: truncated ? 40 : 96,
              baseline: truncated ? 30 : 72,
              lineIndex: 0,
            },
          ],
          markers: [],
          sourceContentEnd,
          truncated,
          warnings: [],
        };
      },
    );
    const providers = {
      plain: unusedPlainProvider(),
      rich: { id: "test-runs", version: "1", layout },
    };
    let evidence = inspectDesignTextLayoutQuality(
      document,
      "page_welcome",
      "frame_welcome",
      providers.plain,
      providers.rich,
    );
    expect(evidence.measurements).toContainEqual(
      expect.objectContaining({
        status: "measured",
        nodeId: "title_welcome",
        overflow: { horizontal: false, vertical: true },
      }),
    );
    title.properties.textTruncation = "ending";
    title.properties.maxLines = 1;
    evidence = inspectDesignTextLayoutQuality(
      document,
      "page_welcome",
      "frame_welcome",
      providers.plain,
      providers.rich,
    );
    expect(evidence.measurements).toContainEqual(
      expect.objectContaining({
        status: "measured",
        nodeId: "title_welcome",
        truncated: true,
        fullContentSize: { width: 300, height: 96 },
        displayedContentSize: { width: 300, height: 40 },
      }),
    );
  });
});

function unusedPlainProvider(): TextLayoutProvider {
  return {
    id: "unused-plain",
    version: "1",
    measure: () => ({
      ok: false,
      code: "provider-unavailable",
      message: "unused",
      retryable: false,
    }),
  };
}

function unusedRunProvider(): TextRunLayoutProvider<LeaferTextRunStyle> {
  return {
    id: "unused-runs",
    version: "1",
    layout: () => ({
      ok: false,
      code: "provider-unavailable",
      message: "unused",
      retryable: false,
    }),
  };
}
