import { describe, expect, it, vi } from "vitest";
import { channels } from "@/shared/desktop-api";
import { createMediaApi } from "./media-api";
import { createProviderApi } from "./provider-api";

const catalog = {
  version: 3,
  providers: [
    {
      providerId: "provider_1",
      name: "Primary",
      enabled: true,
      apiFormat: "openai-responses",
      authMode: "bearer",
      baseUrl: "https://api.openai.com/v1",
      models: [
        {
          modelId: "design-model",
          name: "Design model",
          contextWindow: 200_000,
          maxOutputTokens: 16_384,
          capabilities: {
            toolUse: true,
            imageInput: true,
            reasoning: true,
          },
          reasoningEfforts: ["off", "medium", "high"],
        },
      ],
      hasApiKey: true,
      updatedAt: "2026-08-27T06:00:00.000Z",
    },
  ],
  defaultSelection: {
    providerId: "provider_1",
    modelId: "design-model",
    reasoningEffort: "medium",
  },
} as const;

describe("extracted Provider and media Preload APIs", () => {
  it("validates Provider responses and filters invalid catalog events", async () => {
    const invoke = vi.fn().mockResolvedValue(catalog);
    let catalogEvent: ((value: unknown) => void) | undefined;
    const api = createProviderApi(invoke, (_channel, listener) => {
      catalogEvent = listener;
      return vi.fn();
    });

    await expect(api.getModelProviderCatalog()).resolves.toEqual(catalog);
    expect(invoke).toHaveBeenCalledWith(channels.getModelProviderCatalog);

    const listener = vi.fn();
    api.onModelProviderCatalogChange(listener);
    catalogEvent?.({ ...catalog, version: 2 });
    expect(listener).not.toHaveBeenCalled();
    catalogEvent?.(catalog);
    expect(listener).toHaveBeenCalledWith(catalog);
  });

  it("rejects invalid Provider input before invoking Main", async () => {
    const invoke = vi.fn();
    const api = createProviderApi(invoke, () => vi.fn());
    await expect(
      api.deleteModelProviderProfile({ providerId: "../provider" }),
    ).rejects.toThrow("Invalid model provider delete request");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("validates attachment selections and import requests", async () => {
    const attachmentId = `image_${"a".repeat(64)}`;
    const selection = {
      attachmentId,
      name: "reference.png",
      mimeType: "image/png" as const,
      byteSize: 4,
      previewDataUrl: "data:image/png;base64,aW1n",
    };
    const invoke = vi.fn().mockResolvedValue([selection]);
    const api = createMediaApi(invoke);

    await expect(api.selectAgentAttachments()).resolves.toEqual([selection]);
    await expect(
      api.importAgentAttachments([
        { name: "empty.png", bytes: new Uint8Array() },
      ]),
    ).rejects.toThrow("Invalid Agent attachment import request");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("preserves native image-picker cancellation", async () => {
    const api = createMediaApi(vi.fn().mockResolvedValue(null));
    await expect(api.selectDesignImage()).resolves.toBeNull();
  });
});
