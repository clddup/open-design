import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  createEmptyDesignDocument,
  createWelcomeDocument,
} from "./document.js";
import { diagnoseDesignPages } from "./diagnostics.js";

describe("design render diagnostics", () => {
  it("reports a clean bounded summary for the welcome fixture", () => {
    const report = diagnoseDesignPages(createWelcomeDocument(), [
      "page_welcome",
    ]);

    expect(report).toMatchObject({
      version: 1,
      documentId: "document_welcome",
      pageIds: ["page_welcome"],
      checkedNodeCount: 8,
      errorCount: 0,
      warningCount: 0,
      features: {
        blends: 0,
        blurs: 0,
        glows: 0,
        gradients: 0,
        images: 0,
        masks: 0,
        paths: 0,
        text: 2,
      },
      items: [],
    });
  });

  it("finds broken render inputs and records professional feature usage", () => {
    const document = brokenDocument();
    const report = diagnoseDesignPages(document, ["page_diagnostics"]);
    const codes = new Set(report.items.map((item) => item.code));

    expect(codes).toEqual(
      new Set([
        "empty-path",
        "empty-text",
        "fragmented-root",
        "invisible-node",
        "missing-asset",
        "no-visible-paint",
        "non-finite-bounds",
        "outside-clipping-bounds",
        "unsupported-image-source",
      ]),
    );
    expect(report.features).toEqual({
      blends: 1,
      blurs: 1,
      glows: 1,
      gradients: 1,
      images: 2,
      masks: 1,
      paths: 1,
      text: 1,
    });
    expect(report.items).toContainEqual(
      expect.objectContaining({
        code: "fragmented-root",
        pageId: "page_diagnostics",
        severity: "warning",
      }),
    );
    expect(report.items).toContainEqual(
      expect.objectContaining({
        code: "outside-clipping-bounds",
        nodeId: "outside_frame",
        relatedNodeIds: ["frame_clipping"],
      }),
    );
  });
});

function brokenDocument(): DesignDocument {
  const document = structuredClone(
    createEmptyDesignDocument("document_diagnostics", "page_diagnostics"),
  );
  const nodes: DesignNode[] = [
    {
      ...baseNode("frame_clipping", "frame", null),
      childIds: ["outside_frame"],
      size: { width: 100, height: 100 },
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
        clipsContent: true,
      },
    },
    {
      ...baseNode("outside_frame", "rectangle", "frame_clipping"),
      transform: [1, 0, 0, 1, 240, 240],
      size: { width: 20, height: 20 },
      blendMode: "screen",
      maskMode: "alpha",
      effects: [
        {
          type: "outer-glow",
          color: "#00ffff",
          opacity: 1,
          radius: 8,
          spread: 2,
        },
        { type: "layer-blur", radius: 2 },
      ],
      properties: {
        fills: [
          {
            type: "linear-gradient",
            opacity: 1,
            stops: [
              { offset: 0, color: "#000000", opacity: 1 },
              { offset: 1, color: "#ffffff", opacity: 1 },
            ],
          },
        ],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
      },
    },
    {
      ...baseNode("path_empty", "path", null),
      properties: {
        fills: [],
        strokes: [],
        strokeWidth: 0,
        path: "   ",
        fillRule: "nonzero",
      },
    },
    {
      ...baseNode("image_missing", "image", null),
      properties: {
        assetId: "asset_missing",
        fit: "cover",
        altText: "Missing",
        cornerRadius: 0,
      },
    },
    {
      ...baseNode("image_external", "image", null),
      properties: {
        assetId: "asset_external",
        fit: "contain",
        altText: "External",
        cornerRadius: 0,
      },
    },
    {
      ...baseNode("text_empty", "text", null),
      properties: {
        content: "  ",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 20,
        letterSpacing: 0,
        textAlignHorizontal: "left",
        textAlignVertical: "top",
        fills: [{ type: "solid", color: "#000000", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
    },
    {
      ...baseNode("ellipse_hidden", "ellipse", null),
      opacity: 0,
      properties: {
        fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
    },
    {
      ...baseNode("rectangle_nonfinite", "rectangle", null),
      transform: [Number.NaN, 0, 0, 1, 0, 0],
      properties: {
        fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 0,
      },
    },
  ];
  for (const node of nodes) document.nodesById[node.id] = node;
  document.pagesById.page_diagnostics!.rootNodeIds = [
    "frame_clipping",
    "path_empty",
    "image_missing",
    "image_external",
    "text_empty",
    "ellipse_hidden",
    "rectangle_nonfinite",
  ];
  document.assetsById.asset_external = {
    id: "asset_external",
    kind: "image",
    name: "External image",
    mimeType: "image/png",
    source: { type: "external", value: "approved-handle" },
    size: { width: 100, height: 100 },
    extensions: {},
  };
  return document;
}

function baseNode<Kind extends DesignNode["kind"]>(
  id: string,
  kind: Kind,
  parentId: string | null,
) {
  return {
    id,
    kind,
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    size: { width: 40, height: 40 },
    opacity: 1,
    extensions: {},
  };
}
