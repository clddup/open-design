import type { ImageNode } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { flattenImageNode } from "./vector-flatten-image.js";

function fixture(placement: ImageNode["properties"]["placement"]) {
  const document = structuredClone(createWelcomeDocument());
  document.assetsById.photo = {
    id: "photo",
    kind: "image",
    name: "Photo",
    mimeType: "image/png",
    source: { type: "data", value: "aW1hZ2U=" },
    size: { width: 400, height: 200 },
    extensions: {},
  };
  const node: ImageNode = {
    id: "photo_node",
    kind: "image",
    name: "Photo",
    parentId: "frame_welcome",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 20, 30],
    size: { width: 100, height: 100 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    properties: {
      assetId: "photo",
      placement,
      filters: { exposure: 0.2, shadows: -0.4 },
      altText: "Photo",
      cornerRadius: 12,
    },
  };
  return { document, node };
}

describe("Image Flatten materialization", () => {
  it.each([
    [{ mode: "stretch" } as const, "fill"],
    [{ mode: "fit" } as const, "contain"],
  ])("maps %s placement to a region image paint", (placement, fit) => {
    const { document, node } = fixture(placement);
    const result = flattenImageNode(document, node, [1, 0, 0, 1, 80, 90]);
    expect(result).toMatchObject({
      ok: true,
      node: {
        kind: "rectangle",
        transform: [1, 0, 0, 1, 80, 90],
        properties: {
          cornerRadius: 12,
          fills: [
            {
              type: "image",
              assetId: "photo",
              fit,
              opacity: 1,
              filters: { exposure: 0.2, shadows: -0.4 },
            },
          ],
          strokes: [],
          strokeWidth: 0,
        },
      },
    });
  });

  it("maps Fill focal placement to an explicit crop transform", () => {
    const { document, node } = fixture({
      mode: "fill",
      focalPoint: { x: 0.5, y: 0.5 },
    });
    const result = flattenImageNode(document, node, node.transform);
    expect(result).toMatchObject({
      ok: true,
      node: {
        properties: {
          fills: [
            {
              fit: "crop",
              scale: { x: 0.5, y: 0.5 },
              offset: { x: -50, y: 0 },
              rotation: 0,
            },
          ],
        },
      },
    });
  });

  it("preserves crop rotation, flips, zoom, focal point, and filters", () => {
    const { document, node } = fixture({
      mode: "crop",
      focalPoint: { x: 0.5, y: 0.5 },
      zoom: 2,
      rotation: 90,
      flipHorizontal: true,
      flipVertical: false,
    });
    const result = flattenImageNode(document, node, node.transform);
    expect(result).toMatchObject({
      ok: true,
      node: {
        properties: {
          fills: [
            {
              fit: "crop",
              scale: { x: -1, y: 1 },
              offset: { x: 150, y: 250 },
              rotation: 90,
              filters: { exposure: 0.2, shadows: -0.4 },
            },
          ],
        },
      },
    });
  });

  it("fails closed when crop placement has no trustworthy source dimensions", () => {
    const { document, node } = fixture({
      mode: "fill",
      focalPoint: { x: 0.5, y: 0.5 },
    });
    const asset = document.assetsById.photo;
    if (!asset || asset.kind !== "image") throw new Error("Missing asset");
    delete asset.size;
    const result = flattenImageNode(document, node, node.transform);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected Image Flatten to fail");
    expect(result.message).toContain("positive source dimensions");
  });
});
