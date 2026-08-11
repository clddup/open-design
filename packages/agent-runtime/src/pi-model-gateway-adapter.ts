import type { AgentAttachment } from "@opendesign/agent-contracts";
import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalStreamEvent,
  ModelApiFormat,
  ModelGateway,
  ModelError,
  ModelReasoningEffort,
  ModelRequest,
  ModelStopReason,
  ModelUsage,
  ResolvedModelIdentity,
} from "@opendesign/model-gateway";
import {
  createAssistantMessageEventStream,
  parseStreamingJson,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type StreamFunction,
  type Tool,
} from "@earendil-works/pi-ai";

export interface PiModelGatewayAdapterOptions {
  modelGateway: ModelGateway;
  contextProjection?: PiModelContextProjectionPort;
  failurePort?: PiModelFailurePort;
  nextAttemptId?: () => string;
  now?: () => number;
}

export interface PiModelFailurePort {
  recordFailure(failure: ModelError): void;
  consumeFailure(): ModelError | undefined;
}

export function createPiModelFailurePort(): PiModelFailurePort {
  let latest: ModelError | undefined;
  return {
    recordFailure(failure) {
      latest = structuredClone(failure);
    },
    consumeFailure() {
      const failure = latest;
      latest = undefined;
      return failure === undefined ? undefined : structuredClone(failure);
    },
  };
}

export interface PiContextFailure {
  code: string;
  message: string;
}

export interface PiModelContextProjectionPort {
  beforeProviderTurn(): PiContextFailure | undefined;
  attachmentsFor(message: Message): readonly AgentAttachment[];
}

/**
 * Adapts OpenDesign's Main-proxied canonical ModelGateway to Pi's StreamFn.
 * The adapter carries messages and events only; it never resolves credentials
 * or calls a provider directly from the Agent utility process.
 */
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
      options.modelGateway,
      request,
      output,
      stream,
      now,
      options.failurePort,
    );
    return stream;
  };
}

async function pumpModelGateway(
  modelGateway: ModelGateway,
  request: ModelRequest,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
  now: () => number,
  failurePort?: PiModelFailurePort,
): Promise<void> {
  const blocks = new Map<string, BridgeBlockState>();
  let started = false;
  let terminal = false;
  try {
    for await (const event of modelGateway.stream(request)) {
      requireAttemptId(event, request.attemptId);
      if (terminal) {
        throw new Error(
          "ModelGateway emitted an event after its terminal event",
        );
      }
      if (event.type === "attempt.started") {
        if (started) {
          throw new Error("ModelGateway emitted duplicate attempt.started");
        }
        started = true;
        applyIdentity(output, event.identity, event.providerRequestId);
        continue;
      }
      if (!started) {
        throw new Error(
          `ModelGateway emitted ${event.type} before attempt.started`,
        );
      }
      if (event.type === "block.started") {
        if (blocks.has(event.blockId)) {
          throw new Error(
            `ModelGateway emitted duplicate block.started: ${event.blockId}`,
          );
        }
        const contentIndex = output.content.length;
        blocks.set(event.blockId, {
          contentIndex,
          kind: event.kind,
          status: "started",
          toolInputBuffer: "",
        });
        output.content.push(initialPiBlock(event));
        stream.push(blockStartEvent(event, contentIndex, output));
        continue;
      }
      if (event.type === "block.delta") {
        const block = requireActiveBlock(blocks, event.blockId);
        appendBlockDelta(output, block, event.delta);
        stream.push(blockDeltaEvent(event, block.contentIndex, output));
        continue;
      }
      if (event.type === "block.completed") {
        const block = requireActiveBlock(blocks, event.block.id);
        if (event.block.type !== block.kind) {
          throw new Error(
            `ModelGateway changed block kind for ${event.block.id}: ${block.kind} -> ${event.block.type}`,
          );
        }
        block.status = "completed";
        output.content[block.contentIndex] = toPiBlock(event.block);
        stream.push(blockEndEvent(event.block, block.contentIndex, output));
        continue;
      }
      if (event.type === "attempt.completed") {
        requireCompletedBlocks(blocks);
        terminal = true;
        output.usage = toPiUsage(event.usage);
        if (event.providerStopReason !== undefined) {
          output.rawStopReason = event.providerStopReason;
        }
        if (event.providerRequestId !== undefined) {
          output.responseId = event.providerRequestId;
        }
        output.timestamp = now();
        completePiStream(stream, output, event.stopReason);
        continue;
      }
      terminal = true;
      failurePort?.recordFailure(event.error);
      output.stopReason =
        event.error.code === "cancelled" ? "aborted" : "error";
      output.errorMessage = event.error.message;
      if (event.error.providerRequestId !== undefined) {
        output.responseId = event.error.providerRequestId;
      }
      output.timestamp = now();
      stream.push({
        type: "error",
        reason: output.stopReason,
        error: snapshotMessage(output),
      });
    }
    if (!terminal) {
      throw new Error("ModelGateway stream ended without a terminal event");
    }
  } catch (error) {
    if (terminal) return;
    failurePort?.recordFailure({
      code: "model_gateway_protocol_error",
      message:
        error instanceof Error ? error.message : "ModelGateway bridge failed",
      retryable: true,
    });
    output.stopReason = request.signal.aborted ? "aborted" : "error";
    output.errorMessage =
      error instanceof Error ? error.message : "ModelGateway bridge failed";
    output.timestamp = now();
    stream.push({
      type: "error",
      reason: output.stopReason,
      error: snapshotMessage(output),
    });
  }
}

