import { describe, expect, it, vi } from "vitest";
import type { SaveModelProviderProfileRequest } from "../../shared/desktop-api";
import { WorkspaceStore } from "../project/workspace-store";
import {
  ModelProviderHost,
  type CredentialCipher,
} from "./model-provider-host";

const cipher: CredentialCipher = {
  available: () => true,
  encrypt: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decrypt: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
};

const profile: SaveModelProviderProfileRequest = {
  providerId: "provider_1",
  name: "Primary",
  enabled: true,
  apiFormat: "openai-chat-completions",
  authMode: "bearer",
  baseUrl: "https://models.example/v1/",
  models: [
    {
      modelId: "design-model",
      name: "Design model",
      contextWindow: 200_000,
      maxOutputTokens: 16_384,
      capabilities: {
        toolUse: true,
        imageInput: false,
        reasoning: true,
      },
      reasoningEfforts: ["off", "low", "medium", "high"],
    },
  ],
  setAsDefault: true,
};

const selection = {
  providerId: "provider_1",
  modelId: "design-model",
  reasoningEffort: "medium" as const,
};

function chatResponse(text = "Ready") {
  return new Response(
    [
      {
        id: "chat_1",
        object: "chat.completion.chunk",
        created: 1,
        model: "design-model",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: text },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chat_1",
        object: "chat.completion.chunk",
        created: 1,
        model: "design-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .concat("data: [DONE]\n\n")
      .join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function partialChatResponse() {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: "chat_partial",
              object: "chat.completion.chunk",
              created: 1,
              model: "design-model",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "Starting" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
          ),
        );
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("ModelProviderHost", () => {
  it("aborts a production model stream that produces no response events", async () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(":memory:");
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}));
    const host = new ModelProviderHost(store, cipher, fetch, undefined, {
      firstResponseTimeoutMs: 50,
      idleTimeoutMs: 100,
      totalTimeoutMs: 500,
    });
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    try {
      const pending = host.complete(
        {
          attemptId: "attempt_stalled",
          sessionId: "session_stalled",
          modelSelection: selection,
          system: "System",
          messages: [{ role: "user", content: "Design a settings page" }],
          tools: [],
        },
        new AbortController().signal,
      );
      const rejected = expect(pending).rejects.toThrow(
        "Model provider timed out after 50 ms waiting for a response",
      );

      await vi.advanceTimersByTimeAsync(51);

      await rejected;
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  it("aborts a production model stream that stops making progress", async () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(":memory:");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(partialChatResponse());
    const host = new ModelProviderHost(store, cipher, fetch, undefined, {
      firstResponseTimeoutMs: 100,
      idleTimeoutMs: 50,
      totalTimeoutMs: 500,
    });
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    try {
      const pending = host.complete(
        {
          attemptId: "attempt_idle",
          sessionId: "session_idle",
          modelSelection: selection,
          system: "System",
          messages: [{ role: "user", content: "Design a settings page" }],
          tools: [],
        },
        new AbortController().signal,
      );
      const rejected = expect(pending).rejects.toThrow(
        "Model provider stream timed out after 50 ms without activity",
      );

      await vi.advanceTimersByTimeAsync(101);

      await rejected;
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  it("resolves approved image IDs only for an image-capable model", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(chatResponse()));
    const imageBytes = Buffer.from("reference-image");
    const attachmentResolver = {
      resolve: vi.fn().mockResolvedValue({
        kind: "image",
        data: imageBytes.toString("base64"),
        mimeType: "image/png",
        byteSize: imageBytes.byteLength,
      }),
    };
    const host = new ModelProviderHost(
      store,
      cipher,
      fetch,
      attachmentResolver,
    );
    host.saveProfile({
      ...profile,
      models: profile.models.map((model) => ({
        ...model,
        capabilities: { ...model.capabilities, imageInput: true },
      })),
      apiKey: "provider-secret",
    });

    await host.complete(
      {
        attemptId: "attempt_image",
        sessionId: "session_image",
        modelSelection: selection,
        system: "System",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Use this style" },
              {
                type: "image_ref",
                attachmentId: `image_${"a".repeat(64)}`,
                name: "reference.png",
                mimeType: "image/png",
                byteSize: imageBytes.byteLength,
              },
            ],
          },
        ],
        tools: [],
      },
      new AbortController().signal,
    );

    expect(attachmentResolver.resolve).toHaveBeenCalledWith(
      `image_${"a".repeat(64)}`,
    );
    const payload = fetch.mock.calls[0]?.[1]?.body;
    if (typeof payload !== "string") {
      throw new Error("Expected string request body");
    }
    expect(payload).toContain(
      `data:image/png;base64,${imageBytes.toString("base64")}`,
    );
    store.close();
  });

  it("sends extracted product documents to a text-only model as untrusted context", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(chatResponse()));
    const documentText =
      "Design a calm mobile checkout with address, payment, and review steps.";
    const attachmentResolver = {
      resolve: vi.fn().mockResolvedValue({
        kind: "document",
        text: documentText,
        mimeType: "text/markdown",
        byteSize: 2048,
        truncated: false,
        extractedCharacterCount: documentText.length,
      }),
    };
    const host = new ModelProviderHost(
      store,
      cipher,
      fetch,
      attachmentResolver,
    );
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    await host.complete(
      {
        attemptId: "attempt_document",
        sessionId: "session_document",
        modelSelection: selection,
        system: "System",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Use the attached product brief" },
              {
                type: "document_ref",
                attachmentId: `file_${"b".repeat(64)}`,
                name: "product-brief.md",
                mimeType: "text/markdown",
                byteSize: 2048,
              },
            ],
          },
        ],
        tools: [],
      },
      new AbortController().signal,
    );

    expect(attachmentResolver.resolve).toHaveBeenCalledWith(
      `file_${"b".repeat(64)}`,
    );
    const payload = fetch.mock.calls[0]?.[1]?.body;
    if (typeof payload !== "string") {
      throw new Error("Expected string request body");
    }
    expect(payload).toContain(documentText);
    expect(payload).toContain("untrusted reference material");
    expect(payload).toContain("product-brief.md");
    store.close();
  });

  it("rejects forged image references for a model without image input", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(chatResponse()));
    const attachmentResolver = {
      resolve: vi.fn().mockResolvedValue({
        kind: "image",
        data: Buffer.from("reference-image").toString("base64"),
        mimeType: "image/png",
        byteSize: Buffer.byteLength("reference-image"),
      }),
    };
    const host = new ModelProviderHost(
      store,
      cipher,
      fetch,
      attachmentResolver,
    );
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    await expect(
      host.complete(
        {
          attemptId: "attempt_image_rejected",
          sessionId: "session_image_rejected",
          modelSelection: selection,
          system: "System",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Use this style" },
                {
                  type: "image_ref",
                  attachmentId: `image_${"a".repeat(64)}`,
                  name: "reference.png",
                  mimeType: "image/png",
                  byteSize: 15,
                },
              ],
            },
          ],
          tools: [],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Selected model does not support image input");
    expect(attachmentResolver.resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    store.close();
  });

  it("persists a sanitized multi-provider catalog and independent credential", () => {
    const store = new WorkspaceStore(":memory:");
    const host = new ModelProviderHost(store, cipher);

    const saved = host.saveProfile({ ...profile, apiKey: "provider-secret" });

    expect(saved).toMatchObject({
      version: 3,
      defaultSelection: selection,
      providers: [
        {
          providerId: "provider_1",
          apiFormat: "openai-chat-completions",
          baseUrl: "https://models.example/v1",
          hasApiKey: true,
        },
      ],
    });
    expect(JSON.stringify(saved)).not.toContain("provider-secret");
    expect(store.getPreference("model.provider.catalog.v3")).not.toContain(
      "provider-secret",
    );
    store.close();
  });

  it("resolves trusted context limits for the selected model", () => {
    const store = new WorkspaceStore(":memory:");
    const host = new ModelProviderHost(store, cipher);
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    expect(host.resolveModelContext(selection)).toEqual({
      contextWindow: 200_000,
      maxOutputTokens: 16_384,
    });
    store.close();
  });

  it("tests and completes the explicitly selected provider/model", async () => {
    const store = new WorkspaceStore(":memory:");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(chatResponse()));
    const host = new ModelProviderHost(store, cipher, fetch);
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    await expect(host.testConnection(selection)).resolves.toMatchObject({
      ok: true,
      providerId: "provider_1",
      modelId: "design-model",
    });
    const events = await host.complete(
      {
        attemptId: "attempt_1",
        sessionId: "session_1",
        modelSelection: selection,
        system: "System",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      },
      new AbortController().signal,
    );

    const started = events.find((event) => event.type === "attempt.started");
    expect(started?.type).toBe("attempt.started");
    if (started?.type === "attempt.started") {
      expect(started.identity).toMatchObject(selection);
    }
    expect(events.some((event) => event.type === "attempt.completed")).toBe(
      true,
    );
    const firstRequest = fetch.mock.calls[0];
    expect(requestUrl(firstRequest?.[0])).toBe(
      "https://models.example/v1/chat/completions",
    );
    expect(new Headers(firstRequest?.[1]?.headers).get("authorization")).toBe(
      "Bearer provider-secret",
    );
    expect(JSON.stringify(events)).not.toContain("provider-secret");
    store.close();
  });

  it("migrates the legacy single-provider settings once", () => {
    const store = new WorkspaceStore(":memory:");
    store.setPreference(
      "model.provider.settings",
      JSON.stringify({
        provider: "openai-compatible",
        baseUrl: "https://legacy.example/v1",
        model: "legacy-model",
        hasApiKey: true,
        updatedAt: "2026-08-09T00:00:00.000Z",
      }),
    );
    store.setPreference(
      "model.provider.credential",
      cipher.encrypt("legacy-secret").toString("base64"),
    );

    const catalog = new ModelProviderHost(store, cipher).getCatalog();

    expect(catalog).toMatchObject({
      providers: [
        {
          providerId: "migrated-openai-compatible",
          apiFormat: "openai-chat-completions",
          hasApiKey: true,
          models: [{ modelId: "legacy-model" }],
        },
      ],
    });
    expect(store.getPreference("model.provider.settings")).toBeNull();
    expect(store.getPreference("model.provider.credential")).toBeNull();
    store.close();
  });

  it("migrates the v1 provider catalog into the conversation-only v3 catalog", () => {
    const store = new WorkspaceStore(":memory:");
    store.setPreference(
      "model.provider.catalog.v1",
      JSON.stringify({
        version: 1,
        providers: [
          {
            providerId: "provider_1",
            name: "Primary",
            enabled: true,
            apiFormat: "openai-chat-completions",
            authMode: "bearer",
            baseUrl: "https://models.example/v1",
            models: profile.models.map((model) => ({
              ...model,
              capabilities: {
                toolUse: model.capabilities.toolUse,
                imageInput: model.capabilities.imageInput,
                reasoning: model.capabilities.reasoning,
              },
            })),
            hasApiKey: false,
            updatedAt: "2026-08-09T00:00:00.000Z",
          },
        ],
        defaultSelection: selection,
      }),
    );

    const catalog = new ModelProviderHost(store, cipher).getCatalog();

    expect(catalog.version).toBe(3);
    expect(catalog.providers[0]?.models[0]?.capabilities).toEqual({
      toolUse: true,
      imageInput: false,
      reasoning: true,
    });
    expect(store.getPreference("model.provider.catalog.v1")).toBeNull();
    expect(store.getPreference("model.provider.catalog.v3")).not.toBeNull();
    store.close();
  });

  it("deleting a provider removes it and chooses the next enabled default", () => {
    const store = new WorkspaceStore(":memory:");
    const host = new ModelProviderHost(store, cipher);
    host.saveProfile({ ...profile, apiKey: "one" });
    host.saveProfile({
      ...profile,
      providerId: "provider_2",
      name: "Fallback",
      apiKey: "two",
      setAsDefault: false,
    });

    const catalog = host.deleteProfile({ providerId: "provider_1" });

    expect(catalog.providers.map((provider) => provider.providerId)).toEqual([
      "provider_2",
    ]);
    expect(catalog.defaultSelection?.providerId).toBe("provider_2");
    store.close();
  });
});

function requestUrl(input: Parameters<typeof globalThis.fetch>[0] | undefined) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url;
}
