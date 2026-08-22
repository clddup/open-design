import { describe, expect, it, vi } from "vitest";
import { WorkspaceStore } from "../project/workspace-store";
import {
  BOOST_RESOLUTION_PROMPT,
  EXPAND_IMAGE_PROMPT,
  ImageGenerationHost,
} from "./image-generation-host";
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

  it("edits an existing image through multipart and requires transparent PNG output", async () => {
    const store = new WorkspaceStore(":memory:");
    const editedBytes = alphaPngFixture();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: editedBytes.toString("base64") }],
        }),
        {
          status: 200,
          headers: { "x-request-id": "image_edit_request_1" },
        },
      ),
    );
    const host = new ImageGenerationHost(store, cipher, fetch);
    host.saveSettings({
      enabled: true,
      apiFormat: "openai-images",
      authMode: "x-api-key",
      baseUrl: "https://images.example/v1",
      modelId: "gpt-image-2",
      apiKey: "image-secret",
    });

    const result = await host.removeBackground(
      {
        bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
        mimeType: "image/jpeg",
        name: "Portrait photo.jpeg",
      },
      new AbortController().signal,
    );

    expect(Buffer.from(result.bytes)).toEqual(editedBytes);
    expect(result).toMatchObject({
      modelId: "gpt-image-2",
      operation: "remove-background",
      outputFormat: "png",
      providerRequestId: "image_edit_request_1",
    });
    const request = fetch.mock.calls[0];
    expect(requestUrl(request?.[0])).toBe(
      "https://images.example/v1/images/edits",
    );
    const headers = new Headers(request?.[1]?.headers);
    expect(headers.get("x-api-key")).toBe("image-secret");
    expect(headers.has("content-type")).toBe(false);
    const form = request?.[1]?.body;
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) throw new Error("Expected FormData body");
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("background")).toBe("transparent");
    expect(form.get("output_format")).toBe("png");
    expect(form.get("size")).toBe("auto");
    expect(form.get("quality")).toBe("auto");
    const source = form.get("image[]");
    expect(source).toBeInstanceOf(Blob);
    expect((source as Blob).type).toBe("image/jpeg");
    store.close();
  });

  it("rejects an opaque PNG returned for background removal", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: opaquePngFixture().toString("base64") }],
        }),
        { status: 200 },
      ),
    );
    const host = new ImageGenerationHost(store, cipher, fetch);
    host.saveSettings({
      enabled: true,
      apiFormat: "openai-images",
      authMode: "none",
      baseUrl: "https://images.example/v1",
      modelId: "gpt-image-2",
    });

    await expect(
      host.removeBackground(
        {
          bytes: Uint8Array.from([0x89]),
          mimeType: "image/png",
          name: "source.png",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("PNG without transparency");
    store.close();
  });

  it("edits with a bounded prompt and one ordered reference image", async () => {
    const store = new WorkspaceStore(":memory:");
    const editedBytes = opaquePngFixture();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: editedBytes.toString("base64") }],
        }),
        { status: 200 },
      ),
    );
    const host = new ImageGenerationHost(store, cipher, fetch);
    host.saveSettings({
      enabled: true,
      apiFormat: "openai-images",
      authMode: "none",
      baseUrl: "https://images.example/v1",
      modelId: "gpt-image-2",
    });

    const result = await host.editWithPrompt(
      {
        source: {
          bytes: Uint8Array.from([0x89, 0x50]),
          mimeType: "image/png",
          name: "Product.png",
        },
        prompt: "Place the product in a quiet editorial studio scene.",
        references: [
          {
            bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
            mimeType: "image/jpeg",
            name: "Lighting reference.jpg",
          },
        ],
      },
      new AbortController().signal,
    );

    expect(result.operation).toBe("prompt-edit");
    const request = fetch.mock.calls[0];
    const form = request?.[1]?.body;
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) throw new Error("Expected FormData body");
    expect(form.get("prompt")).toBe(
      "Place the product in a quiet editorial studio scene.",
    );
    expect(form.get("background")).toBe("auto");
    expect(form.getAll("image[]")).toHaveLength(2);
    expect((form.getAll("image[]")[0] as Blob).type).toBe("image/png");
    expect((form.getAll("image[]")[1] as Blob).type).toBe("image/jpeg");
    store.close();
  });

  it("rejects empty prompts and more than one reference before network I/O", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi.fn<typeof globalThis.fetch>();
    const host = new ImageGenerationHost(store, cipher, fetch);
    const source = {
      bytes: Uint8Array.from([0x89]),
      mimeType: "image/png" as const,
      name: "Source.png",
    };
    await expect(
      host.editWithPrompt(
        { source, prompt: "   " },
        new AbortController().signal,
      ),
    ).rejects.toThrow("1 to 32,000");
    await expect(
      host.editWithPrompt(
        { source, prompt: "Edit", references: [source, source] },
        new AbortController().signal,
      ),
    ).rejects.toThrow("at most one reference");
    expect(fetch).not.toHaveBeenCalled();
    store.close();
  });

  it("submits exact-size alpha masks for erase and isolate operations", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: opaquePngFixture().toString("base64") }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: alphaPngFixture().toString("base64") }],
          }),
          { status: 200 },
        ),
      );
    const host = new ImageGenerationHost(store, cipher, fetch);
    host.saveSettings({
      enabled: true,
      apiFormat: "openai-images",
      authMode: "none",
      baseUrl: "https://images.example/v1",
      modelId: "gpt-image-2",
    });
    const source = {
      bytes: opaquePngFixture(),
      mimeType: "image/png" as const,
      name: "Source.png",
    };
    const mask = {
      bytes: alphaPngFixture(),
      mimeType: "image/png" as const,
      name: "Selection mask.png",
    };

    expect(
      await host.eraseObject({ source, mask }, new AbortController().signal),
    ).toMatchObject({ operation: "erase-object" });
    expect(
      await host.isolateObject({ source, mask }, new AbortController().signal),
    ).toMatchObject({ operation: "isolate-object" });
    const eraseForm = fetch.mock.calls[0]?.[1]?.body;
    const isolateForm = fetch.mock.calls[1]?.[1]?.body;
    if (
      !(eraseForm instanceof FormData) ||
      !(isolateForm instanceof FormData)
    ) {
      throw new Error("Expected masked FormData requests");
    }
    expect(eraseForm.get("mask")).toBeInstanceOf(Blob);
    expect(eraseForm.getAll("image[]")).toHaveLength(1);
    expect(eraseForm.get("background")).toBe("auto");
    expect(isolateForm.get("background")).toBe("transparent");
    store.close();
  });

  it("rejects a mask with mismatched dimensions before network I/O", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi.fn<typeof globalThis.fetch>();
    const host = new ImageGenerationHost(store, cipher, fetch);
    await expect(
      host.eraseObject(
        {
          source: {
            bytes: opaquePngFixture(),
            mimeType: "image/png",
            name: "Source.png",
          },
          mask: {
            bytes: pngFixture(6, 2, 1),
            mimeType: "image/png",
            name: "Mask.png",
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("matching the source dimensions");
    expect(fetch).not.toHaveBeenCalled();
    store.close();
  });

  it("expands an exact-size prepared canvas and rejects provider size drift", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ b64_json: pngFixture(2, 1024, 1024).toString("base64") }],
        }),
        { status: 200 },
      ),
    );
    const host = new ImageGenerationHost(store, cipher, fetch);
    host.saveSettings({
      enabled: true,
      apiFormat: "openai-images",
      authMode: "none",
      baseUrl: "https://images.example/v1",
      modelId: "gpt-image-2",
    });
    const source = {
      bytes: pngFixture(6, 1024, 1024),
      mimeType: "image/png" as const,
      name: "Expansion source.png",
    };
    const mask = {
      bytes: pngFixture(6, 1024, 1024),
      mimeType: "image/png" as const,
      name: "Expansion mask.png",
    };
    await expect(
      host.expandImage(
        { source, mask, size: "1024x1024" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ operation: "expand" });
    const form = fetch.mock.calls[0]?.[1]?.body;
    if (!(form instanceof FormData)) throw new Error("Expected FormData");
    expect(form.get("prompt")).toBe(EXPAND_IMAGE_PROMPT);
    expect(form.get("size")).toBe("1024x1024");

    await expect(
      host.expandImage(
        { source, mask, size: "1536x1024" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("must match the prepared source canvas");
    expect(fetch).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("boosts resolution to the trusted exact target without changing image intent", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ b64_json: pngFixture(6, 1600, 1200).toString("base64") }],
        }),
        { status: 200 },
      ),
    );
    const host = new ImageGenerationHost(store, cipher, fetch);
    host.saveSettings({
      enabled: true,
      apiFormat: "openai-images",
      authMode: "none",
      baseUrl: "https://images.example/v1",
      modelId: "gpt-image-2",
    });
    await expect(
      host.boostResolution(
        {
          source: {
            bytes: pngFixture(6, 800, 600),
            mimeType: "image/png",
            name: "Source.png",
          },
          size: "1600x1200",
          preserveTransparency: true,
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ operation: "upscale" });
    const form = fetch.mock.calls[0]?.[1]?.body;
    if (!(form instanceof FormData)) throw new Error("Expected FormData");
    expect(form.get("prompt")).toBe(BOOST_RESOLUTION_PROMPT);
    expect(form.get("size")).toBe("1600x1200");
    expect(form.get("background")).toBe("transparent");

    await expect(
      host.boostResolution(
        {
          source: {
            bytes: pngFixture(6, 800, 600),
            mimeType: "image/png",
            name: "Source.png",
          },
          size: "1536x1024",
          preserveTransparency: true,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("trusted source target");
    expect(fetch).toHaveBeenCalledTimes(1);
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

function alphaPngFixture(): Buffer {
  return pngFixture(6);
}

function opaquePngFixture(): Buffer {
  return pngFixture(2);
}

function pngFixture(colorType: number, width = 1, height = 1): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = colorType;
  const iend = Buffer.alloc(12);
  iend.write("IEND", 4, "ascii");
  return Buffer.concat([signature, ihdr, iend]);
}