interface BridgeBlockState {
  contentIndex: number;
  kind: CanonicalContentBlock["type"];
  status: "started" | "completed";
  toolInputBuffer: string;
}

function toModelRequest(
  attemptId: string,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  projection: PiModelContextProjectionPort | undefined,
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

export function projectPiMessagesToCanonical(
  messages: readonly Message[],
  attachments?: Pick<PiModelContextProjectionPort, "attachmentsFor">,
): CanonicalMessage[] {
  return messages.flatMap((message, messageIndex) =>
    projectPiMessageToCanonical(message, messageIndex, attachments),
  );
}

export function projectPiMessageToCanonical(
  message: Message,
  messageIndex: number,
  attachments?: Pick<PiModelContextProjectionPort, "attachmentsFor">,
): CanonicalMessage[] {
  const projected = toCanonicalMessage(message, messageIndex);
  const references = attachments?.attachmentsFor(message) ?? [];
  if (references.length === 0) return [projected];
  if (
    references.some((attachment) => attachment.attachmentId.startsWith("svg_"))
  ) {
    throw new TypeError(
      "SVG resources cannot enter the Provider attachment projection",
    );
  }
  const referenceMessage: CanonicalMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text:
          message.role === "toolResult"
            ? `Multimodal content returned by tool call ${message.toolCallId}.`
            : userMessageText(message),
      },
      ...references.map((attachment) =>
        attachment.attachmentId.startsWith("image_")
          ? {
              type: "image_ref" as const,
              attachmentId: attachment.attachmentId,
              name: attachment.name,
              mimeType: attachment.mimeType,
              byteSize: attachment.byteSize,
            }
          : {
              type: "document_ref" as const,
              attachmentId: attachment.attachmentId,
              name: attachment.name,
              mimeType: attachment.mimeType,
              byteSize: attachment.byteSize,
            },
      ),
    ],
  };
  return message.role === "toolResult"
    ? [projected, referenceMessage]
    : [referenceMessage];
}

