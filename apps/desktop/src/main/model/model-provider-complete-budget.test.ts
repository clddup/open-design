import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createContextBudget,
  modelContextFits,
} from "@opendesign/agent-runtime";
import type { ModelRequest } from "@opendesign/model-gateway";
import type { ModelProfile } from "@/shared/desktop-api";
import { WorkspaceStore } from "../project/workspace-store";
import {
  ModelProviderHost,
  type CredentialCipher,
  type ResolvedModelAttachment,
} from "./model-provider-host";

const cipher: CredentialCipher = {
  available: () => false,
  encrypt: () => {
    throw new Error("Unexpected credential encryption");
  },
  decrypt: () => {
    throw new Error("Unexpected credential decryption");
  },
};
const model: ModelProfile = {
  modelId: "critic",
  name: "Critic",
  contextWindow: 32_000,
  maxOutputTokens: 4_000,
  capabilities: { toolUse: true, imageInput: true, reasoning: false },
  reasoningEfforts: ["off"],
};
const documentRef = {
  type: "document_ref" as const,
  attachmentId: `file_${"a".repeat(64)}`,
  name: "original-brief.pdf",
  mimeType: "application/pdf",
  byteSize: 1024,
};
const stores: WorkspaceStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function document(text: string): ResolvedModelAttachment {
  return {
    kind: "document",
    text,
    mimeType: documentRef.mimeType,
    byteSize: documentRef.byteSize,
    truncated: false,
    extractedCharacterCount: text.length,
  };
}

function request(): Omit<ModelRequest, "signal"> {
  return {
    attemptId: "attempt_budget",
    sessionId: "conversation_original",
    modelSelection: { providerId: "provider", modelId: model.modelId },
    system:
      "Independently review the design against the original requirements.",
    messages: [
      {
        role: "user",
        content: "Original requirement: keep every checkout step.",
      },
      {
        role: "user",
        content: [{ type: "text", text: "Review this document." }, documentRef],
      },
    ],
    tools: [],
  };
}

