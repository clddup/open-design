import type {
  CanonicalContentBlock,
  CanonicalStreamEvent,
  ModelStopReason,
  ModelUsage,
} from "./canonical-wire.js";
import type { ModelGateway, ModelRequest } from "./model-gateway-ports.js";

export interface MockModelResponse {
  blocks: CanonicalContentBlock[];
  stopReason?: ModelStopReason;
  usage?: Partial<ModelUsage>;
  providerRequestId?: string;
  providerStopReason?: string;
}

export class MockModelGateway implements ModelGateway {
  readonly #responses: MockModelResponse[];
  #responseIndex = 0;

  constructor(response: string | MockModelResponse | MockModelResponse[]) {
    this.#responses = Array.isArray(response)
      ? response
      : [
          typeof response === "string"
            ? {
                blocks: [{ id: "mock_text", type: "text", text: response }],
              }
            : response,
        ];
  }

  async *stream(request: ModelRequest): AsyncIterable<CanonicalStreamEvent> {
    await Promise.resolve();
    const response =
      this.#responses[
        Math.min(this.#responseIndex++, this.#responses.length - 1)
      ];
    if (!response) throw new Error("Mock model has no configured response");

    yield {
      type: "attempt.started",
      attemptId: request.attemptId,
      model: request.modelSelection.modelId,
      identity: {
        ...request.modelSelection,
        apiFormat: "openai-responses",
      },
      ...(response.providerRequestId === undefined
        ? {}
        : { providerRequestId: response.providerRequestId }),
    };

    for (const configuredBlock of response.blocks) {
      if (request.signal.aborted) {
        yield completedAttempt(request.attemptId, "cancelled", response);
        return;
      }
      const block = withAttemptBlockId(request.attemptId, configuredBlock);
      yield {
        type: "block.started",
        attemptId: request.attemptId,
        blockId: block.id,
        kind: block.type,
      };
      const delta = blockDelta(block);
      if (delta.length > 0) {
        yield {
          type: "block.delta",
          attemptId: request.attemptId,
          blockId: block.id,
          delta,
        };
      }
      yield { type: "block.completed", attemptId: request.attemptId, block };
    }

    yield completedAttempt(
      request.attemptId,
      response.stopReason ??
        (response.blocks.some((block) => block.type === "tool_call")
          ? "tool_use"
          : "complete"),
      response,
    );
  }
}

function withAttemptBlockId(
  attemptId: string,
  block: CanonicalContentBlock,
): CanonicalContentBlock {
  return { ...block, id: `${attemptId}_${block.id}` };
}

function blockDelta(block: CanonicalContentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "reasoning_summary") return block.summary ?? "";
  return JSON.stringify(block.input);
}

function completedAttempt(
  attemptId: string,
  stopReason: ModelStopReason,
  response: MockModelResponse,
): Extract<CanonicalStreamEvent, { type: "attempt.completed" }> {
  return {
    type: "attempt.completed",
    attemptId,
    stopReason,
    ...(response.providerStopReason === undefined
      ? {}
      : { providerStopReason: response.providerStopReason }),
    ...(response.providerRequestId === undefined
      ? {}
      : { providerRequestId: response.providerRequestId }),
    usage: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      cacheReadTokens: response.usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: response.usage?.cacheWriteTokens ?? 0,
      reasoningTokens: response.usage?.reasoningTokens ?? 0,
      ...(response.usage?.costUsd === undefined
        ? {}
        : { costUsd: response.usage.costUsd }),
    },
  };
}