function userMessageText(message: Message): string {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

function toCanonicalMessage(
  message: Message,
  messageIndex: number,
): CanonicalMessage {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return { role: "user", content: message.content };
    }
    return {
      role: "user",
      content: message.content.map((block) => {
        if (block.type === "image") {
          throw new TypeError(
            "Inline Pi image content is not allowed in the OpenDesign utility process",
          );
        }
        return { type: "text" as const, text: block.text };
      }),
    };
  }
  if (message.role === "toolResult") {
    if (message.content.some((block) => block.type === "image")) {
      throw new TypeError(
        "Inline Pi tool-result images are not allowed; use OpenDesign attachment references",
      );
    }
    return {
      role: "tool",
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      content: message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n"),
      isError: message.isError,
    };
  }
  return {
    role: "assistant",
    blocks: message.content.map((block, blockIndex): CanonicalContentBlock => {
      const id = `pi_message_${messageIndex}_block_${blockIndex}`;
      if (block.type === "text") {
        return { id, type: "text", text: block.text };
      }
      if (block.type === "thinking") {
        return {
          id,
          type: "reasoning_summary",
          status: block.thinking ? "completed" : "omitted",
          ...(block.thinking ? { summary: block.thinking } : {}),
          ...(block.thinkingSignature === undefined
            ? {}
            : { signature: block.thinkingSignature }),
        };
      }
      return {
        id,
        type: "tool_call",
        toolCallId: block.id,
        name: block.name,
        input: block.arguments,
      };
    }),
    source: {
      providerId: message.provider,
      modelId: message.model,
      apiFormat: toOpenDesignApi(message.api),
      ...(message.responseId === undefined
        ? {}
        : { responseId: message.responseId }),
    },
  };
}

function toCanonicalTool(tool: Tool) {
  if (!tool.parameters || typeof tool.parameters !== "object") {
    throw new TypeError(`Pi tool has an invalid schema: ${tool.name}`);
  }
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as Record<string, unknown>,
  };
}

function initialAssistantMessage(
  model: Model<Api>,
  timestamp: number,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyPiUsage(),
    stopReason: "pending",
    timestamp,
  };
}

function applyIdentity(
  output: AssistantMessage,
  identity: ResolvedModelIdentity,
  responseId: string | undefined,
): void {
  output.api = toPiApi(identity.apiFormat);
  output.provider = identity.providerId;
  output.model = identity.modelId;
  const resolvedResponseId = responseId ?? identity.responseId;
  if (resolvedResponseId !== undefined) output.responseId = resolvedResponseId;
}

function initialPiBlock(
  event: Extract<CanonicalStreamEvent, { type: "block.started" }>,
): AssistantMessage["content"][number] {
  if (event.kind === "text") return { type: "text", text: "" };
  if (event.kind === "reasoning_summary") {
    return { type: "thinking", thinking: "" };
  }
  return {
    type: "toolCall",
    id: event.blockId,
    name: "",
    arguments: {},
  };
}

function blockStartEvent(
  event: Extract<CanonicalStreamEvent, { type: "block.started" }>,
  contentIndex: number,
  output: AssistantMessage,
) {
  if (event.kind === "text") {
    return {
      type: "text_start" as const,
      contentIndex,
      partial: snapshotMessage(output),
    };
  }
  if (event.kind === "reasoning_summary") {
    return {
      type: "thinking_start" as const,
      contentIndex,
      partial: snapshotMessage(output),
    };
  }
  return {
    type: "toolcall_start" as const,
    contentIndex,
    partial: snapshotMessage(output),
  };
}

function blockDeltaEvent(
  event: Extract<CanonicalStreamEvent, { type: "block.delta" }>,
  contentIndex: number,
  output: AssistantMessage,
) {
  const block = output.content[contentIndex];
  if (block?.type === "text") {
    return {
      type: "text_delta" as const,
      contentIndex,
      delta: event.delta,
      partial: snapshotMessage(output),
    };
  }
  if (block?.type === "thinking") {
    return {
      type: "thinking_delta" as const,
      contentIndex,
      delta: event.delta,
      partial: snapshotMessage(output),
    };
  }
  return {
    type: "toolcall_delta" as const,
    contentIndex,
    delta: event.delta,
    partial: snapshotMessage(output),
  };
}

function blockEndEvent(
  block: CanonicalContentBlock,
  contentIndex: number,
  output: AssistantMessage,
) {
  if (block.type === "text") {
    return {
      type: "text_end" as const,
      contentIndex,
      content: block.text,
      partial: snapshotMessage(output),
    };
  }
  if (block.type === "reasoning_summary") {
    return {
      type: "thinking_end" as const,
      contentIndex,
      content: block.summary ?? "",
      partial: snapshotMessage(output),
    };
  }
  return {
    type: "toolcall_end" as const,
    contentIndex,
    toolCall: {
      type: "toolCall" as const,
      id: block.toolCallId,
      name: block.name,
      arguments: asRecord(block.input),
    },
    partial: snapshotMessage(output),
  };
}

