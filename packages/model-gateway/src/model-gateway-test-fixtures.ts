import {
  ModelResponseAccumulator,
  type ModelApiFormat,
  type ModelRequest,
  type MultiProtocolModelGateway,
  type ProviderModelConfiguration,
} from "./index.js";

const signal = new AbortController().signal;

export function configuration(
  apiFormat: ModelApiFormat,
  fetch: typeof globalThis.fetch,
): ProviderModelConfiguration {
  return {
    providerId: "provider_1",
    apiFormat,
    authMode: apiFormat === "anthropic-messages" ? "x-api-key" : "bearer",
    baseUrl:
      apiFormat === "anthropic-messages"
        ? "https://anthropic.example"
        : "https://openai.example/v1",
    credential: "provider-secret",
    model: {
      modelId: "design-model",
      name: "Design model",
      contextWindow: 200_000,
      maxOutputTokens: 16_384,
      reasoning: true,
      imageInput: false,
    },
    fetch,
  };
}

export function modelRequest(
  reasoningEffort: ModelRequest["modelSelection"]["reasoningEffort"] = "high",
): ModelRequest {
  return {
    attemptId: "attempt_protocol",
    sessionId: "session_1",
    modelSelection: {
      providerId: "provider_1",
      modelId: "design-model",
      reasoningEffort,
    },
    system: "Use tools.",
    messages: [{ role: "user", content: "Update the frame" }],
    tools: [
      {
        name: "design.update",
        description: "Update a design node",
        inputSchema: {
          type: "object",
          properties: { nodeId: { type: "string" } },
          additionalProperties: false,
        },
      },
    ],
    signal,
  };
}

export async function collect(gateway: MultiProtocolModelGateway) {
  const accumulator = new ModelResponseAccumulator("attempt_protocol");
  for await (const event of gateway.stream(modelRequest())) {
    accumulator.add(event);
  }
  return accumulator.result();
}

export function streamingResponse(events: unknown[]): Response {
  return new Response(
    events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .concat("data: [DONE]\n\n")
      .join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

export function anthropicStreamingResponse(
  events: Array<{ type: string } & Record<string, unknown>>,
): Response {
  return new Response(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}
