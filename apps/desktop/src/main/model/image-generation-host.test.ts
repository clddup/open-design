import { describe, expect, it, vi } from "vitest";
import { WorkspaceStore } from "../project/workspace-store";
import { ImageGenerationHost } from "./image-generation-host";
import {
  ModelProviderHost,
  modelProviderCredentialKey,
  type CredentialCipher,
} from "./model-provider-host";

const cipher: CredentialCipher = {
  available: () => true,
  encrypt: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decrypt: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
};

describe("ImageGenerationHost", () => {
  it("starts disabled without borrowing a conversation Provider", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi.fn<typeof globalThis.fetch>();
    const host = new ImageGenerationHost(store, cipher, fetch);

    expect(host.getSettings()).toEqual({
      version: 1,
      enabled: false,
      apiFormat: "openai-images",
      authMode: "bearer",
      baseUrl: "https://api.openai.com/v1",
      modelId: "",
      hasApiKey: false,
      updatedAt: null,
    });
    await expect(
      host.generateImage(
        { prompt: "A cinematic penguin poster", role: "hero" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Global image generation is not enabled");
    expect(fetch).not.toHaveBeenCalled();
    store.close();
  });

  it("uses only the independently saved global endpoint, credential, and model ID", async () => {
    const store = new WorkspaceStore(":memory:");
    const generatedBytes = Buffer.from("generated-image-bytes");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: generatedBytes.toString("base64") }],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "image_request_1",
          },
        },
      ),
    );
    const host = new ImageGenerationHost(store, cipher, fetch);
    host.saveSettings({
      enabled: true,
      apiFormat: "openai-images",
      authMode: "bearer",
      baseUrl: "https://images.example/v1/",
      modelId: "future-image-model",
      apiKey: "image-secret",
    });

    const result = await host.generateImage(
      {
        prompt: "A cinematic campaign poster with a luminous penguin mascot",
        role: "hero",
        size: "1536x1024",
        quality: "high",
        outputFormat: "webp",
      },
      new AbortController().signal,
    );

    expect(Buffer.from(result.bytes)).toEqual(generatedBytes);
    expect(result).toMatchObject({
      apiFormat: "openai-images",
      modelId: "future-image-model",
      providerRequestId: "image_request_1",
      size: "1536x1024",
      quality: "high",
      outputFormat: "webp",
    });
    const request = fetch.mock.calls[0];
    expect(requestUrl(request?.[0])).toBe(
      "https://images.example/v1/images/generations",
    );
    expect(new Headers(request?.[1]?.headers).get("authorization")).toBe(
      "Bearer image-secret",
    );
    expect(requestJson(request)).toEqual({
      model: "future-image-model",
      prompt: "A cinematic campaign poster with a luminous penguin mascot",
      n: 1,
      size: "1536x1024",
      quality: "high",
      output_format: "webp",
    });
    store.close();
  });

  it("migrates the old v2 selection and copies its credential before catalog cleanup", () => {
    const store = new WorkspaceStore(":memory:");
    store.setPreference(
      "model.provider.catalog.v2",
      JSON.stringify({
        version: 2,
        providers: [
          {
            providerId: "legacy-images",
            name: "Legacy images",
            enabled: true,
            apiFormat: "openai-responses",
            imageGenerationApiFormat: "openai-images",
            authMode: "bearer",
            baseUrl: "https://legacy-images.example/v1",
            models: [
              {
                modelId: "gpt-image-2",
                name: "GPT Image 2",
                contextWindow: 128_000,
                maxOutputTokens: 16_384,
                capabilities: {
                  toolUse: false,
                  imageInput: true,
                  imageGeneration: true,
                  reasoning: false,
                },
                reasoningEfforts: ["off"],
              },
            ],
            hasApiKey: false,
            updatedAt: "2026-08-10T00:00:00.000Z",
          },
        ],
        defaultImageGenerationSelection: {
          providerId: "legacy-images",
          modelId: "gpt-image-2",
        },
      }),
    );
    store.setPreference(
      modelProviderCredentialKey("legacy-images"),
      cipher.encrypt("legacy-secret").toString("base64"),
    );

    const settings = new ImageGenerationHost(store, cipher).getSettings();
    const catalog = new ModelProviderHost(store, cipher).getCatalog();

    expect(settings).toMatchObject({
      version: 1,
      enabled: true,
      apiFormat: "openai-images",
      authMode: "bearer",
      baseUrl: "https://legacy-images.example/v1",
      modelId: "gpt-image-2",
      hasApiKey: true,
    });
    expect(catalog).toMatchObject({
      version: 3,
      providers: [
        {
          providerId: "legacy-images",
          models: [
            {
              modelId: "gpt-image-2",
              capabilities: {
                toolUse: false,
                imageInput: true,
                reasoning: false,
              },
            },
          ],
        },
      ],
    });
    expect(store.getPreference("model.provider.catalog.v2")).toBeNull();
    expect(store.getPreference("image-generation.settings.v1")).not.toBeNull();
    expect(
      store.getPreference("image-generation.credential.v1"),
    ).not.toBeNull();
    store.close();
  });

  it("does not expose or silently reuse a conversation Provider credential", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi.fn<typeof globalThis.fetch>();
    store.setPreference(
      modelProviderCredentialKey("conversation-provider"),
      cipher.encrypt("conversation-secret").toString("base64"),
    );
    const host = new ImageGenerationHost(store, cipher, fetch);
    const saved = host.saveSettings({
      enabled: true,
      apiFormat: "openai-images",
      authMode: "bearer",
      baseUrl: "https://images.example/v1",
      modelId: "gpt-image-2",
    });

    expect(saved.hasApiKey).toBe(false);
    await expect(
      host.generateImage(
        { prompt: "A penguin", role: "hero" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Global image-generation API key is not configured");
    expect(fetch).not.toHaveBeenCalled();
    store.close();
  });
});

function requestJson(
  call: Parameters<typeof globalThis.fetch> | undefined,
): Record<string, unknown> {
  const body = call?.[1]?.body;
  if (typeof body !== "string") throw new Error("Expected string body");
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

function requestUrl(input: RequestInfo | URL | undefined): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  throw new Error("Expected fetch request input");
}