function appendBlockDelta(
  output: AssistantMessage,
  state: BridgeBlockState,
  delta: string,
): void {
  const block = output.content[state.contentIndex];
  if (block?.type === "text") block.text += delta;
  if (block?.type === "thinking") block.thinking += delta;
  if (block?.type === "toolCall") {
    state.toolInputBuffer += delta;
    block.arguments = asRecord(parseStreamingJson(state.toolInputBuffer));
  }
}

function toPiBlock(
  block: CanonicalContentBlock,
): AssistantMessage["content"][number] {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "reasoning_summary") {
    return {
      type: "thinking",
      thinking: block.summary ?? "",
      ...(block.signature === undefined
        ? {}
        : { thinkingSignature: block.signature }),
      ...(block.status === "omitted" ? { redacted: true } : {}),
    };
  }
  return {
    type: "toolCall",
    id: block.toolCallId,
    name: block.name,
    arguments: asRecord(block.input),
  };
}

function completePiStream(
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
  stopReason: ModelStopReason,
): void {
  if (stopReason === "cancelled" || stopReason === "error") {
    output.stopReason = stopReason === "cancelled" ? "aborted" : "error";
    output.errorMessage =
      stopReason === "cancelled"
        ? "Model request was cancelled"
        : "Model request failed";
    stream.push({
      type: "error",
      reason: output.stopReason,
      error: snapshotMessage(output),
    });
    return;
  }
  if (stopReason === "content_filter") {
    output.stopReason = "error";
    output.errorMessage = "Model response was blocked by the provider";
    stream.push({
      type: "error",
      reason: "error",
      error: snapshotMessage(output),
    });
    return;
  }
  output.stopReason =
    stopReason === "tool_use"
      ? "toolUse"
      : stopReason === "length"
        ? "length"
        : "stop";
  stream.push({
    type: "done",
    reason: output.stopReason,
    message: snapshotMessage(output),
  });
}

function requireActiveBlock(
  blocks: Map<string, BridgeBlockState>,
  blockId: string,
): BridgeBlockState {
  const block = blocks.get(blockId);
  if (block === undefined) {
    throw new Error(`ModelGateway referenced an unknown block: ${blockId}`);
  }
  if (block.status !== "started") {
    throw new Error(
      `ModelGateway referenced an already completed block: ${blockId}`,
    );
  }
  return block;
}

function requireCompletedBlocks(blocks: Map<string, BridgeBlockState>): void {
  const incomplete = [...blocks.entries()].find(
    ([, block]) => block.status !== "completed",
  );
  if (incomplete !== undefined) {
    throw new Error(
      `ModelGateway terminated with an incomplete block: ${incomplete[0]}`,
    );
  }
}

function requireAttemptId(
  event: CanonicalStreamEvent,
  attemptId: string,
): void {
  if (event.attemptId !== attemptId) {
    throw new Error(
      `ModelGateway attempt mismatch: ${event.attemptId} != ${attemptId}`,
    );
  }
}

function snapshotMessage(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    content: message.content.map((block) => ({ ...block })),
    usage: {
      ...message.usage,
      cost: { ...message.usage.cost },
    },
  };
}

function toPiUsage(usage: ModelUsage): AssistantMessage["usage"] {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens,
    cacheWrite: usage.cacheWriteTokens,
    reasoning: usage.reasoningTokens,
    totalTokens:
      usage.inputTokens +
      usage.outputTokens +
      usage.cacheReadTokens +
      usage.cacheWriteTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: usage.costUsd ?? 0,
    },
  };
}

function emptyPiUsage(): AssistantMessage["usage"] {
  return toPiUsage({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  });
}

function toPiApi(format: ModelApiFormat): Api {
  return format === "openai-chat-completions" ? "openai-completions" : format;
}

function toOpenDesignApi(api: Api): ModelApiFormat {
  if (api === "openai-completions") return "openai-chat-completions";
  if (api === "openai-responses") return "openai-responses";
  if (api === "anthropic-messages") return "anthropic-messages";
  throw new TypeError(`Unsupported Pi model API: ${api}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}
