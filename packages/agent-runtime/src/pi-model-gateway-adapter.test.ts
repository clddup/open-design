import {
  MockModelGateway,
  type CanonicalStreamEvent,
  type ModelApiFormat,
  type ModelGateway,
  type ModelRequest,
} from "@opendesign/model-gateway";
import {
  fauxAssistantMessage,
  type Api,
  type AssistantMessageEvent,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import {
  createPiModelGatewayStreamFn,
  projectPiMessageToCanonical,
} from "./pi-model-gateway-adapter.js";

class RecordingGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly delegate: ModelGateway) {}

  stream(request: ModelRequest) {
    this.requests.push(request);
    return this.delegate.stream(request);
  }
}

const model: Model<"openai-responses"> = {
  id: "design-model",
  name: "Design model",
  api: "openai-responses",
  provider: "configured-provider",
  baseUrl: "https://provider.invalid/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 16_384,
};

describe("Pi ModelGateway adapter", () => {
  it("rejects SVG resources at the Provider attachment boundary", () => {
    const message = {
      role: "user" as const,
      content: "Import the attached SVG",
      timestamp: 1,
    };
    expect(() =>
      projectPiMessageToCanonical(message, 0, {
        attachmentsFor: () => [
          {
            attachmentId: `svg_${"a".repeat(64)}`,
            name: "brand.svg",
            mimeType: "image/svg+xml",
            byteSize: 1024,
          },
        ],
      }),
    ).toThrow("cannot enter the Provider attachment projection");
  });

  it("maps canonical reasoning, text, tool calls, identity and usage into Pi events", async () => {
    const gateway = new RecordingGateway(
      new MockModelGateway({
        blocks: [
          {
            id: "reasoning",
            type: "reasoning_summary",
            status: "completed",
            summary: "Inspect the current document first.",
            signature: "reasoning_signature",
          },
          { id: "text", type: "text", text: "I will inspect the canvas." },
          {
            id: "tool",
            type: "tool_call",
            toolCallId: "inspect_call_1",
            name: "opendesign_inspect_document",
            input: { target: "active-page" },
          },
        ],
        stopReason: "tool_use",
        providerRequestId: "provider_response_1",
        providerStopReason: "tool_calls",
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          cacheReadTokens: 40,
          cacheWriteTokens: 10,
          reasoningTokens: 12,
          costUsd: 0.02,
        },
      }),
    );
    const streamFn = createPiModelGatewayStreamFn({
      modelGateway: gateway,
      nextAttemptId: () => "bridge_attempt_1",
      now: () => 1_786_000_000_000,
    });
    const stream = streamFn(
      model,
      {
        systemPrompt: "OpenDesign system",
        messages: [{ role: "user", content: "Refine the page", timestamp: 1 }],
        tools: [
          {
            name: "opendesign_inspect_document",
            description: "Inspect the active design document.",
            parameters: Type.Object(
              { target: Type.Literal("active-page") },
              { additionalProperties: false },
            ),
          },
        ],
      },
      {
        reasoning: "high",
        sessionId: "conversation_bridge",
        signal: new AbortController().signal,
      },
    );
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "thinking_start",
      "thinking_delta",
      "thinking_end",
      "text_start",
      "text_delta",
      "text_end",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_end",
      "done",
    ]);
    const toolDelta = events.find((event) => event.type === "toolcall_delta");
    expect(toolDelta?.partial.content[2]).toMatchObject({
      type: "toolCall",
      arguments: { target: "active-page" },
    });
    expect(result).toMatchObject({
      api: "openai-responses",
      provider: "configured-provider",
      model: "design-model",
      responseId: "provider_response_1",
      stopReason: "toolUse",
      rawStopReason: "tool_calls",
      usage: {
        input: 120,
        output: 30,
        cacheRead: 40,
        cacheWrite: 10,
        reasoning: 12,
        totalTokens: 200,
        cost: { total: 0.02 },
      },
      content: [
        {
          type: "thinking",
          thinking: "Inspect the current document first.",
          thinkingSignature: "reasoning_signature",
        },
        { type: "text", text: "I will inspect the canvas." },
        {
          type: "toolCall",
          id: "inspect_call_1",
          name: "opendesign_inspect_document",
          arguments: { target: "active-page" },
        },
      ],
    });
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]).toMatchObject({
      attemptId: "bridge_attempt_1",
      sessionId: "conversation_bridge",
      modelSelection: {
        providerId: "configured-provider",
        modelId: "design-model",
        reasoningEffort: "high",
      },
      system: "OpenDesign system",
      messages: [{ role: "user", content: "Refine the page" }],
      tools: [{ name: "opendesign_inspect_document" }],
    });
  });

  it("replays Pi assistant and tool-result messages through canonical context", async () => {
    const gateway = new RecordingGateway(
      new MockModelGateway("Context converted"),
    );
    const streamFn = createPiModelGatewayStreamFn({
      modelGateway: gateway,
      nextAttemptId: () => "bridge_attempt_context",
    });
    const priorAssistant = {
      ...fauxAssistantMessage(
        [
          { type: "thinking", thinking: "Prior plan" },
          { type: "text", text: "Inspecting" },
          {
            type: "toolCall",
            id: "prior_call",
            name: "opendesign_inspect_document",
            arguments: {},
          },
        ],
        { responseId: "prior_response", stopReason: "toolUse" },
      ),
      api: "openai-responses" as const,
      provider: "configured-provider",
      model: "design-model",
    };
    const context: Context = {
      systemPrompt: "Replay system",
      messages: [
        { role: "user", content: "Original request", timestamp: 1 },
        priorAssistant,
        {
          role: "toolResult",
          toolCallId: "prior_call",
          toolName: "opendesign_inspect_document",
          content: [{ type: "text", text: '{"revision":147}' }],
          details: {},
          isError: false,
          timestamp: 2,
        },
      ],
    };

    const result = await streamFn(model, context).result();

    expect(result.stopReason).toBe("stop");
    const requestMessages = gateway.requests[0]?.messages;
    expect(requestMessages?.[0]).toEqual({
      role: "user",
      content: "Original request",
    });
    const assistant = requestMessages?.[1];
    if (assistant?.role !== "assistant") {
      throw new Error("Expected a canonical assistant replay message");
    }
    expect(assistant.source?.responseId).toBe("prior_response");
    expect(assistant.blocks.map((block) => block.type)).toEqual([
      "reasoning_summary",
      "text",
      "tool_call",
    ]);
    const replayedToolCall = assistant.blocks[2];
    if (replayedToolCall?.type !== "tool_call") {
      throw new Error("Expected the third replay block to be a tool call");
    }
    expect(replayedToolCall.toolCallId).toBe("prior_call");
    expect(requestMessages?.[2]).toEqual({
      role: "tool",
      toolCallId: "prior_call",
      toolName: "opendesign_inspect_document",
      content: '{"revision":147}',
      isError: false,
    });
  });

  it("round-trips every supported Pi and canonical API identity", async () => {
    const variants: Array<{
      piApi: Api;
      canonicalApi: ModelApiFormat;
    }> = [
      {
        piApi: "openai-responses",
        canonicalApi: "openai-responses",
      },
      {
        piApi: "openai-completions",
        canonicalApi: "openai-chat-completions",
      },
      {
        piApi: "anthropic-messages",
        canonicalApi: "anthropic-messages",
      },
    ];

    for (const variant of variants) {
      const gateway = new RecordingGateway(
        identityGateway(variant.canonicalApi),
      );
      const streamFn = createPiModelGatewayStreamFn({
        modelGateway: gateway,
      });
      const prior = {
        ...fauxAssistantMessage("Prior response"),
        api: variant.piApi,
        provider: model.provider,
        model: model.id,
      };
      const result = await streamFn(
        { ...model, api: variant.piApi },
        { messages: [prior] },
      ).result();

      expect(result.api).toBe(variant.piApi);
      const replayed = gateway.requests[0]?.messages[0];
      if (replayed?.role !== "assistant") {
        throw new Error("Expected replayed assistant identity");
      }
      expect(replayed.source?.apiFormat).toBe(variant.canonicalApi);
    }
  });

  it("encodes gateway failures and forbidden inline images as Pi error events", async () => {
    const failedGateway: ModelGateway = {
      async *stream(request): AsyncIterable<CanonicalStreamEvent> {
        await Promise.resolve();
        yield {
          type: "attempt.started",
          attemptId: request.attemptId,
          model: request.modelSelection.modelId,
          identity: {
            ...request.modelSelection,
            apiFormat: "openai-responses",
          },
        };
        yield {
          type: "block.started",
          attemptId: request.attemptId,
          blockId: "interrupted_text",
          kind: "text",
        };
        yield {
          type: "block.delta",
          attemptId: request.attemptId,
          blockId: "interrupted_text",
          delta: "Partial response",
        };
        yield {
          type: "attempt.failed",
          attemptId: request.attemptId,
          error: {
            code: "upstream_error",
            message: "Provider failed",
            retryable: true,
            provider: "configured-provider",
          },
        };
      },
    };
    const streamFn = createPiModelGatewayStreamFn({
      modelGateway: failedGateway,
    });
    const failed = await streamFn(model, { messages: [] }).result();
    expect(failed).toMatchObject({
      stopReason: "error",
      errorMessage: "Provider failed",
    });

    const forbidden = await streamFn(model, {
      messages: [
        {
          role: "user",
          content: [
            { type: "image", data: "inline-base64", mimeType: "image/png" },
          ],
          timestamp: 1,
        },
      ],
    }).result();
    expect(forbidden).toMatchObject({
      stopReason: "error",
      errorMessage:
        "Inline Pi image content is not allowed in the OpenDesign utility process",
    });
  });

  it("maps cancellation and content filtering to explicit Pi terminal errors", async () => {
    for (const expected of [
      {
        canonical: "cancelled" as const,
        pi: "aborted",
        message: "Model request was cancelled",
      },
      {
        canonical: "content_filter" as const,
        pi: "error",
        message: "Model response was blocked by the provider",
      },
    ]) {
      const streamFn = createPiModelGatewayStreamFn({
        modelGateway: new MockModelGateway({
          blocks: [],
          stopReason: expected.canonical,
        }),
      });

      await expect(
        streamFn(model, { messages: [] }).result(),
      ).resolves.toMatchObject({
        stopReason: expected.pi,
        errorMessage: expected.message,
      });
    }
  });

  it("rejects mismatched attempts and incomplete canonical block lifecycles", async () => {
    const cases: Array<{
      events: CanonicalStreamEvent[];
      expectedMessage: string;
    }> = [
      {
        events: [
          {
            type: "attempt.started",
            attemptId: "wrong_attempt",
            model: "design-model",
            identity: {
              providerId: "configured-provider",
              modelId: "design-model",
              apiFormat: "openai-responses",
            },
          },
        ],
        expectedMessage: "ModelGateway attempt mismatch",
      },
      {
        events: [
          {
            type: "attempt.started",
            attemptId: "protocol_attempt",
            model: "design-model",
            identity: {
              providerId: "configured-provider",
              modelId: "design-model",
              apiFormat: "openai-responses",
            },
          },
          {
            type: "block.started",
            attemptId: "protocol_attempt",
            blockId: "unfinished",
            kind: "text",
          },
          {
            type: "attempt.completed",
            attemptId: "protocol_attempt",
            stopReason: "complete",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              reasoningTokens: 0,
            },
          },
        ],
        expectedMessage:
          "ModelGateway terminated with an incomplete block: unfinished",
      },
    ];

    for (const testCase of cases) {
      const gateway: ModelGateway = {
        async *stream(): AsyncIterable<CanonicalStreamEvent> {
          await Promise.resolve();
          for (const event of testCase.events) yield event;
        },
      };
      const streamFn = createPiModelGatewayStreamFn({
        modelGateway: gateway,
        nextAttemptId: () => "protocol_attempt",
      });
      const result = await streamFn(model, { messages: [] }).result();
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain(testCase.expectedMessage);
    }
  });
});

function identityGateway(apiFormat: ModelApiFormat): ModelGateway {
  return {
    async *stream(request): AsyncIterable<CanonicalStreamEvent> {
      await Promise.resolve();
      yield {
        type: "attempt.started",
        attemptId: request.attemptId,
        model: request.modelSelection.modelId,
        identity: { ...request.modelSelection, apiFormat },
      };
      yield {
        type: "block.started",
        attemptId: request.attemptId,
        blockId: "identity_text",
        kind: "text",
      };
      yield {
        type: "block.completed",
        attemptId: request.attemptId,
        block: { id: "identity_text", type: "text", text: "Identity" },
      };
      yield {
        type: "attempt.completed",
        attemptId: request.attemptId,
        stopReason: "complete",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
      };
    },
  };
}