function setup(
  resolved = document("Address, payment, review. FINAL REQUIREMENT."),
) {
  const store = new WorkspaceStore(":memory:");
  stores.push(store);
  const resolve = vi
    .fn<(id: string) => Promise<ResolvedModelAttachment>>()
    .mockResolvedValue(resolved);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() =>
    Promise.resolve(
      new Response(
        `data: ${JSON.stringify({
          id: "chat_budget",
          object: "chat.completion.chunk",
          created: 1,
          model: "critic",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "Reviewed" },
              finish_reason: "stop",
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    ),
  );
  const host = new ModelProviderHost(store, cipher, fetch, { resolve });
  host.saveProfile({
    providerId: "provider",
    name: "Fixture",
    enabled: true,
    apiFormat: "openai-chat-completions",
    authMode: "none",
    baseUrl: "https://models.example/v1",
    models: [{ ...model, modelId: "author", contextWindow: 200_000 }, model],
    setAsDefault: true,
  });
  return { host, resolve, fetch };
}

function body(fetch: ReturnType<typeof setup>["fetch"]) {
  const value = fetch.mock.calls[0]?.[1]?.body;
  if (typeof value !== "string") throw new Error("Expected serialized request");
  return JSON.parse(value) as {
    messages: Array<{
      role: string;
      content:
        | string
        | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }>;
  };
}

describe("ModelProviderHost.complete request budget", () => {
  it("rejects expanded documents against the selected critic, before any fetch", async () => {
    const { host, resolve, fetch } = setup(document("原始要求".repeat(8_000)));
    const input = request();
    const budget = createContextBudget(model, input.system, input.tools, 0);
    expect(
      modelContextFits(input.messages, input.system, input.tools, budget),
    ).toBe(true);
    await expect(
      host.complete(input, new AbortController().signal),
    ).rejects.toThrow("context remains too large");
    expect(resolve).toHaveBeenCalledExactlyOnceWith(documentRef.attachmentId);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves a legal document once and sends every original requirement intact", async () => {
    const text =
      "Address, payment, review. ".repeat(1_000) + "FINAL REQUIREMENT.";
    const { host, resolve, fetch } = setup(document(text));
    const input = request();
    const original = structuredClone(input);
    const events = await host.complete(input, new AbortController().signal);
    expect(events.some((event) => event.type === "attempt.completed")).toBe(
      true,
    );
    expect(resolve).toHaveBeenCalledExactlyOnceWith(documentRef.attachmentId);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(input).toEqual(original);
    const messages = body(fetch).messages;
    expect(messages).toContainEqual(original.messages[0]);
    const content = messages.at(-1)?.content;
    if (!Array.isArray(content)) throw new Error("Expected content blocks");
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "Review this document." });
    expect(content[1]?.type).toBe("text");
    expect(content[1]?.text).toContain(`\n${text}\n`);
  });

  it.each(["image_ref", "image"] as const)(
    "budgets %s at image cost while sending the real bytes",
    async (type) => {
      const data = Buffer.alloc(300_000, 42).toString("base64");
      const { host, resolve, fetch } = setup({
        kind: "image",
        data,
        mimeType: "image/png",
        byteSize: 300_000,
      });
      const input = request();
      input.messages[1] = {
        role: "user",
        content: [
          type === "image_ref"
            ? {
                type,
                attachmentId: `image_${"b".repeat(64)}`,
                name: "capture.png",
                mimeType: "image/png",
                byteSize: 300_000,
              }
            : { type, data, mimeType: "image/png" },
        ],
      };
      await host.complete(input, new AbortController().signal);
      expect(resolve).toHaveBeenCalledTimes(type === "image_ref" ? 1 : 0);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(body(fetch).messages.at(-1)?.content).toEqual([
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${data}` },
        },
      ]);
    },
  );

  it.each(["system", "tools", "history"] as const)(
    "includes %s in the complete request budget",
    async (part) => {
      const { host, fetch } = setup();
      const input = request();
      const large = "原始要求".repeat(8_000);
      if (part === "system") input.system = large;
      if (part === "tools")
        input.tools = [
          {
            name: "review",
            description: "Review",
            inputSchema: { type: "object", description: large },
          },
        ];
      if (part === "history")
        input.messages.unshift({ role: "user", content: large });
      await expect(
        host.complete(input, new AbortController().signal),
      ).rejects.toThrow("context remains too large");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("keeps output and safety reserves instead of using the whole context window", async () => {
    const { host, fetch } = setup();
    const input = request();
    input.messages = [{ role: "user", content: "要".repeat(22_400) }];
    // 28k text tokens fit the 32k window, but not its 25,952-token input budget.
    await expect(
      host.complete(input, new AbortController().signal),
    ).rejects.toThrow("model input budget 25952");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains the fixed image cost when text and images together exceed the budget", async () => {
    const { host, fetch } = setup();
    const input = request();
    input.messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "要".repeat(10_000) },
          { type: "image", data: "AA==", mimeType: "image/png" },
        ],
      },
    ];
    await expect(
      host.complete(input, new AbortController().signal),
    ).rejects.toThrow("context remains too large");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not resolve or fetch when already cancelled", async () => {
    const { host, resolve, fetch } = setup();
    const controller = new AbortController();
    const reason = new Error("Cancelled before resolution");
    controller.abort(reason);
    await expect(host.complete(request(), controller.signal)).rejects.toBe(
      reason,
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fetch when cancelled during resolution", async () => {
    const { host, resolve, fetch } = setup();
    const controller = new AbortController();
    const reason = new Error("Cancelled during resolution");
    resolve.mockImplementation(() => {
      controller.abort(reason);
      return Promise.resolve(document("原始要求".repeat(8_000)));
    });
    await expect(host.complete(request(), controller.signal)).rejects.toBe(
      reason,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves the author stream path unbudgeted and resolves only once", async () => {
    const { host, resolve, fetch } = setup(document("原始要求".repeat(8_000)));
    const events = [];
    for await (const event of host.stream(
      request(),
      new AbortController().signal,
    ))
      events.push(event);
    expect(events.some((event) => event.type === "attempt.completed")).toBe(
      true,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
