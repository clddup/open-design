import type { DesignAsset } from "@opendesign/design-contracts";
import { describe, expect, it, vi } from "vitest";
import { DesignImageEditService } from "./design-image-edit-service.js";

vi.mock("electron", () => ({
  nativeImage: {
    createFromBuffer: () => ({
      getSize: () => ({ width: 10, height: 10 }),
      toBitmap: () => Buffer.from([0, 0, 0, 0]),
      toPNG: () => Buffer.from([1, 2, 3, 4]),
    }),
    createFromBitmap: () => ({
      toPNG: () => Buffer.from([1, 2, 3, 4]),
    }),
  },
}));

const source: DesignAsset = {
  id: "asset_source",
  kind: "image",
  name: "Source.png",
  mimeType: "image/png",
  source: { type: "data", value: Buffer.from([1, 2, 3, 4]).toString("base64") },
  size: { width: 10, height: 10 },
  extensions: {},
};

function setup() {
  const imageGenerationHost = {
    removeBackground: vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 4]),
      apiFormat: "openai-images",
      modelId: "gpt-image-2",
      providerRequestId: "provider_edit",
      outputFormat: "png",
      operation: "remove-background",
    }),
    editWithPrompt: vi.fn(),
  };
  const attachmentHost = {
    importImageBytes: vi.fn().mockResolvedValue({
      attachmentId: `image_${"b".repeat(64)}`,
      name: "Source — Background removed.png",
      mimeType: "image/png",
      byteSize: 4,
    }),
  };
  const service = new DesignImageEditService({
    getAttachmentHost: () => attachmentHost as never,
    getImageGenerationHost: () => imageGenerationHost as never,
  });
  return { attachmentHost, imageGenerationHost, service };
}

describe("DesignImageEditService", () => {
  it("owns provider editing and content-addressed result materialization", async () => {
    const { attachmentHost, imageGenerationHost, service } = setup();

    const result = await service.edit(
      {
        action: "remove-background",
        source,
        importedBy: "agent-image-edit",
      },
      new AbortController().signal,
    );

    expect(imageGenerationHost.removeBackground).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Source.png", mimeType: "image/png" }),
      expect.any(AbortSignal),
    );
    expect(attachmentHost.importImageBytes).toHaveBeenCalledWith(
      "Source — Background removed.png",
      Buffer.from([1, 2, 3, 4]),
    );
    expect(result).toMatchObject({
      asset: {
        id: `asset_${"b".repeat(64)}`,
        kind: "image",
        mimeType: "image/png",
        size: { width: 10, height: 10 },
      },
      derivation: {
        sourceAssetId: "asset_source",
        resultAssetId: `asset_${"b".repeat(64)}`,
        operation: "remove-background",
        extensions: {
          provider: "openai-images",
          modelId: "gpt-image-2",
          providerRequestId: "provider_edit",
        },
      },
    });
  });

  it("rejects self-references before contacting the provider", async () => {
    const { imageGenerationHost, service } = setup();

    await expect(
      service.edit(
        {
          action: "prompt-edit",
          source,
          prompt: "Refine the source",
          references: [source],
          importedBy: "agent-image-edit",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("at most one distinct reference image");
    expect(imageGenerationHost.editWithPrompt).not.toHaveBeenCalled();
  });

  it("rejects non-raster sources before resolving external services", async () => {
    const { imageGenerationHost, service } = setup();
    const invalid = {
      ...source,
      kind: "text",
    } as unknown as DesignAsset;

    await expect(
      service.edit(
        {
          action: "remove-background",
          source: invalid,
          importedBy: "agent-image-edit",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("not a supported embedded raster");
    expect(imageGenerationHost.removeBackground).not.toHaveBeenCalled();
  });
});
