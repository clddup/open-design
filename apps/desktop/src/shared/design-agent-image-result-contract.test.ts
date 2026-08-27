import { describe, expect, it } from "vitest";
import {
  BoundedEmbeddedImageAssetContract,
  PreparedImageEditSourceContract,
} from "./design-agent-image-result-contract";

const assetId = `asset_${"a".repeat(64)}`;
const asset = {
  id: assetId,
  kind: "image" as const,
  name: "Hero.png",
  mimeType: "image/png",
  source: { type: "data" as const, value: "aGVybw==" },
  size: { width: 1600, height: 900 },
  extensions: {},
};
const prepared = {
  kind: "prepared-image-edit-source" as const,
  pageId: "page_1",
  nodeId: "hero_image",
  expectedAssetId: assetId,
  asset,
  placement: { mode: "fit" as const },
  targetSize: { width: 800, height: 450 },
};

describe("prepared image edit source contract", () => {
  it("accepts one bounded embedded image and canonical placement", () => {
    expect(BoundedEmbeddedImageAssetContract.parse(asset).ok).toBe(true);
    expect(PreparedImageEditSourceContract.parse(prepared)).toEqual({
      ok: true,
      value: prepared,
    });
  });

  it("reports the exact embedded source and target-size fields", () => {
    expect(
      PreparedImageEditSourceContract.issues({
        ...prepared,
        asset: {
          ...asset,
          source: { type: "external", value: "/tmp/hero.png" },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/asset/source/type" }),
      ]),
    );
    expect(
      PreparedImageEditSourceContract.issues({
        ...prepared,
        targetSize: { width: 0, height: 450 },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/targetSize/width" }),
      ]),
    );
  });

  it("keeps the stale-write asset identity as one domain refinement", () => {
    expect(
      PreparedImageEditSourceContract.issues({
        ...prepared,
        expectedAssetId: `asset_${"b".repeat(64)}`,
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "prepared_image_edit_source.asset_identity_mismatch",
        path: "/asset/id",
      }),
    );
  });
});
