import { describe, expect, it } from "vitest";
import {
  MultiProtocolModelGateway,
  type CanonicalStreamEvent,
  type ModelRequest,
} from "./index.js";
import {
  anthropicStreamingResponse,
  collect,
  configuration,
  modelRequest,
  streamingResponse,
} from "./model-gateway-test-fixtures.js";

describe("multi-protocol model gateway", () => {
  it.each([
    ["transport termination", "terminated", true],
    ["HTTP 400 invalid request", "invalid", false],
    ["wrapped context overflow", "context", false],
    ["HTTP 504 upstream first-byte timeout", "upstream-timeout", true],
  ])("classifies %s retryability", async (_name, kind, retryable) => {
    const fetch: typeof globalThis.fetch =
      kind === "terminated"
        ? () => Promise.reject(new Error("terminated"))
        : () =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  error: {
                    code:
                      kind === "context"
                        ? "internal_server_error"
                        : kind === "upstream-timeout"
                          ? "upstream_first_byte_timeout"
                          : "invalid_request_error",
                    message:
                      kind === "context"
                        ? "upstream internal_server_error: context_too_large"
                        : kind === "upstream-timeout"
                          ? "upstream_first_byte_timeout"
                          : "Invalid request",
                    type: "invalid_request_error",
                  },
                }),
                {
                  status: kind === "upstream-timeout" ? 504 : 400,
                  headers: { "Content-Type": "application/json" },
                },
              ),
            );
    const gateway = new MultiProtocolModelGateway(
      configuration("openai-responses", fetch),
    );
    const events: CanonicalStreamEvent[] = [];

    for await (const event of gateway.stream(modelRequest()))
      events.push(event);

    expect(events.at(-1)).toMatchObject({
      type: "attempt.failed",
      error: { retryable },
    });
  });

  it.each([
    ["openai-responses" as const, "https://openai.example/v1/responses"],
    [
      "openai-chat-completions" as const,
      "https://openai.example/v1/chat/completions",
    ],
    ["anthropic-messages" as const, "https://anthropic.example/v1/messages"],
  ])("serializes image input through %s", async (apiFormat, expectedUrl) => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const gateway = new MultiProtocolModelGateway({
      ...configuration(apiFormat, (input, init) => {
        captured = {
          url: requestUrl(input),
          ...(init === undefined ? {} : { init }),
        };
        return Promise.resolve(
          new Response("Rejected after capture", { status: 400 }),
        );
      }),
      model: {
        ...configuration(apiFormat, globalThis.fetch).model,
        imageInput: true,
      },
    });
    const imageData = Buffer.from("reference-image").toString("base64");
    const request: ModelRequest = {
      ...modelRequest("off"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Use this visual direction" },
            { type: "image", data: imageData, mimeType: "image/png" },
          ],
        },
      ],
    };

    for await (const event of gateway.stream(request)) {
      // The request payload is the subject of this test; the 400 response ends the stream.
      expect(event.attemptId).toBe(request.attemptId);
    }

    expect(captured?.url).toBe(expectedUrl);
    const body = captured?.init?.body;
    if (typeof body !== "string") {
      throw new Error("Expected string request body");
    }
    expect(body).toContain(imageData);
    expect(body).toContain("image/png");
  });

  it("uses OpenAI Chat Completions with Bearer auth", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const gateway = new MultiProtocolModelGateway(
      configuration("openai-chat-completions", (input, init) => {
        requests.push({ url: requestUrl(input), ...(init ? { init } : {}) });
        return Promise.resolve(
          streamingResponse([
            {
              id: "chatcmpl_1",
              object: "chat.completion.chunk",
              created: 1,
              model: "design-model",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "Updated." },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "chatcmpl_1",
              object: "chat.completion.chunk",
              created: 1,
              model: "design-model",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 3,
                total_tokens: 13,
              },
            },
          ]),
        );
      }),
    );

    expect(await collect(gateway)).toMatchObject({
      identity: {
        providerId: "provider_1",
        modelId: "design-model",
        apiFormat: "openai-chat-completions",
        reasoningEffort: "high",
      },
      stopReason: "complete",
      blocks: [{ type: "text", text: "Updated." }],
      usage: { inputTokens: 10, outputTokens: 3 },
    });
    expect(requests[0]?.url).toBe("https://openai.example/v1/chat/completions");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer provider-secret",
    );
  });

  it("does not expose OpenAI-compatible raw reasoning fields as summaries", async () => {
    const gateway = new MultiProtocolModelGateway(
      configuration("openai-chat-completions", () =>
        Promise.resolve(
          streamingResponse([
            {
              id: "chatcmpl_reasoning",
              object: "chat.completion.chunk",
              created: 1,
              model: "design-model",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    reasoning_content: "private chain of thought",
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "chatcmpl_reasoning",
              object: "chat.completion.chunk",
              created: 1,
              model: "design-model",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_design_1",
                        type: "function",
                        function: {
                          name: "design.update",
                          arguments: '{"nodeId":"frame_1"}',
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "chatcmpl_reasoning",
              object: "chat.completion.chunk",
              created: 1,
              model: "design-model",
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 8,
                total_tokens: 18,
                completion_tokens_details: { reasoning_tokens: 4 },
              },
            },
          ]),
        ),
      ),
    );

    const response = await collect(gateway);
    expect(response.stopReason).toBe("tool_use");
    expect(response.blocks).toEqual([
      expect.objectContaining({
        type: "tool_call",
        name: "design.update",
        input: { nodeId: "frame_1" },
      }),
    ]);
    expect(response.usage.reasoningTokens).toBe(4);
    expect(JSON.stringify(response.blocks)).not.toContain("chain of thought");
  });

  it("uses OpenAI Responses instead of silently falling back to Chat", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const gateway = new MultiProtocolModelGateway(
      configuration("openai-responses", (input, init) => {
        requests.push({ url: requestUrl(input), ...(init ? { init } : {}) });
        return Promise.resolve(
          streamingResponse([
            {
              type: "response.created",
              response: {
                id: "resp_1",
                object: "response",
                created_at: 1,
                status: "in_progress",
                model: "design-model",
                output: [],
                parallel_tool_calls: true,
                tool_choice: "auto",
                tools: [],
              },
            },
            {
              type: "response.output_item.added",
              output_index: 0,
              item: {
                id: "msg_1",
                type: "message",
                status: "in_progress",
                role: "assistant",
                content: [],
              },
            },
            {
              type: "response.content_part.added",
              item_id: "msg_1",
              output_index: 0,
              content_index: 0,
              part: { type: "output_text", text: "", annotations: [] },
            },
            {
              type: "response.output_text.delta",
              item_id: "msg_1",
              output_index: 0,
              content_index: 0,
              delta: "Created.",
            },
            {
              type: "response.output_text.done",
              item_id: "msg_1",
              output_index: 0,
              content_index: 0,
              text: "Created.",
            },
            {
              type: "response.output_item.done",
              output_index: 0,
              item: {
                id: "msg_1",
                type: "message",
                status: "completed",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: "Created.",
                    annotations: [],
                  },
                ],
              },
            },
            {
              type: "response.completed",
              response: {
                id: "resp_1",
                object: "response",
                created_at: 1,
                status: "completed",
                model: "design-model",
                output: [
                  {
                    id: "msg_1",
                    type: "message",
                    status: "completed",
                    role: "assistant",
                    content: [
                      {
                        type: "output_text",
                        text: "Created.",
                        annotations: [],
                      },
                    ],
                  },
                ],
                parallel_tool_calls: true,
                tool_choice: "auto",
                tools: [],
                usage: {
                  input_tokens: 12,
                  input_tokens_details: { cached_tokens: 4 },
                  output_tokens: 5,
                  output_tokens_details: { reasoning_tokens: 2 },
                  total_tokens: 17,
                },
              },
            },
          ]),
        );
      }),
    );

    expect(await collect(gateway)).toMatchObject({
      providerRequestId: "resp_1",
      stopReason: "complete",
      blocks: [{ type: "text", text: "Created." }],
      usage: {
        inputTokens: 8,
        outputTokens: 5,
        cacheReadTokens: 4,
        reasoningTokens: 2,
      },
    });
    expect(requests[0]?.url).toBe("https://openai.example/v1/responses");
  });

  it("uses Anthropic Messages with x-api-key auth", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const gateway = new MultiProtocolModelGateway(
      configuration("anthropic-messages", (input, init) => {
        requests.push({ url: requestUrl(input), ...(init ? { init } : {}) });
        return Promise.resolve(
          anthropicStreamingResponse([
            {
              type: "message_start",
              message: {
                id: "msg_anthropic_1",
                type: "message",
                role: "assistant",
                model: "design-model",
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 14, output_tokens: 1 },
              },
            },
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "Aligned." },
            },
            { type: "content_block_stop", index: 0 },
            {
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: 4 },
            },
            { type: "message_stop" },
          ]),
        );
      }),
    );

    expect(await collect(gateway)).toMatchObject({
      providerRequestId: "msg_anthropic_1",
      stopReason: "complete",
      blocks: [{ type: "text", text: "Aligned." }],
      usage: { inputTokens: 14, outputTokens: 4 },
    });
    expect(requests[0]?.url).toBe("https://anthropic.example/v1/messages");
    const headers = new Headers(requests[0]?.init?.headers);
    expect(headers.get("x-api-key")).toBe("provider-secret");
    expect(headers.get("authorization")).toBeNull();
  });
});

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
