import type {
  ModelLatencyProfile,
  ModelReasoningEffort,
  ModelRequest,
} from "@opendesign/model-gateway";
import {
  createAssistantMessageEventStream,
  type Api,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type StreamFunction,
} from "@earendil-works/pi-ai";
import {
  projectPiMessagesToCanonical,
  toCanonicalTool,
} from "./pi-model-message-projection.js";
import {
  initialAssistantMessage,
  pumpModelGateway,
  snapshotMessage,
} from "./pi-model-stream-bridge.js";
import { streamWithContextOverflowRecovery } from "./pi-context-overflow-recovery.js";
import type {
  PiContextFailure,
  PiModelContextProjectionPort,
  PiModelGatewayAdapterOptions,
} from "./pi-model-gateway-ports.js";

export { createPiModelFailurePort } from "./pi-model-gateway-ports.js";
export type {
  PiContextFailure,
  PiModelContextProjectionPort,
  PiModelFailurePort,
  PiModelGatewayAdapterOptions,
} from "./pi-model-gateway-ports.js";
export {
  projectPiMessageToCanonical,
  projectPiMessagesToCanonical,
} from "./pi-model-message-projection.js";

export function createPiModelGatewayStreamFn(
  options: PiModelGatewayAdapterOptions,
): StreamFunction<Api, SimpleStreamOptions> {
  let sequence = 0;
  const now = options.now ?? Date.now;
  const nextAttemptId =
    options.nextAttemptId ?? (() => `pi_attempt_${++sequence}`);

  return (model, context, streamOptions) => {
    const attemptId = nextAttemptId();
    const output = initialAssistantMessage(model, now());
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: snapshotMessage(output) });
    let request: ModelRequest;
    try {
      request = toModelRequest(
        attemptId,
        model,
        context,
        streamOptions,
        options.contextProjection,
        options.latencyProfile,
      );
    } catch (error) {
      if (!(error instanceof PiContextProjectionError)) {
        options.failurePort?.recordFailure({
          code: "model_request_invalid",
          message:
            error instanceof Error
              ? error.message
              : "ModelGateway request conversion failed",
          retryable: false,
        });
      }
      output.stopReason = streamOptions?.signal?.aborted ? "aborted" : "error";
      output.errorMessage =
        error instanceof Error
          ? error.message
          : "ModelGateway request conversion failed";
      output.timestamp = now();
      stream.push({
        type: "error",
        reason: output.stopReason,
        error: snapshotMessage(output),
      });
      return stream;
    }
    void pumpModelGateway(
      contextRecoveryGateway(
        options.modelGateway,
        options.contextProjection,
        nextAttemptId,
      ),
      request,
      output,
      stream,
      now,
      options.failurePort,
      options.onRetryEvent,
    );
    return stream;
  };
}

function contextRecoveryGateway(
  gateway: PiModelGatewayAdapterOptions["modelGateway"],
  projection: PiModelGatewayAdapterOptions["contextProjection"],
  nextAttemptId: () => string,
): PiModelGatewayAdapterOptions["modelGateway"] {
  if (projection?.recoverProviderContextOverflow === undefined) return gateway;
  return {
    stream: (request) =>
      streamWithContextOverflowRecovery(
        gateway,
        request,
        projection,
        nextAttemptId,
      ),
  };
}

function toModelRequest(
  attemptId: string,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  projection: PiModelContextProjectionPort | undefined,
  latencyProfile: ModelLatencyProfile | undefined,
): ModelRequest {
  const failure = projection?.beforeProviderTurn();
  if (failure !== undefined) {
    throw new PiContextProjectionError(failure);
  }
  return {
    attemptId,
    ...(options?.sessionId === undefined
      ? {}
      : { sessionId: options.sessionId }),
    ...(latencyProfile === undefined ? {} : { latencyProfile }),
    modelSelection: {
      providerId: model.provider,
      modelId: model.id,
      ...(options?.reasoning === undefined
        ? {}
        : {
            reasoningEffort: options.reasoning satisfies ModelReasoningEffort,
          }),
    },
    system: context.systemPrompt ?? "",
    messages: projectPiMessagesToCanonical(context.messages, projection),
    tools: (context.tools ?? []).map(toCanonicalTool),
    signal: options?.signal ?? new AbortController().signal,
  };
}

class PiContextProjectionError extends Error {
  readonly code: string;

  constructor(failure: PiContextFailure) {
    super(failure.message);
    this.name = "PiContextProjectionError";
    this.code = failure.code;
  }
}
