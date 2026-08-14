import type { DesignAsset, ImageNode } from "@opendesign/design-contracts";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import {
  DESIGN_ASSET_DRAG_MIME,
  assetPreviewDataUrl,
  filterDesignImageAssets,
  indexDesignImageAssets,
} from "./design-assets";

const photo: DesignAsset = {
  id: "asset_photo",
  kind: "image",
  name: "Campaign hero image with a deliberately long asset name",
  mimeType: "image/png",
  source: { type: "data", value: "aW1hZ2U=" },
  size: { width: 1600, height: 900 },
  extensions: {},
};

function imageNode(
  id: string,
  assetId: string,
  parentId: string | null,
): ImageNode {
  return {
    id,
    kind: "image",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 10, 10],
    size: { width: 200, height: 120 },
    exportSettings: [],
    opacity: 1,
    properties: {
      assetId,
      placement: { mode: "fit" },
      altText: "",
      cornerRadius: 0,
    },
    extensions: {},
  };
}

describe("design image asset index", () => {
  it("indexes distinct node uses across Pages and includes image paints", () => {
    const document = structuredClone(createWelcomeDocument());
    document.assetsById[photo.id] = photo;
    document.nodesById.hero_photo = imageNode(
      "hero_photo",
      photo.id,
      "frame_welcome",
    );
    const frame = document.nodesById.frame_welcome;
    if (!frame) throw new Error("Missing Frame fixture");
    frame.childIds.push("hero_photo");
    const painted = document.nodesById.feature_one;
    if (!painted || painted.kind !== "rectangle") {
      throw new Error("Missing rectangle fixture");
    }
    painted.properties.fills = [
      { type: "image", assetId: photo.id, fit: "cover", opacity: 1 },
    ];
    document.pageOrder.push("page_second");
    document.pagesById.page_second = {
      id: "page_second",
      name: "Campaign",
      rootNodeIds: ["second_photo"],
      extensions: {},
    };
    document.nodesById.second_photo = imageNode("second_photo", photo.id, null);

    const entry = indexDesignImageAssets(document).find(
      (candidate) => candidate.assetId === photo.id,
    );
    expect(entry).toMatchObject({
      status: "ready",
      previewDataUrl: "data:image/png;base64,aW1hZ2U=",
      referenceCount: 3,
    });
    expect(entry?.references).toEqual(
      expect.arrayContaining([
        {
          nodeId: "hero_photo",
          pageId: "page_welcome",
          kind: "image-node",
        },
        {
          nodeId: painted.id,
          pageId: "page_welcome",
          kind: "image-paint",
        },
        {
          nodeId: "second_photo",
          pageId: "page_second",
          kind: "image-node",
        },
      ]),
    );
  });

  it("surfaces missing and unsupported sources without rendering untrusted SVG", () => {
    const document = structuredClone(createWelcomeDocument());
    document.assetsById.external = {
      ...photo,
      id: "external",
      name: "Linked hero",
      source: { type: "external", value: "approved-handle" },
    };
    document.assetsById.svg = {
      ...photo,
      id: "svg",
      name: "Untrusted vector image",
      mimeType: "image/svg+xml",
      source: { type: "data", value: "PHN2Zz48L3N2Zz4=" },
    };
    document.nodesById.missing_image = imageNode(
      "missing_image",
      "asset_missing",
      "frame_welcome",
    );
    const frame = document.nodesById.frame_welcome;
    if (!frame) throw new Error("Missing Frame fixture");
    frame.childIds.push("missing_image");
    const entries = indexDesignImageAssets(document);
    expect(entries.find((entry) => entry.assetId === "external")).toMatchObject(
      { status: "unavailable", previewDataUrl: null },
    );
    expect(entries.find((entry) => entry.assetId === "svg")).toMatchObject({
      status: "unavailable",
      previewDataUrl: null,
    });
    expect(
      entries.find((entry) => entry.assetId === "asset_missing"),
    ).toMatchObject({ status: "missing", referenceCount: 1, asset: null });
    expect(assetPreviewDataUrl(document.assetsById.svg ?? null)).toBeNull();
  });

  it("searches names, MIME, and stable IDs without changing the source index", () => {
    const document = structuredClone(createWelcomeDocument());
    document.assetsById[photo.id] = photo;
    const entries = indexDesignImageAssets(document);
    expect(filterDesignImageAssets(entries, "campaign hero")).toHaveLength(1);
    expect(filterDesignImageAssets(entries, "image/png")).toHaveLength(1);
    expect(filterDesignImageAssets(entries, "asset_photo")).toHaveLength(1);
    expect(filterDesignImageAssets(entries, "missing")).toHaveLength(0);
    expect(entries).toHaveLength(1);
    expect(DESIGN_ASSET_DRAG_MIME).toBe(
      "application/x-opendesign-image-asset-id",
    );
  });
});
