import { describe, expect, it, vi } from "vitest";
import type { SaveModelProviderProfileRequest } from "../../shared/desktop-api";
import { WorkspaceStore } from "../project/workspace-store";
import type {
  CanonicalStreamEvent,
  ModelGateway,
} from "@opendesign/model-gateway";
import {
  ModelProviderHost,
  type CredentialCipher,
} from "./model-provider-host";
import type { ModelProviderPerformanceSample } from "./model-provider-stream";

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
  it("retries a transient Provider termination before semantic output", async () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(":memory:");
    let callCount = 0;
    const attemptSignals: AbortSignal[] = [];
    const gatewayFactory = (): ModelGateway => ({
      async *stream(request) {
        await Promise.resolve();
        callCount += 1;
        attemptSignals.push(request.signal);
        yield startedEvent(request.attemptId);
        if (callCount === 1) {
          yield {
            type: "attempt.failed",
            attemptId: request.attemptId,
            error: {
              code: "provider_error",
              message: "terminated",
              retryable: true,
              provider: "provider_1",
              providerRequestId: "resp_interrupted",
            },
          };
          return;
        }
        yield {
          type: "block.started",
          attemptId: request.attemptId,
          blockId: "text",
          kind: "text",
        };
        yield {
          type: "block.completed",
          attemptId: request.attemptId,
          block: { id: "text", type: "text", text: "Recovered" },
        };
        yield completedEvent(request.attemptId, "resp_recovered");
      },
    });
    const host = new ModelProviderHost(
      store,
      cipher,
      globalThis.fetch,
      undefined,
      undefined,
      gatewayFactory,
    );
    const performance =
      vi.fn<(sample: ModelProviderPerformanceSample) => void>();
    host.setPerformanceObserver(performance);
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    try {
      const pending = host.complete(
        baseRequest("attempt_retry"),
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(401);
      const events = await pending;
      expect(callCount).toBe(2);
      expect(attemptSignals).toHaveLength(2);
      expect(attemptSignals[0]?.aborted).toBe(true);
      expect(attemptSignals[1]?.aborted).toBe(false);
      expect(attemptSignals[0]).not.toBe(attemptSignals[1]);
      expect(
        events.filter((event) => event.type === "attempt.started"),
      ).toHaveLength(1);
      expect(events).toContainEqual({
        type: "attempt.retrying",
        attemptId: "attempt_retry",
        retry: 1,
        maxRetries: 5,
        delayMs: 400,
      });
      expect(events).toContainEqual({
        type: "attempt.recovered",
        attemptId: "attempt_retry",
        retriesUsed: 1,
        maxRetries: 5,
      });
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "attempt.failed" }),
      );
      expect(events.at(-1)).toMatchObject({
        type: "attempt.completed",
        providerRequestId: "resp_recovered",
      });
      expect(performance).toHaveBeenCalledTimes(1);
      expect(performance).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptId: "attempt_retry",
          status: "completed",
          retries: 1,
        }),
      );
      expect(performance.mock.calls[0]?.[0].totalMs).toBeGreaterThanOrEqual(
        400,
      );
      expect(
        performance.mock.calls[0]?.[0].firstContentEventMs,
      ).toBeGreaterThanOrEqual(400);
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  it("does not attach a failed retry request ID to a later terminal failure", async () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(":memory:");
    let callCount = 0;
    const host = new ModelProviderHost(
      store,
      cipher,
      globalThis.fetch,
      undefined,
      undefined,
      () => ({
        async *stream(request): AsyncIterable<CanonicalStreamEvent> {
          await Promise.resolve();
          callCount += 1;
          yield startedEvent(request.attemptId);
          yield {
            type: "attempt.failed",
            attemptId: request.attemptId,
            error: {
              code: "provider_error",
              message: "terminated",
              retryable: true,
              provider: "provider_1",
              ...(callCount === 1
                ? { providerRequestId: "resp_first_interrupted" }
                : {}),
            },
          };
        },
      }),
    );
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    try {
      const pending = host.complete(
        baseRequest("attempt_request_id"),
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(11_301);
      const events = await pending;
      expect(callCount).toBe(6);
      expect(events.at(-1)).toEqual({
        type: "attempt.failed",
        attemptId: "attempt_request_id",
        error: {
          code: "provider_error",
          message: "terminated",
          retryable: true,
          provider: "provider_1",
        },
      });
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  it("cancels immediately while waiting to reconnect", async () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(":memory:");
    let callCount = 0;
    let markRetryScheduled!: () => void;
    const retryScheduled = new Promise<void>((resolve) => {
      markRetryScheduled = resolve;
    });
    const host = new ModelProviderHost(
      store,
      cipher,
      globalThis.fetch,
      undefined,
      undefined,
      () => ({
        async *stream(request): AsyncIterable<CanonicalStreamEvent> {
          await Promise.resolve();
          callCount += 1;
          yield startedEvent(request.attemptId);
          yield {
            type: "attempt.failed",
            attemptId: request.attemptId,
            error: {
              code: "provider_error",
              message: "terminated",
              retryable: true,
              provider: "provider_1",
            },
          };
        },
      }),
    );
    host.saveProfile({ ...profile, apiKey: "provider-secret" });
    const controller = new AbortController();
    const events: CanonicalStreamEvent[] = [];

    try {
      const pending = (async () => {
        for await (const event of host.stream(
          baseRequest("attempt_cancel_retry"),
          controller.signal,
        )) {
          events.push(event);
          if (event.type === "attempt.retrying") markRetryScheduled();
        }
      })();
      await retryScheduled;
      controller.abort(new DOMException("User cancelled", "AbortError"));
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });

      expect(callCount).toBe(1);
      expect(events).toEqual([
        {
          type: "attempt.retrying",
          attemptId: "attempt_cancel_retry",
          retry: 1,
          maxRetries: 5,
          delayMs: 400,
        },
      ]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  it("keeps partial output private while bounded retries are exhausted", async () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(":memory:");
    let callCount = 0;
    const host = new ModelProviderHost(
      store,
      cipher,
      globalThis.fetch,
      undefined,
      undefined,
      () => ({
        async *stream(request): AsyncIterable<CanonicalStreamEvent> {
          await Promise.resolve();
          callCount += 1;
          yield startedEvent(request.attemptId);
          yield {
            type: "block.started",
            attemptId: request.attemptId,
            blockId: "partial_tool",
            kind: "tool_call",
          };
          yield {
            type: "attempt.failed",
            attemptId: request.attemptId,
            error: {
              code: "provider_error",
              message: "terminated",
              retryable: true,
              provider: "provider_1",
            },
          };
        },
      }),
    );
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    try {
      const pending = host.complete(
        baseRequest("attempt_no_retry"),
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(11_301);
      const events = await pending;

      expect(callCount).toBe(6);
      expect(
        events.filter((event) => event.type === "block.started"),
      ).toHaveLength(0);
      expect(
        events.filter((event) => event.type === "attempt.retrying"),
      ).toHaveLength(5);
      expect(events.at(-1)).toMatchObject({
        type: "attempt.failed",
        error: { message: "terminated" },
      });
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  it("reconnects when an HTTP stream ends without a terminal event", async () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(":memory:");
    let callCount = 0;
    const host = new ModelProviderHost(
      store,
      cipher,
      globalThis.fetch,
      undefined,
      undefined,
      () => ({
        async *stream(request): AsyncIterable<CanonicalStreamEvent> {
          await Promise.resolve();
          callCount += 1;
          yield startedEvent(request.attemptId);
          if (callCount === 1) return;
          yield {
            type: "block.started",
            attemptId: request.attemptId,
            blockId: "text",
            kind: "text",
          };
          yield {
            type: "block.completed",
            attemptId: request.attemptId,
            block: { id: "text", type: "text", text: "Recovered" },
          };
          yield completedEvent(request.attemptId, "resp_recovered");
        },
      }),
    );
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    try {
      const pending = host.complete(
        baseRequest("attempt_early_eof"),
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(401);
      const events = await pending;

      expect(callCount).toBe(2);
      expect(events).toContainEqual({
        type: "attempt.retrying",
        attemptId: "attempt_early_eof",
        retry: 1,
        maxRetries: 5,
        delayMs: 400,
      });
      expect(events.at(-1)).toMatchObject({
        type: "attempt.completed",
        providerRequestId: "resp_recovered",
      });
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  it.each([
    ["provider_timeout", true],
    ["provider_error", false],
    ["context_too_large", true],
  ])(
    "does not reconnect deterministic %s failures",
    async (code, retryable) => {
      const store = new WorkspaceStore(":memory:");
      let callCount = 0;
      const host = new ModelProviderHost(
        store,
        cipher,
        globalThis.fetch,
        undefined,
        undefined,
        () => ({
          async *stream(request): AsyncIterable<CanonicalStreamEvent> {
            await Promise.resolve();
            callCount += 1;
            yield startedEvent(request.attemptId);
            yield {
              type: "attempt.failed",
              attemptId: request.attemptId,
              error: {
                code,
                message: "Deterministic failure",
                retryable,
                provider: "provider_1",
                ...(code === "provider_timeout"
                  ? {
                      timeout: {
                        phase: "stream-idle" as const,
                        thresholdMs: 120_000,
                      },
                    }
                  : {}),
              },
            };
          },
        }),
      );
      host.saveProfile({ ...profile, apiKey: "provider-secret" });

      try {
        const events = await host.complete(
          baseRequest(`attempt_${code}`),
          new AbortController().signal,
        );
        expect(callCount).toBe(1);
        expect(events).not.toContainEqual(
          expect.objectContaining({ type: "attempt.retrying" }),
        );
        expect(events.at(-1)).toMatchObject({
          type: "attempt.failed",
          error: { code },
        });
      } finally {
        store.close();
      }
    },
  );

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
      await vi.advanceTimersByTimeAsync(51);
      await expect(pending).resolves.toContainEqual({
        type: "attempt.failed",
        attemptId: "attempt_stalled",
        error: {
          code: "provider_timeout",
          message:
            "Model provider timed out after 50 ms waiting for a response",
          retryable: true,
          provider: "provider_1",
          timeout: { phase: "first-response", thresholdMs: 50 },
        },
      });
      await expect(pending).resolves.toMatchObject([
        { type: "attempt.started", attemptId: "attempt_stalled" },
        { type: "attempt.failed", attemptId: "attempt_stalled" },
      ]);
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
      await vi.advanceTimersByTimeAsync(101);
      await expect(pending).resolves.toContainEqual({
        type: "attempt.failed",
        attemptId: "attempt_idle",
        error: {
          code: "provider_timeout",
          message:
            "Model provider stream timed out after 50 ms without activity",
          retryable: true,
          provider: "provider_1",
          timeout: { phase: "stream-idle", thresholdMs: 50 },
        },
      });
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  it("aborts and closes the canonical source iterator after watchdog timeout", async () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(":memory:");
    const closeIterator = vi.fn(() =>
      Promise.resolve({ done: true as const, value: undefined }),
    );
    let sourceSignal: AbortSignal | undefined;
    const host = new ModelProviderHost(
      store,
      cipher,
      globalThis.fetch,
      undefined,
      {
        firstResponseTimeoutMs: 50,
        idleTimeoutMs: 100,
        totalTimeoutMs: 500,
      },
      () => ({
        stream(request) {
          sourceSignal = request.signal;
          let first = true;
          return {
            [Symbol.asyncIterator]() {
              return {
                next() {
                  if (first) {
                    first = false;
                    return Promise.resolve({
                      done: false as const,
                      value: {
                        type: "attempt.started" as const,
                        attemptId: request.attemptId,
                        model: request.modelSelection.modelId,
                        identity: {
                          ...request.modelSelection,
                          apiFormat: "openai-responses" as const,
                        },
                      },
                    });
                  }
                  return new Promise(() => undefined);
                },
                return: closeIterator,
              };
            },
          };
        },
      }),
    );
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    try {
      const pending = host.complete(
        {
          attemptId: "attempt_iterator",
          sessionId: "session_iterator",
          modelSelection: selection,
          system: "System",
          messages: [{ role: "user", content: "Design" }],
          tools: [],
        },
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(51);
      const events = await pending;
      expect(events.at(-1)).toMatchObject({
        type: "attempt.failed",
        error: {
          timeout: { phase: "first-response", thresholdMs: 50 },
        },
      });
      expect(sourceSignal?.aborted).toBe(true);
      expect(closeIterator).toHaveBeenCalledOnce();
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  it("distinguishes the total Provider deadline from stream idle timeout", async () => {
    vi.useFakeTimers();
    const store = new WorkspaceStore(":memory:");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(partialChatResponse());
    const host = new ModelProviderHost(store, cipher, fetch, undefined, {
      firstResponseTimeoutMs: 50,
      idleTimeoutMs: 200,
      totalTimeoutMs: 80,
    });
    host.saveProfile({ ...profile, apiKey: "provider-secret" });

    try {
      const pending = host.complete(
        {
          attemptId: "attempt_total",
          sessionId: "session_total",
          modelSelection: selection,
          system: "System",
          messages: [{ role: "user", content: "Design a settings page" }],
          tools: [],
        },
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(81);
      await expect(pending).resolves.toContainEqual({
        type: "attempt.failed",
        attemptId: "attempt_total",
        error: {
          code: "provider_timeout",
          message: "Model provider timed out after the 80 ms total time limit",
          retryable: true,
          provider: "provider_1",
          timeout: { phase: "total", thresholdMs: 80 },
        },
      });
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

function baseRequest(attemptId: string) {
  return {
    attemptId,
    sessionId: "session_retry",
    modelSelection: selection,
    system: "System",
    messages: [{ role: "user" as const, content: "Design" }],
    tools: [],
  };
}

function startedEvent(
  attemptId: string,
): Extract<CanonicalStreamEvent, { type: "attempt.started" }> {
  return {
    type: "attempt.started",
    attemptId,
    model: "design-model",
    identity: {
      ...selection,
      apiFormat: "openai-chat-completions",
    },
  };
}

function completedEvent(
  attemptId: string,
  providerRequestId: string,
): Extract<CanonicalStreamEvent, { type: "attempt.completed" }> {
  return {
    type: "attempt.completed",
    attemptId,
    stopReason: "complete",
    providerRequestId,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    },
  };
}

function requestUrl(input: Parameters<typeof globalThis.fetch>[0] | undefined) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url;
}
