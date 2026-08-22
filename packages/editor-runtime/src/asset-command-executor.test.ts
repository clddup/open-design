import type {
  DesignAsset,
  DesignOperation,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { applyAssetCommand } from "./asset-command-executor.js";
import { createWelcomeDocument } from "./document.js";
import { OperationError } from "./operation-error.js";

const sourceAsset: DesignAsset = {
  id: "asset_source",
  kind: "image",
  name: "Source",
  mimeType: "image/png",
  source: { type: "data", value: "c291cmNl" },
  size: { width: 640, height: 480 },
  extensions: {},
};

const resultAsset: DesignAsset = {
  ...sourceAsset,
  id: "asset_result",
  name: "Result",
  source: { type: "data", value: "cmVzdWx0" },
};

describe("asset command executor", () => {
  it("owns asset and image derivation lifecycle with reference safety", () => {
    const document = structuredClone(createWelcomeDocument());

    for (const asset of [sourceAsset, resultAsset]) {
      expect(
        applyAssetCommand(document, {
          commandId: `put_${asset.id}`,
          type: "put_asset",
          asset,
        }),
      ).toBe(true);
    }
    expect(
      applyAssetCommand(document, {
        commandId: "put_derivation",
        type: "put_image_asset_derivation",
        derivation: {
          id: "derivation_edit",
          sourceAssetId: sourceAsset.id,
          resultAssetId: resultAsset.id,
          operation: "replacement",
          referenceAssetIds: [],
          extensions: {},
        },
      }),
    ).toBe(true);
    expect(document.imageAssetDerivationOrder).toEqual(["derivation_edit"]);

    expect(() =>
      applyAssetCommand(document, {
        commandId: "delete_referenced_source",
        type: "delete_asset",
        assetId: sourceAsset.id,
      }),
    ).toThrowError(OperationError);
    expect(document.assetsById[sourceAsset.id]).toBeDefined();

    expect(
      applyAssetCommand(document, {
        commandId: "delete_derivation",
        type: "delete_image_asset_derivation",
        derivationId: "derivation_edit",
      }),
    ).toBe(true);
    expect(document.imageAssetDerivationOrder).toEqual([]);

    for (const assetId of [sourceAsset.id, resultAsset.id]) {
      expect(
        applyAssetCommand(document, {
          commandId: `delete_${assetId}`,
          type: "delete_asset",
          assetId,
        }),
      ).toBe(true);
    }
    expect(document.assetsById).toEqual({});
  });

  it("does not accept derivations with missing image assets", () => {
    const document = structuredClone(createWelcomeDocument());
    expect(() =>
      applyAssetCommand(document, {
        commandId: "put_invalid_derivation",
        type: "put_image_asset_derivation",
        derivation: {
          id: "derivation_invalid",
          sourceAssetId: "asset_missing",
          resultAssetId: "asset_other_missing",
          operation: "replacement",
          referenceAssetIds: [],
          extensions: {},
        },
      }),
    ).toThrowError(OperationError);
    expect(document.imageAssetDerivationOrder).toEqual([]);
  });

  it("declines commands owned by other executors", () => {
    const document = structuredClone(createWelcomeDocument());
    const command: DesignOperation = {
      commandId: "update_page",
      type: "update_page",
      pageId: "page_welcome",
      name: "Renamed",
    };

    expect(applyAssetCommand(document, command)).toBe(false);
  });
});
