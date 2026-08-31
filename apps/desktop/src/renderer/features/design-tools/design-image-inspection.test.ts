import type {
  DesignAsset,
  DesignNode,
  ImageAssetDerivation,
} from "@opendesign/design-contracts";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { createScopedImageInspection } from "./design-image-inspection";

describe("design image inspection", () => {
  it("projects a complete reusable image family without source payloads", () => {
    const document = structuredClone(createWelcomeDocument());
    const assets = [
      imageAsset("asset_source", "c2Vuc2l0aXZlLXNvdXJjZQ=="),
      imageAsset("asset_result", "c2Vuc2l0aXZlLXJlc3VsdA=="),
      imageAsset("asset_mask", "c2Vuc2l0aXZlLW1hc2s="),
      imageAsset("asset_reference", "c2Vuc2l0aXZlLXJlZmVyZW5jZQ=="),
      imageAsset("asset_staged", "c2Vuc2l0aXZlLXN0YWdlZA==", {
        generatedBy: "opendesign-agent",
        designRole: "hero",
        staged: true,
      }),
    ];
    assets.forEach((asset) => {
      document.assetsById[asset.id] = asset;
    });
    const derivation = imageDerivation("derivation_1", {
      sourceAssetId: "asset_source",
      resultAssetId: "asset_result",
      maskAssetId: "asset_mask",
      referenceAssetIds: ["asset_reference"],
    });
    document.imageAssetDerivationsById[derivation.id] = derivation;
    document.imageAssetDerivationOrder.push(derivation.id);

    const inspection = createScopedImageInspection(document, {
      hero_image: imageNode("asset_result"),
    });

    expect(Object.keys(inspection.assetsById).sort()).toEqual(
      assets.map((asset) => asset.id).sort(),
    );
    expect(inspection.assetsById.asset_staged).toMatchObject({
      availability: "design-file",
      generated: true,
      designRole: "hero",
    });
    expect(inspection.imageAssetDerivations).toEqual([
      expect.objectContaining({
        id: "derivation_1",
        sourceAssetId: "asset_source",
        resultAssetId: "asset_result",
        maskAssetId: "asset_mask",
        referenceAssetIds: ["asset_reference"],
      }),
    ]);
    for (const asset of assets) {
      expect(JSON.stringify(inspection)).not.toContain(asset.source.value);
    }
    expect(inspection.assetsById.asset_result).not.toHaveProperty("source");
  });

  it("bounds a long derivation family and reports truncation", () => {
    const document = structuredClone(createWelcomeDocument());
    for (let index = 0; index <= 65; index += 1) {
      const asset = imageAsset(`asset_${index}`, `payload_${index}`);
      document.assetsById[asset.id] = asset;
    }
    for (let index = 0; index < 65; index += 1) {
      const derivation = imageDerivation(`derivation_${index}`, {
        sourceAssetId: `asset_${index}`,
        resultAssetId: `asset_${index + 1}`,
      });
      document.imageAssetDerivationsById[derivation.id] = derivation;
      document.imageAssetDerivationOrder.push(derivation.id);
    }

    const inspection = createScopedImageInspection(document, {
      hero_image: imageNode("asset_0"),
    });

    expect(inspection.imageAssetDerivations).toHaveLength(64);
    expect(inspection.imageAssetDerivationsTruncated).toBe(true);
    expect(inspection.assetsById.asset_64).toBeDefined();
  });

  it("includes image assets used by editable vector regions", () => {
    const document = structuredClone(createWelcomeDocument());
    document.assetsById.asset_region = imageAsset(
      "asset_region",
      "cmVnaW9uLWltYWdl",
    );

    const inspection = createScopedImageInspection(document, {
      region_vector: vectorImagePaintNode("asset_region"),
    });

    expect(inspection.assetsById.asset_region).toMatchObject({
      id: "asset_region",
      kind: "image",
    });
  });
});

function imageAsset(
  id: string,
  value: string,
  extensions: DesignAsset["extensions"] = {},
): DesignAsset {
  return {
    id,
    kind: "image",
    name: `${id}.png`,
    mimeType: "image/png",
    source: { type: "data", value },
    size: { width: 256, height: 256 },
    extensions,
  };
}

function imageDerivation(
  id: string,
  input: Pick<ImageAssetDerivation, "sourceAssetId" | "resultAssetId"> &
    Partial<Pick<ImageAssetDerivation, "maskAssetId" | "referenceAssetIds">>,
): ImageAssetDerivation {
  return {
    id,
    sourceAssetId: input.sourceAssetId,
    resultAssetId: input.resultAssetId,
    operation: "prompt-edit",
    ...(input.maskAssetId ? { maskAssetId: input.maskAssetId } : {}),
    referenceAssetIds: input.referenceAssetIds ?? [],
    extensions: {},
  };
}

function imageNode(assetId: string): DesignNode {
  return {
    id: "hero_image",
    kind: "image",
    name: "Hero image",
    parentId: "frame_welcome",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 256, height: 256 },
    exportSettings: [],
    opacity: 1,
    properties: {
      assetId,
      placement: { mode: "fit" },
      altText: "Hero",
      cornerRadius: 0,
    },
    extensions: {},
  };
}

function vectorImagePaintNode(assetId: string): DesignNode {
  return {
    ...imageNode(assetId),
    id: "region_vector",
    kind: "vector",
    name: "Region vector",
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      network: {
        vertices: [
          { id: "a", x: 0, y: 0 },
          { id: "b", x: 256, y: 0 },
          { id: "c", x: 128, y: 256 },
        ],
        segments: [
          { id: "ab", startVertexId: "a", endVertexId: "b" },
          { id: "bc", startVertexId: "b", endVertexId: "c" },
          { id: "ca", startVertexId: "c", endVertexId: "a" },
        ],
        paths: [
          {
            id: "outline",
            closed: true,
            segments: [
              { segmentId: "ab", reversed: false },
              { segmentId: "bc", reversed: false },
              { segmentId: "ca", reversed: false },
            ],
          },
        ],
        regions: [
          {
            id: "face",
            windingRule: "nonzero",
            loops: [{ pathId: "outline", reversed: false }],
            fills: [{ type: "image", assetId, fit: "cover", opacity: 1 }],
          },
        ],
      },
    },
  };
}
